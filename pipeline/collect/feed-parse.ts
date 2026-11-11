import { XMLParser } from 'fast-xml-parser';
import { z } from 'zod';

export type FeedItem = { title: string; link: string | null; description: string; published: string | null };

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

/** Un élément vide (`<channel></channel>`) est lu comme une chaîne vide : il vaut un objet vide. */
const emptyAsObject = (v: unknown) => (v === '' ? {} : v);
const RssDoc = z.object({ rss: z.preprocess(emptyAsObject, z.object({ channel: z.preprocess(emptyAsObject, z.object({ item: z.array(z.unknown()).optional() })) })) });
const AtomDoc = z.object({ feed: z.preprocess(emptyAsObject, z.object({ entry: z.array(z.unknown()).optional() })) });

/** Seuls les objets sont des articles : `<item></item>` (chaîne vide) ou `<item>texte</item>` sont ignorés. */
const plainObjects = (v: unknown[] | undefined): Record<string, unknown>[] =>
  (v ?? []).filter((x): x is Record<string, unknown> => !!x && typeof x === 'object' && !Array.isArray(x));

/** Articles d'un flux RSS 2.0 ou Atom ; lève si le document n'est ni l'un ni l'autre. */
export function parseFeed(xml: string): FeedItem[] {
  const doc = parser.parse(xml);
  const rss = RssDoc.safeParse(doc);
  if (rss.success) {
    return plainObjects(rss.data.rss.channel.item).map((i) => ({
      title: textOf(i.title),
      link: linkOf(i.link) ?? (/^https?:/.test(textOf(i.guid)) ? textOf(i.guid) : null),
      description: textOf(i.description),
      published: textOf(i.pubDate) || textOf(i['dc:date']) || null,
    }));
  }
  const atom = AtomDoc.safeParse(doc);
  if (atom.success) {
    return plainObjects(atom.data.feed.entry).map((e) => ({
      title: textOf(e.title),
      link: linkOf(e.link),
      description: textOf(e.summary),
      published: textOf(e.published) || textOf(e.updated) || null,
    }));
  }
  throw new Error('ni RSS 2.0 ni Atom');
}
