import { fileURLToPath } from 'node:url';
import { loadCollectConfig } from './config';
import type { HttpFetch } from './http';
import { checkRealtime, describeRealtime } from './realtime';

const CODES = { thenewsapi: 0, exa: 1, unknown: 2 } as const;

try {
  try {
    process.loadEnvFile('.env');
  } catch (e) {
    // Pas de .env : variables d'environnement du processus seulement. Toute autre erreur est remontée.
    if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
  }
  const { primary } = loadCollectConfig(fileURLToPath(new URL('../config/collect.json', import.meta.url)));
  const token = process.env.THENEWSAPI_KEY?.trim();
  console.log(`check:thenewsapi (découverte principale actuelle : ${primary})`);
  if (!token) {
    console.log('THENEWSAPI_KEY absente (environnement ou .env) : vérification impossible.');
    process.exit(2);
  }
  const report = await checkRealtime({ token, fetch: fetch as HttpFetch });
  for (const line of describeRealtime(report, primary)) console.log(line);
  process.exit(CODES[report.verdict]);
} catch (e) {
  console.error(`check:thenewsapi : ${e instanceof Error ? e.message : String(e)}`);
  process.exit(2);
}
