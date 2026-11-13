import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { join } from 'node:path';
import { loadCollectConfig } from './config';
import type { HttpFetch } from './http';
import { checkRealtime, describeRealtime } from './realtime';
import { redactText } from './redact';

const CODES = { thenewsapi: 0, exa: 1, unknown: 2 } as const;

try {
  // Une variable définie mais vide empêcherait `.env` de la remplir (loadEnvFile ne remplace rien).
  if (process.env.THENEWSAPI_KEY !== undefined && process.env.THENEWSAPI_KEY.trim() === '') delete process.env.THENEWSAPI_KEY;
  try {
    process.loadEnvFile('.env');
  } catch (e) {
    // Pas de .env : variables d'environnement du processus seulement. Toute autre erreur est remontée.
    if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
  }
  const { values } = parseArgs({ options: { out: { type: 'string', default: 'out' } } });
  const outDir = values.out!;
  const { primary } = loadCollectConfig(fileURLToPath(new URL('../config/collect.json', import.meta.url)));
  const token = process.env.THENEWSAPI_KEY?.trim();
  console.log(`check:thenewsapi (découverte principale actuelle : ${primary})`);
  if (!token) {
    console.log('THENEWSAPI_KEY absente (environnement ou .env) : vérification impossible.');
    process.exit(2);
  }
  mkdirSync(outDir, { recursive: true });
  const report = await checkRealtime({ token, fetch: fetch as HttpFetch, ledgerPath: join(outDir, 'thenewsapi-usage.json') });
  for (const line of describeRealtime(report, primary)) console.log(line);
  process.exit(CODES[report.verdict]);
} catch (e) {
  console.error(`check:thenewsapi : ${redactText(e instanceof Error ? e.message : String(e), [process.env.THENEWSAPI_KEY])}`);
  process.exit(2);
}
