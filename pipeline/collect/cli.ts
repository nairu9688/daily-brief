import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { LANGS } from '@daily-brief/schema';
import { parisToday } from '../lib/date';
import type { HttpFetch } from './http';
import { runCollect } from './run-collect';

const path = (p: string) => fileURLToPath(new URL(p, import.meta.url));
const key = (name: string) => process.env[name]?.trim() || undefined;

try {
  try {
    process.loadEnvFile('.env');
  } catch (e) {
    // Pas de .env : variables d'environnement du processus seulement. Toute autre erreur est remontée.
    if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
  }
  const { values } = parseArgs({ options: { date: { type: 'string' }, out: { type: 'string', default: 'out' } } });
  const date = values.date ?? parisToday();
  const { exitCode, report } = await runCollect({
    outDir: values.out!,
    date,
    keys: { thenewsapi: key('THENEWSAPI_KEY'), exa: key('EXA_API_KEY'), webz: key('WEBZ_TOKEN') },
    fetch: fetch as HttpFetch,
    configPath: path('../config/collect.json'),
    rubriquesPath: path('../editorial/rubriques.json'),
    feedsPath: path('../config/feeds.json'),
    whitelistPath: path('../config/whitelist.json'),
  });
  console.log(`brief:collect ${date}`);
  for (const i of report.issues) console.log(`[${i.level}]${i.source ? ' ' + i.source : ''} ${i.message}`);
  for (const lang of LANGS) {
    const l = report.perLang[lang];
    console.log(`${lang.toUpperCase()} : ${l.articles} articles, ${l.fullTexts} textes lus${l.light ? ' (édition allégée)' : ''}`);
  }
  console.log(exitCode === 0 ? `raw.json : ${report.articles} articles, ${report.groups} groupes` : 'Erreur : aucun article collecté.');
  process.exit(exitCode);
} catch (e) {
  console.error(`brief:collect : ${e instanceof Error ? e.message : String(e)}`);
  process.exit(2);
}
