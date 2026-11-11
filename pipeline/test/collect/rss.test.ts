import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ACCEPT_FEED, USER_AGENT } from '../../collect/http';
import { collectRss, isReadableFeedDomain, loadFeeds, parseFeed, type Feed } from '../../collect/rss';
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

  it('lève sur un document qui n’est pas un flux, sans développer les entités en chaîne', () => {
    expect(() => parseFeed('<html><body>Erreur</body></html>')).toThrow('ni RSS 2.0 ni Atom');
    const bomb =
      '<?xml version="1.0"?><!DOCTYPE x [<!ENTITY a "aaaaaaaaaa"><!ENTITY b "&a;&a;&a;&a;&a;&a;&a;&a;&a;&a;"><!ENTITY c "&b;&b;&b;&b;&b;&b;&b;&b;&b;&b;">]>' +
      '<rss><channel><item><title>&c;</title><link>https://fr.euronews.com/x</link></item></channel></rss>';
    expect(parseFeed(bomb)[0].title.length).toBeLessThan(1000);
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
      'https://elsaltodiario.com/opinion/entrada-sin-fecha',
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
});
