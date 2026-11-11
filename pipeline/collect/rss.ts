import { readFileSync } from 'node:fs';
import { XMLParser } from 'fast-xml-parser';
import { z } from 'zod';
import { LangSchema, UrlSchema } from '@daily-brief/schema';
import { lookupDomain, type Whitelist } from '../lib/whitelist';
import { makeArticle, toIso } from './article';
import { ACCEPT_FEED, decodeBody, deadline, HttpError, messageOf, readCapped, USER_AGENT, type HttpFetch } from './http';
import { mapLimit } from './limit';
import { emptyRun, type Candidate, type SourceContext, type SourceRun } from './types';

const FeedSchema = z.strictObject({ url: UrlSchema, outlet: z.string().min(1), lang: LangSchema });
const FeedsSchema = z.strictObject({ note: z.string().optional(), feeds: z.array(FeedSchema) });

export type Feed = z.infer<typeof FeedSchema>;
export type FeedItem = { title: string; link: string | null; description: string; published: string | null };

export function loadFeeds(path: string): Feed[] {
  return FeedsSchema.parse(JSON.parse(readFileSync(path, 'utf8'))).feeds;
}

/** Un flux n'est lu que sur un domaine `full` ou `feed` de la liste blanche. */
export function isReadableFeedDomain(wl: Whitelist, url: string): boolean {
  const status = lookupDomain(wl, url)?.status;
  return status === 'full' || status === 'feed';
}

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  processEntities: true,
  htmlEntities: true,
  isArray: (name) => name === 'item' || name === 'entry' || name === 'link',
});

/** Texte d'un nœud analysé (chaîne, nombre, `{ '#text' }` ou premier élément d'un tableau). */
function textOf(v: unknown): string {
  if (typeof v === 'string') return v;
  if (typeof v === 'number') return String(v);
  if (Array.isArray(v)) return textOf(v[0]);
  if (v && typeof v === 'object' && '#text' in v) return textOf((v as Record<string, unknown>)['#text']);
  return '';
}

/** Lien d'un article : texte (RSS) ou `href` du lien `alternate` ou sans `rel` (Atom). */
function linkOf(v: unknown): string | null {
  const links = Array.isArray(v) ? v : v === undefined ? [] : [v];
  for (const l of links) if (typeof l === 'string' && l.trim()) return l.trim();
  const atom = links.filter((l): l is Record<string, unknown> => !!l && typeof l === 'object');
  const best = atom.find((l) => l['@_rel'] === undefined || l['@_rel'] === 'alternate') ?? atom[0];
  const href = best?.['@_href'];
  return typeof href === 'string' && href.trim() ? href.trim() : null;
}

const RssDoc = z.object({ rss: z.object({ channel: z.object({ item: z.array(z.record(z.string(), z.unknown())).optional() }) }) });
const AtomDoc = z.object({ feed: z.object({ entry: z.array(z.record(z.string(), z.unknown())).optional() }) });

/** Articles d'un flux RSS 2.0 ou Atom ; lève si le document n'est ni l'un ni l'autre. */
export function parseFeed(xml: string): FeedItem[] {
  const doc = parser.parse(xml);
  const rss = RssDoc.safeParse(doc);
  if (rss.success) {
    return (rss.data.rss.channel.item ?? []).map((i) => ({
      title: textOf(i.title),
      link: linkOf(i.link) ?? (/^https?:/.test(textOf(i.guid)) ? textOf(i.guid) : null),
      description: textOf(i.description),
      published: textOf(i.pubDate) || textOf(i['dc:date']) || null,
    }));
  }
  const atom = AtomDoc.safeParse(doc);
  if (atom.success) {
    return (atom.data.feed.entry ?? []).map((e) => ({
      title: textOf(e.title),
      link: linkOf(e.link),
      description: textOf(e.summary),
      published: textOf(e.published) || textOf(e.updated) || null,
    }));
  }
  throw new Error('ni RSS 2.0 ni Atom');
}

/** Télécharge et analyse un flux (délai, taille bornée). */
export async function fetchFeed(url: string, c: { fetch: HttpFetch; timeoutMs: number; maxBytes: number }): Promise<FeedItem[]> {
  const res = await c.fetch(url, { signal: deadline(c.timeoutMs), headers: { accept: ACCEPT_FEED, 'user-agent': USER_AGENT } });
  if (!res.ok) throw new HttpError(res.status, url);
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
  const perFeed = await mapLimit(feeds, 4, async (feed): Promise<{ candidates: Candidate[]; error?: string }> => {
    if (!isReadableFeedDomain(ctx.whitelist, feed.url)) return { candidates: [], error: `rss ${feed.url} : domaine ni full ni feed, flux ignoré` };
    run.requests++;
    try {
      const items = await fetchFeed(feed.url, { fetch: ctx.fetch, timeoutMs: cfg.timeoutMs, maxBytes: cfg.maxBytes });
      const candidates: Candidate[] = [];
      for (const it of items) {
        if (candidates.length >= cfg.maxItemsPerFeed) break;
        if (!it.link || !isReadableFeedDomain(ctx.whitelist, it.link)) continue;
        const published = toIso(it.published);
        if (published && published < since) continue;
        const { article } = makeArticle(
          { url: it.link, title: it.title, outlet: feed.outlet, description: it.description, lang: feed.lang, publishedAt: published, origin: 'rss' },
          ctx.whitelist,
        );
        if (article) candidates.push({ article });
      }
      return { candidates };
    } catch (e) {
      return { candidates: [], error: `rss ${feed.url} : ${messageOf(e)}` };
    }
  });
  // Ordre de feeds.json, quel que soit l'ordre d'arrivée des réponses.
  for (const r of perFeed) {
    run.candidates.push(...r.candidates);
    if (r.error) run.errors.push(r.error);
  }
  return run;
}
