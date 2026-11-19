import { parseArgs } from 'node:util';
import { parisToday } from '../lib/date';
import type { FetchLike } from './http';
import { runRender } from './run-render';

try {
  const { values } = parseArgs({ options: { date: { type: 'string' }, out: { type: 'string', default: 'out' } } });
  const date = values.date ?? parisToday();
  // Photos : Wikimedia Commons, sans clé ; aucune variable d'environnement n'est lue.
  const r = await runRender({ outDir: values.out!, date, fetch: fetch as FetchLike });
  console.log(`brief:render ${date}`);
  for (const i of r.issues) console.log(`[${i.level}]${i.lang ? ' ' + i.lang.toUpperCase() : ''} ${i.message}`);
  console.log(r.pdfPath ? `PDF : ${r.pdfPath} (${r.langs.join(', ').toUpperCase()})` : 'Erreur : aucun PDF produit.');
  process.exit(r.exitCode);
} catch (e) {
  console.error(`brief:render : ${(e as Error).message}`);
  process.exit(2);
}
