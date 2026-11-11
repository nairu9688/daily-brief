import { describe, expect, it } from 'vitest';
import { canRequestText, collectExa, EXA_SEARCH, exaSearch } from '../../collect/exa';
import { loadWhitelist } from '../../lib/whitelist';
import { WHITELIST_PATH } from '../helpers';
import { apiFixture, NOW, testContext } from './source-context';
import { fakeHttp } from './fake-http';

const KEY = 'exa-SECRET-456';
const wl = loadWhitelist(WHITELIST_PATH);

describe('R1 : texte Exa', () => {
  it('ne demande le texte que pour des domaines tous full', () => {
    expect(canRequestText(wl, ['fr.euronews.com', 'sudradio.fr'])).toBe(true);
    expect(canRequestText(wl, ['fr.euronews.com', 'lemonde.fr'])).toBe(false);
    expect(canRequestText(wl, ['npr.org'])).toBe(false);
    expect(canRequestText(wl, ['inconnu.example'])).toBe(false);
    expect(canRequestText(wl, [])).toBe(false);
    expect(canRequestText(wl, undefined)).toBe(false);
  });

  it('envoie contents.text seulement avec des domaines full', async () => {
    const { fetch, calls } = fakeHttp({ [EXA_SEARCH]: { json: { results: [] } } });
    const c = { apiKey: KEY, fetch, timeoutMs: 1000, whitelist: wl };
    await exaSearch({ query: 'q', startPublishedDate: NOW, numResults: 5, includeDomains: ['sudradio.fr'] }, c);
    await exaSearch({ query: 'q', startPublishedDate: NOW, numResults: 5, includeDomains: ['sudradio.fr', 'lefigaro.fr'] }, c);
    await exaSearch({ query: 'q', startPublishedDate: NOW, numResults: 5 }, c);
    const bodies = calls.map((x) => JSON.parse(x.body!));
    expect(bodies[0]).toEqual({ query: 'q', category: 'news', startPublishedDate: '2026-11-06T04:13:00.000Z', numResults: 5, includeDomains: ['sudradio.fr'], contents: { text: true } });
    expect(bodies[1].contents).toBeUndefined();
    expect(bodies[2]).toEqual({ query: 'q', category: 'news', startPublishedDate: '2026-11-06T04:13:00.000Z', numResults: 5 });
    expect(calls[0]).toMatchObject({ method: 'POST', headers: { 'x-api-key': KEY, 'content-type': 'application/json' } });
  });
});

describe('collectExa', () => {
  it('garde le texte des domaines full, écarte celui des autres et ignore un résultat mal formé', async () => {
    const { fetch } = fakeHttp({ [EXA_SEARCH]: { json: apiFixture('exa-search.json') } });
    const ctx = testContext(fetch, (c) => (c.exa.maxRequests = 1));
    const run = await collectExa(ctx, KEY, { broad: false });
    expect(run.requests).toBe(1);
    const byOutlet = Object.fromEntries(run.candidates.map((c) => [c.article.outlet, c.article]));
    expect(Object.keys(byOutlet)).toEqual(['euronews.com', 'sudradio.fr', 'lemonde.fr']);
    expect(byOutlet['euronews.com'].text).toContain('« Nous ne repartirons pas sans un chiffre »');
    expect(byOutlet['euronews.com'].lang).toBe('fr');
    expect(byOutlet['lemonde.fr'].text).toBeNull();
    expect(run.discardedTexts).toBe(1);
  });

  it('en recherche ouverte (Exa principal), ne demande jamais le texte et n’en garde aucun', async () => {
    const { fetch, calls } = fakeHttp({ [EXA_SEARCH]: { json: apiFixture('exa-search.json') } });
    const ctx = testContext(fetch, (c) => {
      c.exa.fullDomains.fr = [];
    });
    const run = await collectExa(ctx, KEY, { broad: true });
    const fr = calls.slice(0, 9).map((x) => JSON.parse(x.body!));
    expect(fr.every((b) => b.contents === undefined && b.includeDomains === undefined)).toBe(true);
    expect(run.candidates.filter((c) => c.article.lang === 'fr').every((c) => c.article.text === null)).toBe(true);
  });

  it('respecte le plafond de requêtes : 9 rubriques × 3 langues × 2 recherches = 54 ≤ 60', async () => {
    const { fetch, calls } = fakeHttp({ [EXA_SEARCH]: { json: { results: [] } } });
    const run = await collectExa(testContext(fetch), KEY, { broad: true });
    expect(calls).toHaveLength(54);
    const capped = fakeHttp({ [EXA_SEARCH]: { json: { results: [] } } });
    await collectExa(testContext(capped.fetch, (c) => (c.exa.maxRequests = 10)), KEY, { broad: true });
    expect(capped.calls).toHaveLength(10);
    expect(run.errors).toEqual([]);
  });

  it('se coupe sur un 401, sans la clé dans les erreurs', async () => {
    const { fetch, calls } = fakeHttp({ [EXA_SEARCH]: { status: 401, json: { error: `invalid key ${KEY}` } } });
    const run = await collectExa(testContext(fetch), KEY, { broad: true });
    expect(calls).toHaveLength(1);
    expect(run.stoppedBy).toBe('HTTP 401');
    expect(JSON.stringify(run)).not.toContain(KEY);
  });
});
