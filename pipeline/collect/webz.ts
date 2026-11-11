import { z } from 'zod';
import type { Lang } from '@daily-brief/schema';
import { makeArticle, toIso, windowVerdict } from './article';
import { Breaker, recordFailure } from './breaker';
import { fetchJson, type HttpFetch } from './http';
import { emptyRun, type SourceContext, type SourceRun } from './types';

export const WEBZ_LITE = 'https://api.webz.io/newsApiLite';
/** Nombre maximal de posts lus par réponse. */
const MAX_POSTS = 100;

/** Article Webz.io News API Lite : analyse tolérante. */
const PostSchema = z.object({
  url: z.string().min(1),
  title: z.string().nullish(),
  text: z.string().nullish(),
  published: z.string().nullish(),
  language: z.string().nullish(),
  thread: z.object({ site: z.string().nullish(), title: z.string().nullish() }).nullish(),
});
const ResponseSchema = z.object({ posts: z.array(z.unknown()) });

export type WebzPost = z.infer<typeof PostSchema>;

/** Webz donne la langue en toutes lettres. */
const LANG_CODES: Record<string, string> = { french: 'fr', english: 'en', spanish: 'es' };

/**
 * Langue ISO 639-1 d'un post : nom connu converti, code gardé tel quel, langue de la requête si
 * absente. Une autre langue (« german ») est rendue telle quelle et `makeArticle` écarte l'article.
 */
export function webzLang(language: string | null | undefined, fallback: Lang): string {
  const l = (language ?? '').trim().toLowerCase();
  return l === '' ? fallback : (LANG_CODES[l] ?? l);
}

/** `GET /newsApiLite?token=…&q=…` ; le jeton est dans l'URL, d'où le masquage des messages d'erreur. */
export async function webzSearch(q: string, c: { token: string; fetch: HttpFetch; timeoutMs: number }): Promise<WebzPost[]> {
  const url = `${WEBZ_LITE}?${new URLSearchParams({ token: c.token, q })}`;
  return ResponseSchema.parse(await fetchJson(c.fetch, url, { timeoutMs: c.timeoutMs })).posts.slice(0, MAX_POSTS).flatMap((p) => {
    const r = PostSchema.safeParse(p);
    return r.success ? [r.data] : [];
  });
}

/**
 * Secours Webz pour les langues dont la découverte principale est sous le seuil. **R1** : le texte
 * d'un domaine qui n'est pas `full` est écarté par `makeArticle` ; aucun chapô n'est tiré du texte.
 * Les articles datés d'avant la fenêtre de collecte sont ignorés.
 */
export async function collectWebz(ctx: SourceContext, token: string, langs: Lang[]): Promise<SourceRun> {
  const cfg = ctx.config.webz;
  const run = emptyRun();
  const breaker = new Breaker();
  for (const lang of langs) {
    if (breaker.open || run.requests >= cfg.maxRequests) break;
    run.requests++;
    try {
      for (const p of await webzSearch(cfg.queries[lang], { token, fetch: ctx.fetch, timeoutMs: cfg.timeoutMs })) {
        const published = toIso(p.published);
        const verdict = windowVerdict(published, ctx.windowStart.toISOString());
        if (verdict === 'old') continue;
        const { article, discardedText } = makeArticle(
          {
            url: p.url,
            title: p.title || p.thread?.title,
            outlet: p.thread?.site,
            lang: webzLang(p.language, lang),
            publishedAt: published,
            origin: 'webz',
            text: p.text,
          },
          ctx.whitelist,
        );
        if (discardedText) run.discardedTexts++;
        if (!article) continue;
        if (verdict === 'undated') run.undated++;
        else run.candidates.push({ article });
      }
      breaker.success();
    } catch (e) {
      if (recordFailure(run, breaker, `webz ${lang}`, e)) break;
    }
  }
  return run;
}
