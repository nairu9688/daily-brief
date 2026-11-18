import { parseArgs } from 'node:util';
import { parisToday } from '../lib/date';
import { runNewsletters } from './run-newsletters';

try {
  const { values } = parseArgs({ options: { date: { type: 'string' }, out: { type: 'string', default: 'out' } } });
  const date = values.date ?? parisToday();
  const { exitCode, report } = runNewsletters({ outDir: values.out!, date });
  console.log(`brief:newsletters ${date}`);
  for (const i of report.issues) console.log(`[${i.level}] ${i.message}`);
  for (const s of report.skipped) console.log(`[ignoré] ${s.file} : ${s.reason}`);
  for (const w of report.written) console.log(`${w.file} (${w.links} liens)`);
  console.log(exitCode === 0 ? `Newsletters : ${report.written.length} texte(s) écrit(s) dans newsletters/.` : 'Erreur : newsletters non converties.');
  process.exit(exitCode);
} catch (e) {
  console.error(`brief:newsletters : ${e instanceof Error ? e.message : String(e)}`);
  process.exit(2);
}
