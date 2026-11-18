import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { IsoDateSchema } from '@daily-brief/schema';
import { parisToday } from '../lib/date';
import { loadEnv } from '../lib/env';
import { redactText } from '../lib/redact';
import type { SupabaseFetch } from '../supabase/client';
import { buildNotification } from './notify';
import { recordRun } from './record-run';

const SUPABASE_ENV = ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY'];
const secrets = () => SUPABASE_ENV.map((n) => process.env[n]?.trim());

try {
  const { values } = parseArgs({ options: { date: { type: 'string' }, out: { type: 'string', default: 'out' }, 'dry-run': { type: 'boolean', default: false }, record: { type: 'boolean', default: false } } });
  const date = values.date ?? parisToday();
  if (!IsoDateSchema.safeParse(date).success) {
    console.log(`Brief incomplet : date incorrecte (« ${date} »)`);
    process.exit(2);
  }
  const dayDir = join(values.out!, date);
  const n = buildNotification(dayDir, date, { dryRun: values['dry-run'] });
  // --record (arrêt précoce de la routine) : la ligne `runs` du jour passe en « failed », avant le message final.
  if (values.record && !n.ready && !values['dry-run']) {
    loadEnv(SUPABASE_ENV);
    const r = await recordRun({ dayDir, date, message: n.message, env: process.env, fetch: fetch as unknown as SupabaseFetch });
    console.log(r.saved ? 'ligne runs enregistrée (failed)' : `ligne runs non écrite : ${redactText(r.error ?? 'erreur inconnue', secrets())}`);
  }
  console.log(n.message);
  process.exit(n.ready ? 0 : 2);
} catch (e) {
  console.error(`brief:notify : ${redactText(e instanceof Error ? e.message : String(e), secrets())}`);
  process.exit(2);
}
