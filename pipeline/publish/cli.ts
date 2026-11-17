import { parseArgs } from 'node:util';
import type { HttpFetch } from '../collect/http';
import { parisToday } from '../lib/date';
import { loadEnv } from '../lib/env';
import { redactText } from '../lib/redact';
import type { SupabaseFetch } from '../supabase/client';
import { runPublish } from './run-publish';

const SECRET_ENV = ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'APPS_SCRIPT_URL', 'APPS_SCRIPT_TOKEN'];

try {
  loadEnv(SECRET_ENV);
  const { values } = parseArgs({ options: { date: { type: 'string' }, out: { type: 'string', default: 'out' } } });
  const date = values.date ?? parisToday();
  const env = Object.fromEntries(SECRET_ENV.map((n) => [n, process.env[n]]));
  const { exitCode, report, reportWritten } = await runPublish({ outDir: values.out!, date, env, supabaseFetch: fetch as SupabaseFetch, driveFetch: fetch as HttpFetch });
  console.log(`brief:publish ${date}`);
  for (const i of report.issues) console.log(`[${i.level}]${i.lang ? ' ' + i.lang.toUpperCase() : ''} ${i.message}`);
  for (const e of report.editions) console.log(`${e.lang.toUpperCase()} : ${e.published ? `publiée (${e.stories} sujets, ${e.sources} sources, ${e.vocab} mots)` : 'non publiée'}`);
  console.log(`Drive : ${report.drive.status}${report.drive.pending.length ? ` (${report.drive.pending.length} fichier(s) en attente)` : ''}`);
  if (!reportWritten) console.error('brief:publish : publish-report.json n’a pas pu être écrit.');
  console.log(exitCode === 0 ? `Publication ${report.status === 'ok' ? 'complète' : 'dégradée'} : ${report.editions.filter((e) => e.published).length} édition(s) dans Supabase.` : 'Erreur : aucune édition publiée.');
  process.exit(exitCode);
} catch (e) {
  console.error(`brief:publish : ${redactText(e instanceof Error ? e.message : String(e), [process.env.SUPABASE_SERVICE_ROLE_KEY, process.env.APPS_SCRIPT_TOKEN, process.env.APPS_SCRIPT_URL].map((s) => s?.trim()))}`);
  process.exit(2);
}
