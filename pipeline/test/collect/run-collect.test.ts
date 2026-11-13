import { existsSync, mkdirSync, mkdtempSync, readFileSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { RawCollectionSchema } from '@daily-brief/schema';
import { EXA_SEARCH } from '../../collect/exa';
import type { HttpFetch } from '../../collect/http';
import { runCollect, type CollectKeys } from '../../collect/run-collect';
import { THENEWSAPI_BASE } from '../../collect/thenewsapi';
import { WEBZ_LITE } from '../../collect/webz';
import { canReadFull, loadWhitelist } from '../../lib/whitelist';
import { repoPath, WHITELIST_PATH } from '../helpers';
import { apiFixture, CONFIG_PATH, FEEDS_PATH, NOW, RUBRIQUES_PATH } from './source-context';
import { fakeHttp, type Reply } from './fake-http';

const DAY = '2026-11-06';
const KEYS: CollectKeys = { thenewsapi: 'tna-SECRET-123', exa: 'exa-SECRET-456', webz: 'WEBZ-SECRET-789' };
const PAGE = readFileSync(repoPath('fixtures/api/article-euronews.html'), 'utf8');
const RSS = readFileSync(repoPath('fixtures/api/rss-euronews-fr.xml'), 'utf8');
const wl = loadWhitelist(WHITELIST_PATH);

/** Réseau simulé : une réponse par source, les pages des domaines full, 404 ailleurs. */
function network(overrides: Record<string, Reply | ((url: string) => Reply)> = {}) {
  return fakeHttp({
    [`${THENEWSAPI_BASE}/top`]: (url) =>
      url.includes('language=fr') && url.includes('categories=politics&') && !url.includes('page=') ? { json: apiFixture('thenewsapi-top.json') } : { json: { data: [] } },
    [`${THENEWSAPI_BASE}/similar/`]: { json: apiFixture('thenewsapi-similar.json') },
    [EXA_SEARCH]: { json: apiFixture('exa-search.json') },
    [WEBZ_LITE]: { json: apiFixture('webz-news-lite.json') },
    'https://fr.euronews.com/rss': { body: RSS, type: 'application/rss+xml' },
    'https://fr.euronews.com/20': { body: PAGE },
    'https://sudradio.fr/': { body: PAGE },
    'https://eldiario.es/': { body: PAGE },
    ...overrides,
  });
}

function setup(configPatch?: (c: any) => void) {
  const outDir = mkdtempSync(join(tmpdir(), 'collect-'));
  let configPath = CONFIG_PATH;
  if (configPatch) {
    const c = JSON.parse(readFileSync(CONFIG_PATH, 'utf8'));
    configPatch(c);
    configPath = join(outDir, 'collect.json');
    writeFileSync(configPath, JSON.stringify(c));
  }
  const run = (fetch: HttpFetch, keys: CollectKeys = KEYS, date = DAY) =>
    runCollect({ outDir, date, keys, fetch, now: NOW, configPath, rubriquesPath: RUBRIQUES_PATH, feedsPath: FEEDS_PATH, whitelistPath: WHITELIST_PATH });
  return { outDir, dayDir: join(outDir, DAY), run };
}

const read = (p: string) => JSON.parse(readFileSync(p, 'utf8'));
const noSecret = (text: string) => {
  for (const k of Object.values(KEYS)) expect(text).not.toContain(k);
};

describe('runCollect', () => {
  it('collecte toutes les sources, écrit raw.json et le rapport, texte seulement pour les domaines full', async () => {
    const { dayDir, run } = setup();
    const net = network();
    const r = await run(net.fetch);
    expect(r.exitCode).toBe(0);
    const raw = RawCollectionSchema.parse(read(join(dayDir, 'raw.json')));
    expect(raw).toMatchObject({ date: DAY, collectedAt: '2026-11-06T04:13:00.000Z' });
    expect(raw.articles.length).toBe(r.report.articles);
    for (const a of raw.articles) if (a.text !== null) expect(canReadFull(wl, a.url), a.url).toBe(true);
    expect(raw.articles.find((a) => a.url.includes('lemonde.fr/planete'))!.text).toBeNull();
    expect(raw.articles.find((a) => a.url.includes('elpais.com'))!.text).toBeNull();
    const report = read(join(dayDir, 'collect-report.json'));
    expect(report).toMatchObject({
      date: DAY,
      exitCode: 0,
      primary: 'thenewsapi',
      sources: { thenewsapi: { used: true, requests: 30 }, exa: { used: true, requests: 27 }, rss: { used: true, requests: 13 }, webz: { used: true, requests: 3 } },
      budget: { thenewsapi: { dailyCap: 90, usedBefore: 0, usedThisRun: 30, perBucket: { fr: 10, en: 9, es: 9, similar: 2 } }, exa: { requests: 27, max: 60 }, webz: { requests: 3, max: 3 } },
    });
    expect(report.perLang.fr.light).toBe(true);
    expect(report.perLang.fr.fullTexts).toBe(raw.articles.filter((a) => a.lang === 'fr' && a.text).length);
    expect(report.discardedTexts).toBeGreaterThanOrEqual(2);
    noSecret(readFileSync(join(dayDir, 'raw.json'), 'utf8') + readFileSync(join(dayDir, 'collect-report.json'), 'utf8'));
  });

  it('sans clé : chaque source à clé est ignorée avec un avertissement, aucun appel aux API, le RSS suffit', async () => {
    const { dayDir, run } = setup();
    const net = network();
    const r = await run(net.fetch, {});
    expect(r.exitCode).toBe(0);
    expect(net.calls.some((c) => /api\.(thenewsapi|exa|webz)/.test(c.url))).toBe(false);
    expect(r.report.issues.filter((i) => i.level === 'warning' && /absente/.test(i.message)).map((i) => i.source)).toEqual(['thenewsapi', 'exa', 'webz']);
    expect(read(join(dayDir, 'raw.json')).articles.every((a: { origin: string }) => a.origin === 'rss')).toBe(true);
  });

  it('rien de collecté : code 2, ancien raw.json supprimé, rapport réécrit', async () => {
    const { dayDir, run } = setup();
    mkdirSync(dayDir, { recursive: true });
    writeFileSync(join(dayDir, 'raw.json'), '{"périmé":true}');
    writeFileSync(join(dayDir, 'collect-report.json'), '{"exitCode":0}');
    const r = await run(fakeHttp({}).fetch, {});
    expect(r.exitCode).toBe(2);
    expect(existsSync(join(dayDir, 'raw.json'))).toBe(false);
    expect(read(join(dayDir, 'collect-report.json'))).toMatchObject({ exitCode: 2, articles: 0 });
  });

  it('une source en panne réseau n’arrête pas les autres et aucun secret ne fuit dans les messages', async () => {
    const { dayDir, run } = setup();
    const leak = (url: string): Reply => ({ error: new Error(`connect ECONNREFUSED ${url}`) });
    const net = network({ [`${THENEWSAPI_BASE}/top`]: leak, [WEBZ_LITE]: leak, [EXA_SEARCH]: { error: new Error(`refus pour la clé ${KEYS.exa}`) } });
    const r = await run(net.fetch);
    expect(r.exitCode).toBe(0);
    expect(r.report.sources.thenewsapi.errors).toHaveLength(3);
    expect(r.report.sources.webz.errors).toHaveLength(3);
    expect(r.report.sources.exa.errors).toHaveLength(3);
    expect(r.report.sources.rss.candidates).toBeGreaterThan(0);
    noSecret(readFileSync(join(dayDir, 'raw.json'), 'utf8') + readFileSync(join(dayDir, 'collect-report.json'), 'utf8'));
    expect(JSON.stringify(r.report)).toContain('api_token=***');
  });

  it('Exa en découverte principale : TheNewsAPI n’est pas appelée, Exa cherche aussi sans restriction de domaine', async () => {
    const { run } = setup((c) => (c.primary = 'exa'));
    const net = network();
    const r = await run(net.fetch);
    expect(r.report.primary).toBe('exa');
    expect(net.calls.some((c) => c.url.startsWith(THENEWSAPI_BASE))).toBe(false);
    const bodies = net.calls.filter((c) => c.url === EXA_SEARCH).map((c) => JSON.parse(c.body!));
    expect(bodies).toHaveLength(54);
    expect(bodies.filter((b) => b.includeDomains === undefined).every((b) => (b.contents as { text: unknown }).text === false)).toBe(true);
  });

  it('le plafond de 90 requêtes TheNewsAPI vaut pour la journée : une relance reprend le compte', async () => {
    const { outDir, run } = setup();
    await run(network().fetch);
    expect(read(join(outDir, 'thenewsapi-usage.json'))).toEqual({ day: '2026-11-06', used: 30 });
    writeFileSync(join(outDir, 'thenewsapi-usage.json'), JSON.stringify({ day: '2026-11-06', used: 90 }));
    const net = network();
    const r = await run(net.fetch);
    expect(net.calls.some((c) => c.url.startsWith(THENEWSAPI_BASE))).toBe(false);
    expect(r.report.budget.thenewsapi).toMatchObject({ usedBefore: 90, usedThisRun: 0 });
  });

  it('chaque requête TheNewsAPI est inscrite au registre aussitôt, même si le passage est interrompu avant l’écriture finale', async () => {
    const { outDir, run } = setup();
    const ledger = join(outDir, 'thenewsapi-usage.json');
    writeFileSync(ledger, JSON.stringify({ day: '2026-11-06', used: 10 }));
    const seen: number[] = [];
    const base = network();
    const fetch: HttpFetch = async (url, init) => {
      if (url.startsWith(THENEWSAPI_BASE)) seen.push(read(ledger).used);
      return base.fetch(url, init);
    };
    const r = await run(fetch);
    const calls = base.calls.filter((c) => c.url.startsWith(THENEWSAPI_BASE)).length;
    expect(calls).toBe(30);
    // Au moment de chaque appel, la requête qu'il consomme est déjà comptée.
    expect(seen).toEqual(Array.from({ length: calls }, (_, i) => 11 + i));
    expect(read(ledger)).toEqual({ day: '2026-11-06', used: 10 + calls });
    expect(r.report.budget.thenewsapi).toMatchObject({ usedBefore: 10, usedThisRun: calls });
  });

  it('un registre illisible d’un jour antérieur repart de zéro : avertissement dans collect-report.json, registre réécrit', async () => {
    const { outDir, dayDir, run } = setup();
    const ledger = join(outDir, 'thenewsapi-usage.json');
    writeFileSync(ledger, '{tronqué');
    const old = new Date('2026-11-01T00:00:00Z');
    utimesSync(ledger, old, old);
    const r = await run(network().fetch);
    expect(r.exitCode).toBe(0);
    const report = read(join(dayDir, 'collect-report.json'));
    expect(report.issues).toContainEqual(expect.objectContaining({ level: 'warning', source: 'thenewsapi', message: expect.stringContaining('compte remis à zéro') }));
    expect(report.issues.some((i: { level: string; source?: string }) => i.level === 'error' && i.source === 'thenewsapi')).toBe(false);
    expect(report.budget.thenewsapi).toMatchObject({ usedBefore: 0, usedThisRun: 30 });
    expect(read(ledger)).toEqual({ day: '2026-11-06', used: 30 });
  });

  it('un registre impossible à écrire refuse la requête TheNewsAPI sans arrêter les autres sources', async () => {
    const { outDir, dayDir, run } = setup();
    mkdirSync(join(outDir, 'thenewsapi-usage.json.tmp'));
    const net = network();
    const r = await run(net.fetch);
    expect(r.exitCode).toBe(0);
    expect(net.calls.some((c) => c.url.startsWith(THENEWSAPI_BASE))).toBe(false);
    expect(net.calls.some((c) => c.url === EXA_SEARCH)).toBe(true);
    expect(net.calls.some((c) => c.url.startsWith('https://fr.euronews.com/rss'))).toBe(true);
    expect(r.report.sources.rss.used).toBe(true);
    expect(r.report.issues).toContainEqual(expect.objectContaining({ level: 'error', source: 'thenewsapi', message: expect.stringContaining('registre d’usage non écrit') }));
    expect(read(join(dayDir, 'collect-report.json')).exitCode).toBe(0);
  });

  it('le registre ne recule jamais : un compte porté à 80 pendant le passage reste au moins à 80', async () => {
    const { outDir, run } = setup();
    const ledger = join(outDir, 'thenewsapi-usage.json');
    const base = network();
    const fetch: HttpFetch = async (url, init) => {
      if (url.startsWith(THENEWSAPI_BASE)) writeFileSync(ledger, JSON.stringify({ day: '2026-11-06', used: 80 }));
      return base.fetch(url, init);
    };
    await run(fetch);
    expect(read(ledger).used).toBeGreaterThanOrEqual(80);
  });

  it('le rapport reste un JSON valide et sans secret même si un message cite une URL avec un guillemet', async () => {
    const { dayDir, run } = setup();
    const net = network({
      [WEBZ_LITE]: (url) => ({ error: new Error(`refus ${url} &key=1" fin ?token=${KEYS.webz}"`) }),
    });
    await run(net.fetch);
    const text = readFileSync(join(dayDir, 'collect-report.json'), 'utf8');
    expect(() => JSON.parse(text)).not.toThrow();
    noSecret(text);
    const body = network({ [WEBZ_LITE]: { body: '&key=1"', type: 'text/plain' } });
    await setup().run(body.fetch);
  });

  it('refuse une date invalide sans rien écrire, et une configuration invalide avec un rapport', async () => {
    const { outDir, run } = setup();
    const bad = await run(fakeHttp({}).fetch, KEYS, '../2026-13-45');
    expect(bad.exitCode).toBe(2);
    expect(existsSync(join(outDir, '2026-13-45'))).toBe(false);
    const broken = setup((c) => (c.thenewsapi.budget.total = 120));
    const r = await broken.run(fakeHttp({}).fetch);
    expect(r.exitCode).toBe(2);
    expect(read(join(broken.dayDir, 'collect-report.json')).issues[0].message).toMatch(/^configuration illisible/);
  });
});
