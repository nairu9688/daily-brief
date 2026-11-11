import { LANGS, type RawArticle } from '@daily-brief/schema';
import { tryNormalizeUrl } from '../lib/url';
import { canReadFull, type Whitelist } from '../lib/whitelist';
import { articleId } from './article';
import type { Candidate } from './types';

/** Seuil de similarité des titres (Jaccard sur trigrammes de caractères). */
export const SIMILARITY_THRESHOLD = 0.6;
/** Titres trop courts (« Direct », « Live ») : jamais regroupés sur le seul titre. */
const MIN_TITLE_CHARS = 20;
/** Origine dont on garde les métadonnées en cas de doublon : l'éditeur (RSS) d'abord. */
const ORIGIN_RANK: Record<RawArticle['origin'], number> = { rss: 0, thenewsapi: 1, exa: 2, webz: 3, newsletter: 4 };

/** Comparaison binaire de chaînes, indépendante de la locale. */
const cmp = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** Titre sans accents, en minuscules, ponctuation remplacée par des espaces. */
export function normalizeTitle(title: string): string {
  return title
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

export function trigrams(title: string): Set<string> {
  const t = ` ${normalizeTitle(title)} `;
  const out = new Set<string>();
  for (let i = 0; i + 3 <= t.length; i++) out.add(t.slice(i, i + 3));
  return out;
}

export function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 0;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  return inter / (a.size + b.size - inter);
}

/** Fusion des doublons d'une même URL : métadonnées de la meilleure origine, date la plus ancienne. R1 revérifié. */
function merge(url: string, group: RawArticle[], wl: Whitelist): RawArticle {
  const [best] = group;
  const dates = group.map((a) => a.publishedAt).filter((d): d is string => d !== null).sort();
  const text = canReadFull(wl, url) ? (group.find((a) => a.text)?.text ?? null) : null;
  return {
    id: articleId(url),
    url,
    outlet: best.outlet,
    title: best.title,
    description: group.find((a) => a.description)?.description ?? null,
    lang: best.lang,
    publishedAt: dates[0] ?? null,
    origin: best.origin,
    text,
  };
}

/**
 * Dédoublonne les candidats : fusion par URL normalisée, puis regroupement (`groupId`) des
 * articles liés par `/similar` ou dont les titres se ressemblent (Jaccard ≥ 0,6). Déterministe :
 * la même entrée donne toujours la même sortie, triée par langue, taille de groupe, groupe, id.
 * **R1** : un texte n'est conservé que si l'URL est sur un domaine `full`.
 */
export function dedupe(candidates: Candidate[], wl: Whitelist): RawArticle[] {
  const byUrl = new Map<string, { article: RawArticle; index: number }[]>();
  candidates.forEach((c, index) => {
    const url = tryNormalizeUrl(c.article.url);
    if (!url) return;
    byUrl.set(url, [...(byUrl.get(url) ?? []), { article: c.article, index }]);
  });
  const articles = [...byUrl.entries()]
    .sort(([a], [b]) => cmp(a, b))
    .map(([url, group]) =>
      merge(
        url,
        group.sort((x, y) => ORIGIN_RANK[x.article.origin] - ORIGIN_RANK[y.article.origin] || x.index - y.index).map((g) => g.article),
        wl,
      ),
    );

  const ids = articles.map((a) => a.id);
  const parent = new Map(ids.map((id) => [id, id]));
  const find = (x: string): string => {
    let r = x;
    while (parent.get(r) !== r) r = parent.get(r)!;
    parent.set(x, r);
    return r;
  };
  const union = (a: string, b: string) => {
    if (!parent.has(a) || !parent.has(b)) return;
    const [ra, rb] = [find(a), find(b)];
    if (ra !== rb) parent.set(ra < rb ? rb : ra, ra < rb ? ra : rb);
  };

  for (const c of candidates) {
    const url = tryNormalizeUrl(c.article.url);
    if (c.seed && url) union(articleId(url), c.seed);
  }
  const grams = articles.map((a) => (normalizeTitle(a.title).length >= MIN_TITLE_CHARS ? trigrams(a.title) : null));
  for (let i = 0; i < articles.length; i++) {
    const gi = grams[i];
    if (!gi) continue;
    for (let j = i + 1; j < articles.length; j++) {
      const gj = grams[j];
      if (!gj || Math.min(gi.size, gj.size) / Math.max(gi.size, gj.size) < SIMILARITY_THRESHOLD) continue;
      if (jaccard(gi, gj) >= SIMILARITY_THRESHOLD) union(ids[i], ids[j]);
    }
  }

  const groupOf = (a: RawArticle) => 'g-' + find(a.id).slice(2);
  const sizes = new Map<string, number>();
  for (const a of articles) sizes.set(groupOf(a), (sizes.get(groupOf(a)) ?? 0) + 1);
  const langRank = (l: string) => {
    const i = (LANGS as readonly string[]).indexOf(l);
    return i === -1 ? LANGS.length : i;
  };
  return articles
    .map((a) => ({ ...a, groupId: groupOf(a) }))
    .sort((a, b) => langRank(a.lang) - langRank(b.lang) || sizes.get(b.groupId)! - sizes.get(a.groupId)! || cmp(a.groupId, b.groupId) || cmp(a.id, b.id));
}
