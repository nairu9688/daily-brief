import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ACCEPT_FEED, USER_AGENT } from '../../collect/http';
import { collectRss, fetchFeed, isReadableFeedDomain, loadFeeds, parseFeed, type Feed } from '../../collect/rss';
import { lookupDomain, loadWhitelist } from '../../lib/whitelist';
import { repoPath, WHITELIST_PATH } from '../helpers';
import { FEEDS_PATH, testContext } from './source-context';
import { fakeHttp } from './fake-http';

const wl = loadWhitelist(WHITELIST_PATH);
const xml = (name: string) => readFileSync(repoPath(`fixtures/api/${name}`), 'utf8');
const RSS_TYPE = 'application/rss+xml; charset=utf-8';

describe('feeds.json', () => {
  it('ne liste que des domaines full ou feed de la liste blanche', () => {
    const feeds = loadFeeds(FEEDS_PATH);
    expect(feeds.length).toBeGreaterThan(0);
    for (const f of feeds) expect(lookupDomain(wl, f.url)?.status, f.url).toMatch(/^(full|feed)$/);
    expect(feeds.every((f) => isReadableFeedDomain(wl, f.url))).toBe(true);
    expect(new Set(feeds.map((f) => f.lang))).toEqual(new Set(['fr', 'en', 'es']));
  });
});

describe('parseFeed', () => {
  it('lit le RSS 2.0 : CDATA, entités, guid en lien de secours', () => {
    const items = parseFeed(xml('rss-euronews-fr.xml'));
    expect(items).toHaveLength(5);
    expect(items[0]).toEqual({
      title: "L'UE et le Royaume-Uni veulent relier leurs marchés du carbone",
      link: 'https://fr.euronews.com/2026/11/06/lue-et-le-royaume-uni-veulent-relier-leurs-marches-du-carbone?utm_source=rss',
      description: "<p>L'accord pourrait éviter aux industriels des taxes carbone aux frontières.</p>",
      published: 'Fri, 06 Nov 2026 04:59:02 +0100',
    });
    expect(items[1].title).toBe('Grève & mobilisation : l’intersyndicale se réunit');
    expect(items[1].link).toBe('https://fr.euronews.com/2026/11/06/greve-et-mobilisation');
    expect(items[4].link).toBeNull();
  });

  it('lit l’Atom : lien alternate, date de publication ou de mise à jour', () => {
    const items = parseFeed(xml('atom-elsalto.xml'));
    expect(items.map((i) => i.link)).toEqual(['https://www.elsaltodiario.com/vivienda/tope-alquileres-temporada', 'https://www.elsaltodiario.com/opinion/entrada-sin-fecha']);
    expect(items[0].published).toBe('2026-11-06T03:30:00Z');
    expect(items[1].published).toBeNull();
  });

  it('tolère un canal vide, un item vide ou indigeste, un flux Atom vide', () => {
    expect(parseFeed('<rss version="2.0"><channel></channel></rss>')).toEqual([]);
    expect(parseFeed('<feed xmlns="http://www.w3.org/2005/Atom"></feed>')).toEqual([]);
    const items = parseFeed(
      '<rss><channel><item></item><item>junk</item><item><title>Bon</title><link>https://fr.euronews.com/a</link></item></channel></rss>',
    );
    expect(items.map((i) => i.title)).toContain('Bon');
    expect(items.filter((i) => i.link === 'https://fr.euronews.com/a')).toHaveLength(1);
  });

  it('lève sur un document qui n’est pas un flux', () => {
    expect(() => parseFeed('<html><body>Erreur</body></html>')).toThrow('ni RSS 2.0 ni Atom');
  });

  it('borne l’expansion quadratique des entités : l’analyse échoue', () => {
    const big = 'a'.repeat(1000);
    const refs = '&big;'.repeat(200_000);
    const xml = `<?xml version="1.0"?><!DOCTYPE x [<!ENTITY big "${big}">]><rss><channel><item><title>${refs}</title><link>https://fr.euronews.com/x</link></item></channel></rss>`;
    expect(() => parseFeed(xml)).toThrow();
  });

  it('lit un flux réaliste de 25 articles aux entités ordinaires (&amp;, &#8217;, &lt;p&gt;)', () => {
    const item = (i: number) =>
      `<item><title>Titre &amp; suite &#8217;${i}&#8217; &amp; fin &amp; plus${" &amp;".repeat(8)}</title><link>https://fr.euronews.com/2026/11/06/a${i}</link>` +
      `<description>&lt;p&gt;Chapô &amp; détails &#8211; l&#8217;essentiel&lt;/p&gt;</description><pubDate>Fri, 06 Nov 2026 03:00:00 +0100</pubDate></item>`;
    const xml = `<?xml version="1.0"?><rss version="2.0"><channel>${Array.from({ length: 25 }, (_, i) => item(i)).join('')}</channel></rss>`;
    expect((xml.match(/&/g) ?? []).length).toBeGreaterThanOrEqual(500);
    const items = parseFeed(xml);
    expect(items).toHaveLength(25);
    expect(items[0].title).toBe('Titre & suite ’0’ & fin & plus' + ' &'.repeat(8));
    expect(items[24].description).toBe('<p>Chapô & détails – l’essentiel</p>');
  });

  it('garde les valeurs en texte : « 1e3 » et « 007 » ne deviennent pas des nombres', () => {
    const items = parseFeed('<rss><channel><item><title>1e3</title><description>007</description><link>https://fr.euronews.com/a</link></item></channel></rss>');
    expect(items[0].title).toBe('1e3');
    expect(items[0].description).toBe('007');
  });

  it('liens Atom : une pièce jointe seule ne donne pas de lien ; le texte d’un lien à attributs est lu', () => {
    const atom = (links: string) => `<feed xmlns="http://www.w3.org/2005/Atom"><entry><title>T</title>${links}<published>2026-11-06T03:30:00Z</published></entry></feed>`;
    expect(parseFeed(atom('<link rel="enclosure" href="https://static.elsaltodiario.com/a.jpg"/>'))[0].link).toBeNull();
    expect(parseFeed(atom('<link rel="enclosure" href="https://static.x/a.jpg"/><link href="https://www.elsaltodiario.com/a"/>'))[0].link).toBe('https://www.elsaltodiario.com/a');
    const rss = '<rss><channel><item><title>T</title><link type="text/html">https://fr.euronews.com/a</link></item></channel></rss>';
    expect(parseFeed(rss)[0].link).toBe('https://fr.euronews.com/a');
  });
});

