import { LANGS, type RawArticle } from '@daily-brief/schema';
import { tryNormalizeUrl } from '../lib/url';
import { canReadFull, type Whitelist } from '../lib/whitelist';
import { articleId } from './article';
import type { Candidate } from './types';

/** Seuil de similarité des titres (Jaccard sur trigrammes de caractères). */
export const SIMILARITY_THRESHOLD = 0.6;
/** Titres trop courts (« Direct », « Live ») : jamais regroupés sur le seul titre. */
const MIN_TITLE_CHARS = 20;
/** Taille maximale d'un groupe formé par les seuls titres (sans lien `/similar`). */
const MAX_TITLE_GROUP = 8;
/** Origine dont on garde les métadonnées en cas de doublon : l'éditeur (RSS) d'abord. */
const ORIGIN_RANK: Record<RawArticle['origin'], number> = { rss: 0, thenewsapi: 1, exa: 2, webz: 3, newsletter: 4 };

/** Comparaison binaire de chaînes, indépendante de la locale. */
const cmp = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** Rang d'une langue : FR, EN, ES, puis les autres. */
const langRank = (l: string): number => {
  const i = (LANGS as readonly string[]).indexOf(l);
  return i === -1 ? LANGS.length : i;
};

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

/**
 * Ordre total des doublons d'une même URL : meilleure origine, puis texte le plus long, puis titre,
 * description, média, langue (FR, EN, ES d'abord), date et texte (ordre lexicographique). Il ne dépend jamais de l'ordre d'entrée.
 */
function compareDuplicates(x: RawArticle, y: RawArticle): number {
  return (
    ORIGIN_RANK[x.origin] - ORIGIN_RANK[y.origin] ||
    (y.text?.length ?? 0) - (x.text?.length ?? 0) ||
    cmp(x.title, y.title) ||
    cmp(x.description ?? '', y.description ?? '') ||
    cmp(x.outlet, y.outlet) ||
    langRank(x.lang) - langRank(y.lang) ||
    cmp(x.lang, y.lang) ||
    cmp(x.publishedAt ?? '', y.publishedAt ?? '') ||
    cmp(x.text ?? '', y.text ?? '')
  );
}

/** Fusion des doublons d'une même URL : métadonnées de la meilleure origine, date la plus ancienne. R1 revérifié.
 * NB : le texte n'est gardé que pour un domaine `full`. Les textes de newsletters (Gmail, lot 7) devront
 * porter un indicateur de provenance explicite, sinon ils seraient écartés ici.
 */
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
 * Un lien par titre seul ne rattache un article à un groupe que si son titre ressemble aussi (≥ 0,6) au
 * premier membre du groupe (le plus petit id), et un groupe formé des seuls titres ne dépasse pas 8 articles :
 * cela évite le chaînage de titres qui dérivent peu à peu. Les liens `/similar` regroupent sans ces limites.
 * **R1** : un texte n'est conservé que si l'URL est sur un domaine `full`.
 */
export function dedupe(candidates: Candidate[], wl: Whitelist): RawArticle[] {
  const byUrl = new Map<string, RawArticle[]>();
  for (const c of candidates) {
    const url = tryNormalizeUrl(c.article.url);
    if (!url) continue;
    byUrl.set(url, [...(byUrl.get(url) ?? []), c.article]);
  }
  const articles = [...byUrl.entries()].sort(([a], [b]) => cmp(a, b)).map(([url, group]) => merge(url, group.sort(compareDuplicates), wl));

  const ids = articles.map((a) => a.id);
  const parent = new Map(ids.map((id) => [id, id]));
  const find = (x: string): string => {
    let r = x;
    while (parent.get(r) !== r) r = parent.get(r)!;
    parent.set(x, r);
    return r;
  };
  const size = new Map(ids.map((id) => [id, 1]));
  const seeded = new Set<string>();
  /** Réunit deux groupes ; la racine est toujours le plus petit id. */
  const union = (a: string, b: string, bySeed: boolean) => {
    const [ra, rb] = [find(a), find(b)];
    if (ra === rb) return;
    const [root, other] = ra < rb ? [ra, rb] : [rb, ra];
    parent.set(other, root);
    size.set(root, size.get(root)! + size.get(other)!);
    if (bySeed || seeded.has(other)) seeded.add(root);
  };

  for (const c of candidates) {
    const url = tryNormalizeUrl(c.article.url);
    if (c.seed && url && parent.has(c.seed) && parent.has(articleId(url))) union(articleId(url), c.seed, true);
  }
  const grams = new Map(articles.map((a) => [a.id, normalizeTitle(a.title).length >= MIN_TITLE_CHARS ? trigrams(a.title) : null]));
  // Paires examinées dans l'ordre des id : le résultat ne dépend pas de l'ordre d'entrée.
  const order = [...ids].sort(cmp);
  for (let i = 0; i < order.length; i++) {
    const gi = grams.get(order[i]);
    if (!gi) continue;
    for (let j = i + 1; j < order.length; j++) {
      const gj = grams.get(order[j]);
      if (!gj || Math.min(gi.size, gj.size) / Math.max(gi.size, gj.size) < SIMILARITY_THRESHOLD) continue;
      if (jaccard(gi, gj) < SIMILARITY_THRESHOLD) continue;
      const [ra, rb] = [find(order[i]), find(order[j])];
      if (ra === rb) continue;
      const [fa, fb] = [grams.get(ra), grams.get(rb)];
      if (!fa || !fb || jaccard(fa, fb) < SIMILARITY_THRESHOLD) continue;
      if (!seeded.has(ra) && !seeded.has(rb) && size.get(ra)! + size.get(rb)! > MAX_TITLE_GROUP) continue;
      union(ra, rb, false);
    }
  }

  const groupOf = (a: RawArticle) => 'g-' + find(a.id).slice(2);
  const sizes = new Map<string, number>();
  for (const a of articles) sizes.set(groupOf(a), (sizes.get(groupOf(a)) ?? 0) + 1);
  return articles
    .map((a) => ({ ...a, groupId: groupOf(a) }))
    .sort((a, b) => langRank(a.lang) - langRank(b.lang) || sizes.get(b.groupId)! - sizes.get(a.groupId)! || cmp(a.groupId, b.groupId) || cmp(a.id, b.id));
}
