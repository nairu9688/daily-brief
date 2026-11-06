import { parseArgs } from 'node:util';
import { parisToday } from '../lib/date';
import type { FetchLike } from './http';
import { runRender } from './run-render';

try {
  try {
    process.loadEnvFile('.env');
  } catch (e) {
    // Pas de .env : variables d'environnement du processus seulement. Toute autre erreur est remontée.
    if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
  }
  const { values } = parseArgs({ options: { date: { type: 'string' }, out: { type: 'string', default: 'out' } } });
  const date = values.date ?? parisToday();
  const r = await runRender({ outDir: values.out!, date, pexelsApiKey: process.env.PEXELS_API_KEY, fetch: fetch as FetchLike });
  console.log(`brief:render ${date}`);
  for (const i of r.issues) console.log(`[${i.level}]${i.lang ? ' ' + i.lang.toUpperCase() : ''} ${i.message}`);
  console.log(r.pdfPath ? `PDF : ${r.pdfPath} (${r.langs.join(', ').toUpperCase()})` : 'Erreur : aucun PDF produit.');
  process.exit(r.exitCode);
} catch (e) {
  console.error(`brief:render : ${(e as Error).message}`);
  process.exit(2);
}
