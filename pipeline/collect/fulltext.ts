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
/** Bornes d'une page analysée : au-delà, la page est hostile ou cassée et n'est pas lue. */
const MAX_DEPTH = 300;
const MAX_ELEMENTS = 30_000;
/** Requêtes simultanées au plus vers un même hôte (politesse envers les médias). */
const HOST_CONCURRENCY = 2;

type DomNode = { nodeType: number; firstChild: DomNode | null; nextSibling: DomNode | null; parentNode: DomNode | null };

/** Parcours itératif (sans récursion, donc sans dépassement de pile) : profondeur et nombre d'éléments bornés. */
function assertBoundedDom(root: DomNode): void {
  let count = 0;
  let depth = 1;
  let node: DomNode | null = root.firstChild;
  while (node) {
    if (node.nodeType === 1) {
      if (++count > MAX_ELEMENTS || depth > MAX_DEPTH) throw new BodyError('page trop imbriquée');
      if (node.firstChild) {
        node = node.firstChild;
        depth++;
        continue;
      }
    }
    while (node && node !== root && !node.nextSibling) {
      node = node.parentNode;
      depth--;
    }
    node = node && node !== root ? node.nextSibling : null;
  }
}

/**
 * Texte principal d'une page (Readability), un bloc par paragraphe, séparés par une ligne vide.
 * Seuls les éléments de bloc (BLOCKS) sont gardés : un texte posé hors de ces éléments est perdu, et
 * les espaces d'un `<pre>` ne sont pas conservés (tout espace est réduit à un seul).
 * Une page trop profonde ou trop grosse (300 niveaux, 30 000 éléments) est refusée : BodyError.
 */
export function extractText(html: string): string {
  const { document } = parseHTML(html);
  assertBoundedDom(document as unknown as DomNode);
  try {
    const article = new Readability(document as unknown as ConstructorParameters<typeof Readability>[0], { maxElemsToParse: MAX_ELEMENTS }).parse();
    if (!article?.content) return '';
    const { document: doc } = parseHTML(`<!doctype html><html><body>${article.content}</body></html>`);
    const blocks = [...doc.querySelectorAll(BLOCKS)]
      .filter((el) => !el.querySelector(BLOCKS))
      .map((el) => (el.textContent ?? '').replace(/\s+/g, ' ').trim())
      .filter(Boolean);
    return blocks.length > 0 ? blocks.join('\n\n') : (article.textContent ?? '').replace(/\s+/g, ' ').trim();
  } catch (e) {
    if (e instanceof RangeError) throw new BodyError('page trop imbriquée');
    throw e;
  }
}

/** Seuls les ports par défaut (80, 443) sont suivis : `URL.port` est vide pour eux. */
const hasDefaultPort = (u: URL): boolean => u.port === '';

/**
 * Texte intégral d'un article. **Garde R1** : l'URL et chaque redirection doivent être sur un
 * domaine `full`, sinon NotFullError avant toute requête vers elles. http(s) seulement, ports par défaut
 * seulement, pas de repli de https vers http, un seul délai pour toute la chaîne de redirections,
 * taille et nombre de redirections bornés, HTML seulement, texte d'au moins `minChars` caractères.
 * Les refus portant sur la page (NotFullError, BodyError) ne disent rien de l'état de l'hôte.
 */
export async function fetchFullText(url: string, o: FullTextOptions): Promise<string> {
  const signal = deadline(o.timeoutMs, o.signal);
  const secure = url.toLowerCase().startsWith('https:');
  let current = url;
  for (let hop = 0; hop <= (o.maxRedirects ?? 3); hop++) {
    if (!canReadFull(o.whitelist, current)) throw new NotFullError(current);
    const u = new URL(current);
    if (!hasDefaultPort(u) || (secure && u.protocol !== 'https:')) throw new NotFullError(current);
    const res = await o.fetch(current, {
      redirect: 'manual',
      signal,
      headers: { accept: ACCEPT_HTML, 'user-agent': USER_AGENT },
    });
    const refuse = async (err: Error): Promise<never> => {
      await res.body?.cancel().catch(() => {});
      throw err;
    };
    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get('location');
      if (!location) return refuse(new BodyError(`redirection ${res.status} sans location`));
      await res.body?.cancel().catch(() => {});
      current = new URL(location, current).toString();
      continue;
    }
    if (!res.ok) return refuse(new HttpError(res.status, current));
    if (!HTML_TYPES.has(mimeOf(res))) return refuse(new BodyError(`type ${mimeOf(res) || 'absent'} refusé`));
    const text = extractText(decodeBody(await readCapped(res, o.maxBytes), res.headers.get('content-type')));
    if (text.length < o.minChars) throw new BodyError(`texte trop court (${text.length} caractères)`);
    return text;
  }
  throw new BodyError('trop de redirections');
}

/** Erreur qui ne concerne que la page : elle ne compte pas pour le disjoncteur de l'hôte. */
const isPageError = (e: unknown): boolean => e instanceof BodyError || e instanceof NotFullError;

/** Sémaphore par hôte : au plus `HOST_CONCURRENCY` pages en cours vers le même hôte. */
function hostGate() {
  const state = new Map<string, { active: number; waiting: (() => void)[] }>();
  return {
    async acquire(host: string): Promise<void> {
      const s = state.get(host) ?? state.set(host, { active: 0, waiting: [] }).get(host)!;
      if (s.active < HOST_CONCURRENCY) {
        s.active++;
        return;
      }
      await new Promise<void>((resolve) => s.waiting.push(resolve));
    },
    release(host: string): void {
      const s = state.get(host)!;
      const next = s.waiting.shift();
      if (next) next();
      else s.active--;
    },
  };
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
 * `concurrency` à la fois (dont 2 par hôte) et `maxFetches` pages lues en tout (les pages ignorées ne comptent pas),
 * langues en alternance. Un hôte qui répond 401/402/403/429, ne répond pas ou échoue 3 fois de suite est abandonné ; après `deadlineMs`, les articles restants sont laissés sans texte.
 */
export async function fillFullTexts(
  articles: RawArticle[],
  o: Omit<FullTextOptions, 'signal'> & { concurrency: number; maxFetches: number; deadlineMs: number },
): Promise<{ articles: RawArticle[]; stats: FullTextStats }> {
  const stats: FullTextStats = { attempted: 0, extracted: 0, failed: 0, skipped: 0, errors: [] };
  const targets = fullTextTargets(articles, o.whitelist);
  const phase = AbortSignal.timeout(o.deadlineMs);
  const breakers = new Map<string, Breaker>();
  const gate = hostGate();
  const out = articles.map((a) => ({ ...a }));
  const errors: string[] = [];
  // Toutes les cibles sont parcourues : une page ignorée (hôte coupé, échéance) ne consomme pas le plafond.
  await mapLimit(targets, o.concurrency, async (i) => {
    const host = hostOf(out[i].url);
    const breaker = breakers.get(host) ?? breakers.set(host, new Breaker()).get(host)!;
    await gate.acquire(host);
    try {
      if (phase.aborted || breaker.open || stats.attempted >= o.maxFetches) {
        stats.skipped++;
        return;
      }
      stats.attempted++;
      try {
        out[i].text = await fetchFullText(out[i].url, { ...o, signal: phase });
        stats.extracted++;
        breaker.success();
      } catch (e) {
        stats.failed++;
        if (!isPageError(e)) breaker.trip(e);
        errors.push(`${out[i].url} : ${messageOf(e)}`);
      }
    } finally {
      gate.release(host);
    }
  });
  stats.errors = errors.sort().slice(0, 20);
  return { articles: out, stats };
}
