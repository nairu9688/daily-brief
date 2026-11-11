import { Readability } from '@mozilla/readability';
import { parseHTML } from 'linkedom';
import type { RawArticle } from '@daily-brief/schema';
import { hostOf } from '../lib/url';
import { canReadFull, type Whitelist } from '../lib/whitelist';
import { Breaker } from './breaker';
import { ACCEPT_HTML, BodyError, decodeBody, deadline, HttpError, messageOf, mimeOf, readCapped, USER_AGENT, type HttpFetch } from './http';
import { mapLimit } from './limit';

/** Refus R1 : l'URL (ou une redirection) ne mène pas à un domaine `full`. Aucune requête n'est envoyée vers elle. */
export class NotFullError extends Error {
  constructor(url: string) {
    super(`R1 : ${url} n'est pas un domaine full`);
    this.name = 'NotFullError';
  }
}

export type FullTextOptions = {
  whitelist: Whitelist;
  fetch: HttpFetch;
  timeoutMs: number;
  maxBytes: number;
  minChars: number;
  maxRedirects?: number;
  /** Interruption globale (échéance de la phase). */
  signal?: AbortSignal;
};

const BLOCKS = 'h1,h2,h3,h4,h5,h6,p,li,blockquote,pre,figcaption';
const HTML_TYPES = new Set(['text/html', 'application/xhtml+xml']);

/** Texte principal d'une page (Readability), un bloc par paragraphe, séparés par une ligne vide. */
export function extractText(html: string): string {
  const { document } = parseHTML(html);
  const article = new Readability(document as unknown as ConstructorParameters<typeof Readability>[0]).parse();
  if (!article?.content) return '';
  const { document: doc } = parseHTML(`<!doctype html><html><body>${article.content}</body></html>`);
  const blocks = [...doc.querySelectorAll(BLOCKS)]
    .filter((el) => !el.querySelector(BLOCKS))
    .map((el) => (el.textContent ?? '').replace(/\s+/g, ' ').trim())
    .filter(Boolean);
  return blocks.length > 0 ? blocks.join('\n\n') : (article.textContent ?? '').replace(/\s+/g, ' ').trim();
}

/**
 * Texte intégral d'un article. **Garde R1** : l'URL et chaque redirection doivent être sur un
 * domaine `full`, sinon NotFullError avant toute requête vers elles. http(s) seulement, délai,
 * taille et nombre de redirections bornés, HTML seulement, texte d'au moins `minChars` caractères.
 */
export async function fetchFullText(url: string, o: FullTextOptions): Promise<string> {
  let current = url;
  for (let hop = 0; hop <= (o.maxRedirects ?? 3); hop++) {
    if (!canReadFull(o.whitelist, current)) throw new NotFullError(current);
    const res = await o.fetch(current, {
      redirect: 'manual',
      signal: deadline(o.timeoutMs, o.signal),
      headers: { accept: ACCEPT_HTML, 'user-agent': USER_AGENT },
    });
    const location = res.headers.get('location');
    if (res.status >= 300 && res.status < 400 && location) {
      current = new URL(location, current).toString();
      continue;
    }
    if (!res.ok) throw new HttpError(res.status, current);
    if (!HTML_TYPES.has(mimeOf(res))) throw new BodyError(`type ${mimeOf(res) || 'absent'} refusé`);
    const text = extractText(decodeBody(await readCapped(res, o.maxBytes), res.headers.get('content-type')));
    if (text.length < o.minChars) throw new BodyError(`texte trop court (${text.length} caractères)`);
    return text;
  }
  throw new Error('trop de redirections');
}

export type FullTextStats = { attempted: number; extracted: number; failed: number; skipped: number; errors: string[] };

/**
 * Indices des articles à lire, langues en alternance (FR, EN, ES, FR…) : le plafond `maxFetches`
 * est partagé entre les éditions au lieu d'être épuisé par la première. L'ordre interne à chaque
 * langue est conservé (celui de `dedupe` : les plus grands groupes d'abord).
 */
export function fullTextTargets(articles: RawArticle[], wl: Whitelist): number[] {
  const byLang = new Map<string, number[]>();
  articles.forEach((a, i) => {
    if (a.text !== null || !canReadFull(wl, a.url)) return;
    byLang.set(a.lang, [...(byLang.get(a.lang) ?? []), i]);
  });
  const queues = [...byLang.values()];
  const out: number[] = [];
  for (let k = 0; queues.some((q) => k < q.length); k++) for (const q of queues) if (k < q.length) out.push(q[k]);
  return out;
}

/**
 * Complète `text` des articles sans texte dont le domaine est `full` (et eux seuls), au plus
 * `concurrency` à la fois et `maxFetches` en tout, langues en alternance. Un hôte qui répond 401/402/403/429 ou ne
 * répond pas est abandonné ; après `deadlineMs`, les articles restants sont laissés sans texte.
 */
export async function fillFullTexts(
  articles: RawArticle[],
  o: Omit<FullTextOptions, 'signal'> & { concurrency: number; maxFetches: number; deadlineMs: number },
): Promise<{ articles: RawArticle[]; stats: FullTextStats }> {
  const stats: FullTextStats = { attempted: 0, extracted: 0, failed: 0, skipped: 0, errors: [] };
  const targets = fullTextTargets(articles, o.whitelist);
  stats.skipped = Math.max(0, targets.length - o.maxFetches);
  const phase = AbortSignal.timeout(o.deadlineMs);
  const breakers = new Map<string, Breaker>();
  const out = articles.map((a) => ({ ...a }));
  const errors: string[] = [];
  await mapLimit(targets.slice(0, o.maxFetches), o.concurrency, async (i) => {
    const host = hostOf(out[i].url);
    const breaker = breakers.get(host) ?? breakers.set(host, new Breaker()).get(host)!;
    if (phase.aborted || breaker.open) {
      stats.skipped++;
      return;
    }
    stats.attempted++;
    try {
      out[i].text = await fetchFullText(out[i].url, { ...o, signal: phase });
      stats.extracted++;
    } catch (e) {
      stats.failed++;
      breaker.trip(e);
      errors.push(`${out[i].url} : ${messageOf(e)}`);
    }
  });
  stats.errors = errors.sort().slice(0, 20);
  return { articles: out, stats };
}
