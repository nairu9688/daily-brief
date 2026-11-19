import { parseArgs } from 'node:util';
import { parisToday } from '../lib/date';
import { loadEnv } from '../lib/env';
import { redactText } from '../lib/redact';
import { FINISH_SECRET_ENV, finishSteps, runFinish } from './finish';

const secrets = () => FINISH_SECRET_ENV.map((n) => process.env[n]?.trim());

try {
  loadEnv([...FINISH_SECRET_ENV]);
  const { values } = parseArgs({ options: { date: { type: 'string' }, out: { type: 'string', default: 'out' }, 'dry-run': { type: 'boolean', default: false }, 'no-ffmpeg': { type: 'boolean', default: false } } });
  const date = values.date ?? parisToday();
  const outDir = values.out!;
  const dryRun = values['dry-run'];
  const { exitCode, report } = await runFinish({
    outDir,
    date,
    dryRun,
    secrets: secrets(),
    // Répétition (--dry-run) : aucun appel extérieur, ni Text-to-Speech, ni recherche de photos (Wikimedia Commons), ni publication.
    steps: finishSteps({ outDir, date, dryRun, env: process.env, fetch, ...(values['no-ffmpeg'] ? { ffmpeg: null } : {}) }),
  });
  console.log(`brief:finish ${date}${report.dryRun ? ' (répétition, sans publication ni appel extérieur)' : ''}`);
  for (const s of report.steps) console.log(`brief:${s.step} : ${s.error ? `erreur inattendue (${redactText(s.error, secrets())})` : `code ${s.exitCode}`}`);
  console.log(`Détail : ${outDir}/${date}/{audio,render,publish}-report.json`);
  console.log(report.notification.message);
  process.exit(exitCode);
} catch (e) {
  console.error(`brief:finish : ${redactText(e instanceof Error ? e.message : String(e), secrets())}`);
  process.exit(2);
}
