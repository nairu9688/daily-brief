import { z } from 'zod';
import { LANGS, RUBRIC_KEYS } from '@daily-brief/schema';
import { lookupDomain, type Whitelist } from '../lib/whitelist';
import { makeArticle, windowVerdict } from './article';
import { Breaker, recordFailure } from './breaker';
import { fetchJson, type HttpFetch } from './http';
import { emptyRun, type SourceContext, type SourceRun } from './types';

export const EXA_SEARCH = 'https://api.exa.ai/search';
/** Longueur maximale du texte demandé à Exa par résultat. */
export const MAX_TEXT_CHARACTERS = 20000;

/** Résultat Exa : analyse tolérante, `text` présent seulement si `contents.text` a été demandé. */
const ResultSchema = z.object({
  url: z.string().min(1),
  title: z.string().nullish(),
  publishedDate: z.string().nullish(),
  text: z.string().nullish(),
});
const ResponseSchema = z.object({ results: z.array(z.unknown()) });

export type ExaResult = z.infer<typeof ResultSchema>;

/**
 * R1 : le texte n'est demandé que si la recherche est restreinte à des domaines **tous** au
 * statut `full`. Sans `includeDomains`, ou avec un seul domaine `feed`, `meta` ou inconnu : jamais.
 */
export function canRequestText(wl: Whitelist, includeDomains: string[] | undefined): boolean {
  return !!includeDomains && includeDomains.length > 0 && includeDomains.every((d) => lookupDomain(wl, `https://${d}/`)?.status === 'full');
}

export type ExaParams = { query: string; startPublishedDate: Date; numResults: number; includeDomains?: string[] };

/** `POST /search` (catégorie news) ; `textRequested` indique si `contents.text` a été demandé. */
export async function exaSearch(
  p: ExaParams,
  c: { apiKey: string; fetch: HttpFetch; timeoutMs: number; whitelist: Whitelist },
): Promise<{ results: ExaResult[]; textRequested: boolean }> {
  const textRequested = canRequestText(c.whitelist, p.includeDomains);
  const body: Record<string, unknown> = {
    query: p.query,
    category: 'news',
    startPublishedDate: p.startPublishedDate.toISOString(),
    numResults: p.numResults,
  };
  if (p.includeDomains?.length) body.includeDomains = p.includeDomains;
  // Le texte n'est jamais demandé par défaut : `text: false` l'écarte explicitement, quel que soit le réglage de l'API.
  body.contents = { text: textRequested ? { maxCharacters: MAX_TEXT_CHARACTERS } : false };
  const json = await fetchJson(c.fetch, EXA_SEARCH, {
    method: 'POST',
    headers: { 'x-api-key': c.apiKey, 'content-type': 'application/json' },
    body: JSON.stringify(body),
    timeoutMs: c.timeoutMs,
  });
  const results = ResponseSchema.parse(json).results.slice(0, p.numResults).flatMap((r) => {
    const parsed = ResultSchema.safeParse(r);
    return parsed.success ? [parsed.data] : [];
  });
  return { results, textRequested };
}

/**
 * Exa, par langue et par rubrique : une recherche restreinte aux domaines `full` de la langue
 * (avec texte), puis, si `broad`, une recherche ouverte (métadonnées seulement). `broad` sert
 * quand Exa est la découverte principale (§16). Plafond : `exa.maxRequests` par passage.
 */
export async function collectExa(ctx: SourceContext, apiKey: string, opts: { broad: boolean }): Promise<SourceRun> {
  const cfg = ctx.config.exa;
  const run = emptyRun();
  const breaker = new Breaker();
  const since = ctx.windowStart.toISOString();
  const common = { apiKey, fetch: ctx.fetch, timeoutMs: cfg.timeoutMs, whitelist: ctx.whitelist };
  outer: for (const lang of LANGS) {
    for (const key of RUBRIC_KEYS) {
      const searches = [...(cfg.fullDomains[lang].length ? [cfg.fullDomains[lang]] : []), ...(opts.broad ? [undefined] : [])];
      for (const includeDomains of searches) {
        if (breaker.open || run.requests >= cfg.maxRequests) break outer;
        run.requests++;
        try {
          const { results, textRequested } = await exaSearch(
            { query: ctx.rubriques[key].exaQuery[lang], startPublishedDate: ctx.windowStart, numResults: cfg.numResults, includeDomains },
            common,
          );
          for (const r of results) {
            const text = textRequested ? r.text : null;
            const { article, discardedText } = makeArticle({ url: r.url, title: r.title, lang, publishedAt: r.publishedDate, origin: 'exa', text }, ctx.whitelist);
            if (discardedText || (!textRequested && r.text)) run.discardedTexts++;
            if (!article) continue;
            const verdict = windowVerdict(article.publishedAt, since);
            if (verdict === 'undated') run.undated++;
            else if (verdict === 'ok') run.candidates.push({ article });
          }
          breaker.success();
        } catch (e) {
          if (recordFailure(run, breaker, `exa ${lang}/${key}${includeDomains ? ' (full)' : ''}`, e)) break outer;
        }
      }
    }
  }
  return run;
}
