import { readFileSync } from 'node:fs';
import { loadCollectConfig, type CollectConfig } from '../../collect/config';
import type { HttpFetch } from '../../collect/http';
import { loadRubriques } from '../../collect/rubriques';
import type { SourceContext } from '../../collect/types';
import { loadWhitelist } from '../../lib/whitelist';
import { repoPath, WHITELIST_PATH } from '../helpers';

export const NOW = new Date('2026-11-06T04:13:00Z');
export const CONFIG_PATH = repoPath('pipeline/config/collect.json');
export const RUBRIQUES_PATH = repoPath('pipeline/editorial/rubriques.json');
export const FEEDS_PATH = repoPath('pipeline/config/feeds.json');

export const apiFixture = (name: string): any => JSON.parse(readFileSync(repoPath(`fixtures/api/${name}`), 'utf8'));

/** Contexte de source construit sur la vraie configuration, à l'heure de la routine (05:13 Paris). */
export function testContext(fetch: HttpFetch, patch?: (c: CollectConfig) => void): SourceContext {
  const config = loadCollectConfig(CONFIG_PATH);
  patch?.(config);
  return {
    fetch,
    whitelist: loadWhitelist(WHITELIST_PATH),
    config,
    rubriques: loadRubriques(RUBRIQUES_PATH),
    now: NOW,
    windowStart: new Date(NOW.getTime() - config.windowHours * 3_600_000),
  };
}
