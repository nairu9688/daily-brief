import { readFileSync } from 'node:fs';
import { z } from 'zod';
import { LangSchema, UrlSchema } from '@daily-brief/schema';
import { lookupDomain, type Whitelist } from '../lib/whitelist';
import { makeArticle, toIso, windowVerdict } from './article';
import { parseFeed, type FeedItem } from './feed-parse';
import { ACCEPT_FEED, decodeBody, deadline, HttpError, messageOf, readCapped, USER_AGENT, type HttpFetch } from './http';
import { mapLimit } from './limit';
import { emptyRun, type Candidate, type SourceContext, type SourceRun } from './types';

const FeedSchema = z.strictObject({ url: UrlSchema, outlet: z.string().min(1), lang: LangSchema });
const FeedsSchema = z.strictObject({ note: z.string().optional(), feeds: z.array(FeedSchema) });

export type Feed = z.infer<typeof FeedSchema>;
export { parseFeed, type FeedItem };

export function loadFeeds(path: string): Feed[] {
  return FeedsSchema.parse(JSON.parse(readFileSync(path, 'utf8'))).feeds;
}

/** Un flux n'est lu que sur un domaine `full` ou `feed` de la liste blanche. */
export function isReadableFeedDomain(wl: Whitelist, url: string): boolean {
  const status = lookupDomain(wl, url)?.status;
  return status === 'full' || status === 'feed';
}

/** Télécharge et analyse un flux (délai, taille bornée). */
export async function fetchFeed(url: string, c: { fetch: HttpFetch; timeoutMs: number; maxBytes: number }): Promise<FeedItem[]> {
  const res = await c.fetch(url, { signal: deadline(c.timeoutMs), headers: { accept: ACCEPT_FEED, 'user-agent': USER_AGENT } });
  if (!res.ok) {
    await res.body?.cancel().catch(() => {});
    throw new HttpError(res.status, url);
  }
  return parseFeed(decodeBody(await readCapped(res, c.maxBytes), res.headers.get('content-type')));
}

/**
 * Lit les flux de `feeds.json` (4 à la fois). Seuls les liens vers un domaine `full` ou `feed`
 * sont gardés, sans texte : les métadonnées seulement. Articles datés d'avant la fenêtre ignorés,
 * `maxItemsPerFeed` au plus par flux. Un flux en échec n'arrête pas les autres.
 */
export async function collectRss(ctx: SourceContext, feeds: Feed[]): Promise<SourceRun> {
  const cfg = ctx.config.rss;
  const run = emptyRun();
  const since = ctx.windowStart.toISOString();
  const perFeed = await mapLimit(feeds, 4, async (feed): Promise<{ candidates: Candidate[]; undated?: number; error?: string }> => {
    if (!isReadableFeedDomain(ctx.whitelist, feed.url)) return { candidates: [], error: `rss ${feed.url} : domaine ni full ni feed, flux ignoré` };
    run.requests++;
    try {
      const items = await fetchFeed(feed.url, { fetch: ctx.fetch, timeoutMs: cfg.timeoutMs, maxBytes: cfg.maxBytes });
      const candidates: Candidate[] = [];
      let undated = 0;
      for (const it of items) {
        if (candidates.length >= cfg.maxItemsPerFeed) break;
        if (!it.link || !isReadableFeedDomain(ctx.whitelist, it.link)) continue;
        const published = toIso(it.published);
        const verdict = windowVerdict(published, since);
        if (verdict === 'old') continue;
        const { article } = makeArticle(
          { url: it.link, title: it.title, outlet: feed.outlet, description: it.description, lang: feed.lang, publishedAt: published, origin: 'rss' },
          ctx.whitelist,
        );
        if (!article) continue;
        if (verdict === 'undated') undated++;
        else candidates.push({ article });
      }
      return { candidates, undated };
    } catch (e) {
      return { candidates: [], error: `rss ${feed.url} : ${messageOf(e)}` };
    }
  });
  // Ordre de feeds.json, quel que soit l'ordre d'arrivée des réponses.
  for (const r of perFeed) {
    run.candidates.push(...r.candidates);
    run.undated += r.undated ?? 0;
    if (r.error) run.errors.push(r.error);
  }
  return run;
}
