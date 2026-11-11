import { parseArgs } from 'node:util';
import { parisToday } from '../lib/date';
import { runContext } from './run-context';
import { selectStore } from './select-store';

try {
  try {
    process.loadEnvFile('.env');
  } catch (e) {
    // Pas de .env : variables d'environnement du processus seulement. Toute autre erreur est remontée.
    if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
  }
  const { values } = parseArgs({ options: { date: { type: 'string' }, out: { type: 'string', default: 'out' } } });
  const date = values.date ?? parisToday();
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  const { store, warning } = selectStore({ ...process.env, SUPABASE_SERVICE_ROLE_KEY: serviceKey });
  const { exitCode, report } = await runContext({
    outDir: values.out!,
    date,
    store,
    warnings: [warning],
    secrets: [serviceKey],
  });
  console.log(`brief:context ${date} (store ${report.store})`);
  for (const i of report.issues) console.log(`[${i.level}] ${i.message}`);
  if (exitCode === 0) {
    console.log(`context.json : ${report.openThreads} Threads ouverts, ${report.yesterdayTopics} sujets de la veille, ${report.closedThreads.length} Threads fermés (R12)`);
  } else console.log('Erreur : context.json non écrit.');
  process.exit(exitCode);
} catch (e) {
  console.error(`brief:context : ${e instanceof Error ? e.message : String(e)}`);
  process.exit(2);
}
