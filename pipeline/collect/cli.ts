import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { LANGS } from '@daily-brief/schema';
import { parisToday } from '../lib/date';
import type { HttpFetch } from './http';
import { loadEnv } from '../lib/env';
import { redactText } from '../lib/redact';
import { runCollect } from './run-collect';

const path = (p: string) => fileURLToPath(new URL(p, import.meta.url));
const key = (name: string) => process.env[name]?.trim() || undefined;

const SECRET_ENV = ['THENEWSAPI_KEY', 'EXA_API_KEY', 'WEBZ_TOKEN'];

try {
  loadEnv(SECRET_ENV);
  const { values } = parseArgs({ options: { date: { type: 'string' }, out: { type: 'string', default: 'out' } } });
  const date = values.date ?? parisToday();
  const { exitCode, report, reportWritten, started } = await runCollect({
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
  // Un message de source qui commence déjà par son nom (« rss https://… ») ne le répète pas.
  for (const i of report.issues) console.log(`[${i.level}]${i.source && !i.message.startsWith(`${i.source} `) ? ' ' + i.source : ''} ${i.message}`);
  if (!started) process.exit(exitCode);
  for (const lang of LANGS) {
    const l = report.perLang[lang];
    console.log(`${lang.toUpperCase()} : ${l.articles} articles, ${l.fullTexts} textes lus${l.light ? ' (édition allégée)' : ''}`);
  }
  if (!reportWritten) console.error('brief:collect : collect-report.json n’a pas pu être écrit (voir les erreurs ci-dessus).');
  console.log(exitCode === 0 ? `raw.json : ${report.articles} articles, ${report.groups} groupes` : 'Erreur : aucun article collecté.');
  process.exit(exitCode);
} catch (e) {
  console.error(`brief:collect : ${redactText(e instanceof Error ? e.message : String(e), SECRET_ENV.map((n) => process.env[n]))}`);
  process.exit(2);
}
