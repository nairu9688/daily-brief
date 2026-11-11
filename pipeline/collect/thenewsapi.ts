import { z } from 'zod';
import { LANGS, RUBRIC_KEYS, type Lang, type RubricKey } from '@daily-brief/schema';
import { canReadFull } from '../lib/whitelist';
import { makeArticle } from './article';
import { Breaker, recordFailure } from './breaker';
import type { RequestBudget } from './budget';
import type { BudgetBucket } from './config';
import { fetchJson, type HttpFetch } from './http';
import { searchOf } from './rubriques';
import { emptyRun, type Candidate, type SourceContext, type SourceRun } from './types';

export const THENEWSAPI_BASE = 'https://api.thenewsapi.com/v1/news';

/** Article TheNewsAPI : analyse tolérante (champs inconnus ignorés, champs absents acceptés). */
const ItemSchema = z.object({
  uuid: z.string().min(1),
  title: z.string().nullish(),
  description: z.string().nullish(),
  url: z.string().min(1),
  language: z.string().nullish(),
  published_at: z.string().nullish(),
  source: z.string().nullish(),
});
const ResponseSchema = z.object({ data: z.array(z.unknown()) });

export type NewsItem = z.infer<typeof ItemSchema>;

/** `published_after` au format attendu par l'API (UTC, à la seconde). */
export const publishedAfterParam = (d: Date): string => d.toISOString().slice(0, 19);

/** Articles valides d'une réponse ; un article mal formé est ignoré, une réponse mal formée lève. */
export function parseNews(json: unknown): NewsItem[] {
  return ResponseSchema.parse(json).data.flatMap((d) => {
    const r = ItemSchema.safeParse(d);
    return r.success ? [r.data] : [];
  });
}

type Common = { token: string; fetch: HttpFetch; timeoutMs: number };

export type TopParams = { language: string; locale?: string; categories?: string; search?: string | null; publishedAfter?: Date; limit: number; page?: number };

/** `GET /v1/news/top`. */
export async function topNews(p: TopParams, c: Common): Promise<NewsItem[]> {
  const q = new URLSearchParams({ api_token: c.token, language: p.language, limit: String(p.limit) });
  if (p.locale) q.set('locale', p.locale);
  if (p.categories) q.set('categories', p.categories);
  if (p.search) q.set('search', p.search);
  if (p.publishedAfter) q.set('published_after', publishedAfterParam(p.publishedAfter));
  if (p.page && p.page > 1) q.set('page', String(p.page));
  return parseNews(await fetchJson(c.fetch, `${THENEWSAPI_BASE}/top?${q}`, { timeoutMs: c.timeoutMs }));
}

/** `GET /v1/news/similar/{uuid}` : articles d'autres médias sur la même information. */
export async function similarNews(uuid: string, p: { language: string; publishedAfter: Date; limit: number }, c: Common): Promise<NewsItem[]> {
  const q = new URLSearchParams({ api_token: c.token, language: p.language, published_after: publishedAfterParam(p.publishedAfter), limit: String(p.limit) });
  return parseNews(await fetchJson(c.fetch, `${THENEWSAPI_BASE}/similar/${encodeURIComponent(uuid)}?${q}`, { timeoutMs: c.timeoutMs }));
}

/**
 * Découverte TheNewsAPI : pour chaque langue, une requête `/top` par rubrique et par page, en
 * tourniquet (page 1 de toutes les rubriques, puis page 2…), tant que le poste de la langue le
 * permet ; puis `/similar` sur les premiers articles (domaines `full` d'abord) avec le poste
 * `similar`. Le budget est réservé avant chaque requête ; un 401/402/403/429 ou un délai dépassé
 * coupe la source.
 */
export async function collectTheNewsApi(ctx: SourceContext, token: string, budget: RequestBudget<BudgetBucket>): Promise<SourceRun> {
  const cfg = ctx.config.thenewsapi;
  const common: Common = { token, fetch: ctx.fetch, timeoutMs: cfg.timeoutMs };
  const run = emptyRun();
  const breaker = new Breaker();
  const uuids = new Map<string, string>();
  const discovered: Candidate[] = [];

  const add = (items: NewsItem[], lang: Lang, seed?: string) => {
    for (const it of items) {
      const { article } = makeArticle(
        { url: it.url, title: it.title, outlet: it.source, description: it.description, lang: it.language ?? lang, publishedAt: it.published_at, origin: 'thenewsapi' },
        ctx.whitelist,
      );
      if (!article) continue;
      if (!uuids.has(article.id)) uuids.set(article.id, it.uuid);
      const c: Candidate = seed ? { article, seed } : { article };
      run.candidates.push(c);
      if (!seed) discovered.push(c);
    }
  };

  for (const lang of LANGS) {
    const active: RubricKey[] = [...RUBRIC_KEYS];
    for (let page = 1; active.length > 0 && !breaker.open && budget.remaining(lang) > 0; page++) {
      for (const key of [...active]) {
        if (breaker.open || !budget.take(lang)) break;
        run.requests++;
        const rubric = ctx.rubriques[key];
        try {
          const items = await topNews(
            { language: lang, locale: cfg.locales[lang], categories: rubric.categories.join(','), search: searchOf(rubric, lang), publishedAfter: ctx.windowStart, limit: cfg.limit, page },
            common,
          );
          add(items, lang);
          if (items.length < cfg.limit) active.splice(active.indexOf(key), 1);
        } catch (e) {
          if (recordFailure(run, breaker, `top ${lang}/${key} p${page}`, e)) break;
          active.splice(active.indexOf(key), 1);
        }
      }
    }
  }

  for (const seed of similarSeeds(discovered, ctx)) {
    if (breaker.open || !budget.take('similar')) break;
    run.requests++;
    try {
      const items = await similarNews(uuids.get(seed.article.id)!, { language: seed.article.lang, publishedAfter: ctx.windowStart, limit: cfg.limit }, common);
      add(items, seed.article.lang as Lang, seed.article.id);
    } catch (e) {
      if (recordFailure(run, breaker, `similar ${seed.article.lang}`, e)) break;
    }
  }
  return run;
}

/** Ordre des graines de `/similar` : une par article, domaines `full` d'abord, langues en alternance. */
export function similarSeeds(discovered: Candidate[], ctx: Pick<SourceContext, 'whitelist'>): Candidate[] {
  const seen = new Set<string>();
  const perLang = LANGS.map((lang) => {
    const mine = discovered.filter((c) => c.article.lang === lang && !seen.has(c.article.id) && seen.add(c.article.id));
    return [...mine.filter((c) => canReadFull(ctx.whitelist, c.article.url)), ...mine.filter((c) => !canReadFull(ctx.whitelist, c.article.url))];
  });
  const out: Candidate[] = [];
  for (let i = 0; perLang.some((l) => i < l.length); i++) for (const l of perLang) if (i < l.length) out.push(l[i]);
  return out;
}
