import { parseArgs } from 'node:util';
import { runAudio } from '../audio/run-audio';
import type { HttpFetch } from '../collect/http';
import { parisToday } from '../lib/date';
import { loadEnv } from '../lib/env';
import { redactText } from '../lib/redact';
import type { FetchLike } from '../render/http';
import { runRender } from '../render/run-render';
import { runPublish } from '../publish/run-publish';
import type { SupabaseFetch } from '../supabase/client';
import { runFinish } from './finish';

const SECRET_ENV = ['GOOGLE_TTS_API_KEY', 'PEXELS_API_KEY', 'SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'APPS_SCRIPT_URL', 'APPS_SCRIPT_TOKEN'];
const secrets = () => SECRET_ENV.map((n) => process.env[n]?.trim());

try {
  loadEnv(SECRET_ENV);
  const { values } = parseArgs({ options: { date: { type: 'string' }, out: { type: 'string', default: 'out' }, 'dry-run': { type: 'boolean', default: false }, 'no-ffmpeg': { type: 'boolean', default: false } } });
  const date = values.date ?? parisToday();
  const outDir = values.out!;
  const { exitCode, report } = await runFinish({
    outDir,
    date,
    dryRun: values['dry-run'],
    steps: {
      audio: () => runAudio({ outDir, date, apiKey: process.env.GOOGLE_TTS_API_KEY, fetch: fetch as HttpFetch, ...(values['no-ffmpeg'] ? { ffmpeg: null } : {}) }),
      render: () => runRender({ outDir, date, pexelsApiKey: process.env.PEXELS_API_KEY, fetch: fetch as FetchLike }),
      publish: () => runPublish({ outDir, date, env: Object.fromEntries(SECRET_ENV.slice(2).map((n) => [n, process.env[n]])), supabaseFetch: fetch as SupabaseFetch, driveFetch: fetch as HttpFetch }),
    },
  });
  console.log(`brief:finish ${date}${report.dryRun ? ' (répétition, sans publication)' : ''}`);
  for (const s of report.steps) console.log(`brief:${s.step} : ${s.error ? `erreur inattendue (${redactText(s.error, secrets())})` : `code ${s.exitCode}`}`);
  console.log(`Détail : ${outDir}/${date}/{audio,render,publish}-report.json`);
  console.log(report.notification.message);
  process.exit(exitCode);
} catch (e) {
  console.error(`brief:finish : ${redactText(e instanceof Error ? e.message : String(e), secrets())}`);
  process.exit(2);
}
