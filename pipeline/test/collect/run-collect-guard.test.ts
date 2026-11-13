import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { runCollect } from '../../collect/run-collect';
import { WHITELIST_PATH, repoPath } from '../helpers';
import { CONFIG_PATH, FEEDS_PATH, NOW, RUBRIQUES_PATH } from './source-context';
import { fakeHttp } from './fake-http';

vi.mock('../../collect/exa', async (orig) => ({
  ...(await orig<typeof import('../../collect/exa')>()),
  collectExa: async () => {
    throw new TypeError('bogue interne');
  },
}));

describe('runCollect : exception inattendue dans une source', () => {
  it('est consignée sans arrêter les autres sources', async () => {
    const outDir = mkdtempSync(join(tmpdir(), 'collect-'));
    const rss = readFileSync(repoPath('fixtures/api/rss-euronews-fr.xml'), 'utf8');
    const net = fakeHttp({ 'https://fr.euronews.com/rss': { body: rss, type: 'application/rss+xml' } });
    const r = await runCollect({
      outDir, date: '2026-11-06', keys: { exa: 'exa-SECRET-456' }, fetch: net.fetch, now: NOW,
      configPath: CONFIG_PATH, rubriquesPath: RUBRIQUES_PATH, feedsPath: FEEDS_PATH, whitelistPath: WHITELIST_PATH,
    });
    expect(r.exitCode).toBe(0);
    expect(r.report.issues).toContainEqual({ level: 'error', source: 'exa', message: 'exa : erreur inattendue : bogue interne' });
    expect(r.report.sources.exa.used).toBe(true);
    expect(r.report.sources.rss.candidates).toBeGreaterThan(0);
  });
});