describe('collectRss', () => {
  const feeds: Feed[] = [
    { url: 'https://fr.euronews.com/rss', outlet: 'Euronews', lang: 'fr' },
    { url: 'https://www.elsaltodiario.com/general/feed', outlet: 'El Salto', lang: 'es' },
  ];

  it('garde les articles récents des domaines full/feed, sans texte', async () => {
    const { fetch, calls } = fakeHttp({
      'https://fr.euronews.com/rss': { body: xml('rss-euronews-fr.xml'), type: RSS_TYPE },
      'https://www.elsaltodiario.com/general/feed': { body: xml('atom-elsalto.xml'), type: 'application/atom+xml' },
    });
    const run = await collectRss(testContext(fetch), feeds);
    expect(run.requests).toBe(2);
    expect(calls[0].headers).toEqual({ accept: ACCEPT_FEED, 'user-agent': USER_AGENT });
    expect(run.errors).toEqual([]);
    expect(run.candidates.map((c) => c.article.url)).toEqual([
      'https://fr.euronews.com/2026/11/06/lue-et-le-royaume-uni-veulent-relier-leurs-marches-du-carbone',
      'https://fr.euronews.com/2026/11/06/greve-et-mobilisation',
      'https://elsaltodiario.com/vivienda/tope-alquileres-temporada',
    ]);
    const first = run.candidates[0].article;
    expect(first).toMatchObject({ outlet: 'Euronews', lang: 'fr', origin: 'rss', text: null, publishedAt: '2026-11-06T03:59:02.000Z' });
    expect(first.description).toBe("L'accord pourrait éviter aux industriels des taxes carbone aux frontières.");
    expect(run.candidates.every((c) => c.article.text === null)).toBe(true);
  });

  it('un flux en échec, trop lourd ou hors liste blanche n’empêche pas les autres', async () => {
    const { fetch, calls } = fakeHttp({
      'https://fr.euronews.com/rss': { status: 503, body: '' },
      'https://www.elsaltodiario.com/general/feed': { body: xml('atom-elsalto.xml'), headers: { 'content-length': '99999999' } },
      'https://es.euronews.com/rss': { body: xml('rss-euronews-fr.xml').replaceAll('fr.euronews.com', 'es.euronews.com'), type: RSS_TYPE },
    });
    const run = await collectRss(testContext(fetch), [
      ...feeds,
      { url: 'https://www.lemonde.fr/rss/une.xml', outlet: 'Le Monde', lang: 'fr' },
      { url: 'https://es.euronews.com/rss', outlet: 'Euronews', lang: 'es' },
    ]);
    expect(calls.map((c) => c.url)).not.toContain('https://www.lemonde.fr/rss/une.xml');
    expect(run.errors).toEqual([
      'rss https://fr.euronews.com/rss : HTTP 503 (https://fr.euronews.com/rss)',
      'rss https://www.elsaltodiario.com/general/feed : corps trop lourd (99999999 octets)',
      'rss https://www.lemonde.fr/rss/une.xml : domaine ni full ni feed, flux ignoré',
    ]);
    expect(run.candidates).toHaveLength(2);
  });

  it('borne le nombre d’articles par flux et ne reste pas bloqué sur un flux muet', async () => {
    const { fetch } = fakeHttp({ 'https://fr.euronews.com/rss': { body: xml('rss-euronews-fr.xml'), type: RSS_TYPE }, 'https://www.elsaltodiario.com/': { hang: true } });
    const run = await collectRss(
      testContext(fetch, (c) => {
        c.rss.maxItemsPerFeed = 1;
        c.rss.timeoutMs = 20;
      }),
      feeds,
    );
    expect(run.candidates).toHaveLength(1);
    expect(run.errors).toEqual(['rss https://www.elsaltodiario.com/general/feed : The operation was aborted due to timeout']);
  });

  const one: Feed[] = [feeds[0]];
  const feedXml = (date: string | null, link = 'https://fr.euronews.com/2026/11/06/a') =>
    `<rss><channel><item><title>T</title><link>${link}</link>${date ? `<pubDate>${date}</pubDate>` : ''}</item></channel></rss>`;

  it('lit les fuseaux CET (+01:00) et CEST (+02:00)', async () => {
    const run = async (date: string) => {
      const { fetch } = fakeHttp({ 'https://fr.euronews.com/rss': { body: feedXml(date), type: RSS_TYPE } });
      return (await collectRss(testContext(fetch), one)).candidates[0]?.article.publishedAt;
    };
    expect(await run('Fri, 06 Nov 2026 05:00:00 CET')).toBe('2026-11-06T04:00:00.000Z');
    expect(await run('Fri, 06 Nov 2026 05:00:00 CEST')).toBe('2026-11-06T03:00:00.000Z');
    expect(await run('Fri, 06 Nov 2026 05:00:00 GMT')).toBe('2026-11-06T05:00:00.000Z');
    expect(await run('Fri, 06 Nov 2026 05:00:00 BST')).toBe('2026-11-06T04:00:00.000Z');
  });

  it('écarte et compte un article sans date', async () => {
    const { fetch } = fakeHttp({ 'https://fr.euronews.com/rss': { body: feedXml(null), type: RSS_TYPE } });
    const run = await collectRss(testContext(fetch), one);
    expect(run.candidates).toEqual([]);
    expect(run.undated).toBe(1);
  });

  it('annule le corps d’une réponse non 2xx', async () => {
    let cancelled = 0;
    const body = new ReadableStream<Uint8Array>({ cancel() { cancelled++; } });
    const res = { ok: false, status: 500, headers: { get: () => null }, json: async () => null, arrayBuffer: async () => new ArrayBuffer(0), body };
    await expect(fetchFeed('https://fr.euronews.com/rss', { fetch: async () => res, timeoutMs: 100, maxBytes: 1000 })).rejects.toThrow('HTTP 500');
    expect(cancelled).toBe(1);
  });
});
