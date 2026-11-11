import { createHash } from 'node:crypto';
import { RawArticleSchema, type RawArticle } from '@daily-brief/schema';
import { outletKey, tryNormalizeUrl } from '../lib/url';
import { canReadFull, type Whitelist } from '../lib/whitelist';

export const MAX_DESCRIPTION = 600;

export type ArticleInput = {
  url: string | null | undefined;
  title: string | null | undefined;
  outlet?: string | null;
  description?: string | null;
  lang: string | null | undefined;
  publishedAt?: string | null;
  origin: RawArticle['origin'];
  text?: string | null;
};

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

/** Texte brut d'un fragment HTML : balises retirées, entités courantes décodées, espaces fusionnés. */
export function plainText(html: string | null | undefined): string {
  return (html ?? '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
      if (e[0] === '#') {
        const code = e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
        return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : ' ';
      }
      return ENTITIES[e.toLowerCase()] ?? m;
    })
    .replace(/\s+/g, ' ')
    .trim();
}

/** Date ISO 8601 (UTC) ou null si la date est absente ou illisible. */
export function toIso(value: string | null | undefined): string | null {
  if (!value) return null;
  const t = Date.parse(value);
  return Number.isNaN(t) ? null : new Date(t).toISOString();
}

/** Identifiant stable d'un article : empreinte de son URL normalisée. */
export const articleId = (normalizedUrl: string): string => 'a-' + createHash('sha256').update(normalizedUrl).digest('hex').slice(0, 16);

/**
 * Seul point d'entrée des articles dans la collecte. URL normalisée (http(s) seulement), titre
 * non vide, langue ISO 639-1, date ISO. **R1** : le texte n'est gardé que si le domaine est au
 * statut `full` ; sinon il est écarté (`discardedText`) et seules les métadonnées restent.
 */
export function makeArticle(input: ArticleInput, wl: Whitelist): { article: RawArticle | null; discardedText: boolean } {
  const url = input.url ? tryNormalizeUrl(input.url) : null;
  const title = plainText(input.title);
  const lang = /^[a-z]{2}(?![a-z])/i.exec((input.lang ?? '').trim())?.[0].toLowerCase();
  const rawText = input.text?.trim() ? input.text.replace(/\r\n?/g, '\n').replace(/\n{3,}/g, '\n\n').trim() : null;
  if (!url || !title || !lang) return { article: null, discardedText: false };
  const full = canReadFull(wl, url);
  const description = plainText(input.description).slice(0, MAX_DESCRIPTION) || null;
  const candidate: RawArticle = {
    id: articleId(url),
    url,
    outlet: plainText(input.outlet) || outletKey(url),
    title,
    description,
    lang,
    publishedAt: toIso(input.publishedAt),
    origin: input.origin,
    text: full ? rawText : null,
  };
  const parsed = RawArticleSchema.safeParse(candidate);
  return { article: parsed.success ? parsed.data : null, discardedText: rawText !== null && !full };
}
