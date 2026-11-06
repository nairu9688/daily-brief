import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ContextSchema, IsoDateSchema, LANGS, parseEdition, RawCollectionSchema, type Lang, type OpenThread } from '@daily-brief/schema';
import { loadWhitelist } from '../lib/whitelist';
import { exitCodeFor, type Issue } from './issues';
import { parseProgrammeSubjects } from './prepa';
import { buildSourceTexts, loadSourceTexts, type SourceTexts } from './sources';
import { verifyEdition } from './verify-edition';

export type RunVerifyOptions = {
  outDir: string;
  date: string;
  whitelistPath: string;
  programmePath: string;
};

export type RunVerifyResult = {
  issues: Issue[];
  exitCode: 0 | 1 | 2;
  written: string[];
  editions: { lang: Lang; written: boolean }[];
};

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

/**
 * Contrôle `out/<date>/{fr,en,es}.json` et écrit `{lang}.verified.json` et `verify-report.json`.
 * Le contexte (`context.json`), la collecte (`raw.json`) et les newsletters sont facultatifs,
 * mais un fichier présent et illisible est une erreur (code 2) : on se rabat alors sur le contexte
 * vide, ce qui est prudent, car sans texte source toutes les citations et tous les chiffres sont retirés.
 */
export function runVerify(opts: RunVerifyOptions): RunVerifyResult {
  const dateCheck = IsoDateSchema.safeParse(opts.date);
  if (!dateCheck.success) {
    return {
      issues: [{ rule: 'SCHEMA', level: 'error', message: `date incorrecte : « ${opts.date} » (AAAA-MM-JJ attendu)` }],
      exitCode: 2,
      written: [],
      editions: [],
    };
  }
  const dayDir = join(opts.outDir, opts.date);
  mkdirSync(dayDir, { recursive: true });
  const issues: Issue[] = [];
  const inputError = (file: string, e: unknown) =>
    issues.push({ rule: 'SCHEMA', level: 'error', message: `${file} illisible : ${message(e)}` });

  let openThreads: OpenThread[] = [];
  const contextPath = join(dayDir, 'context.json');
  if (existsSync(contextPath)) {
    try {
      openThreads = ContextSchema.parse(JSON.parse(readFileSync(contextPath, 'utf8'))).openThreads;
    } catch (e) {
      inputError('context.json', e);
    }
  }

  let texts: SourceTexts = buildSourceTexts([], []);
  let rawOk = true;
  const rawPath = join(dayDir, 'raw.json');
  if (existsSync(rawPath)) {
    try {
      RawCollectionSchema.parse(JSON.parse(readFileSync(rawPath, 'utf8')));
    } catch (e) {
      rawOk = false;
      inputError('raw.json', e);
    }
  }
  if (rawOk) {
    try {
      texts = loadSourceTexts(dayDir);
    } catch (e) {
      inputError('newsletters/', e);
    }
  }

  const ctx = {
    texts,
    whitelist: loadWhitelist(opts.whitelistPath),
    prepaSubjects: parseProgrammeSubjects(readFileSync(opts.programmePath, 'utf8')),
    openThreads,
  };

  const written: string[] = [];
  const editions: { lang: Lang; written: boolean }[] = [];
  for (const lang of LANGS) {
    const out = join(dayDir, `${lang}.verified.json`);
    rmSync(out, { force: true });
    const path = join(dayDir, `${lang}.json`);
    const fail = (msg: string) => {
      issues.push({ rule: 'SCHEMA', level: 'error', lang, message: msg });
      editions.push({ lang, written: false });
    };
    if (!existsSync(path)) {
      fail(`${lang}.json manquant`);
      continue;
    }
    let input: unknown;
    try {
      input = JSON.parse(readFileSync(path, 'utf8'));
    } catch (e) {
      fail(`JSON illisible : ${message(e)}`);
      continue;
    }
    const parsed = parseEdition(input);
    if (parsed.success && (parsed.data.lang !== lang || parsed.data.date !== opts.date)) {
      fail(`${lang}.json contient l’édition ${parsed.data.lang} du ${parsed.data.date} (attendu : ${lang} du ${opts.date})`);
      continue;
    }
    const r = verifyEdition(input, ctx);
    issues.push(...r.issues.map((i) => ({ ...i, lang })));
    if (r.edition) {
      writeFileSync(out, JSON.stringify(r.edition, null, 2) + '\n');
      written.push(out);
    }
    editions.push({ lang, written: r.edition !== null });
  }
  const exitCode = exitCodeFor(issues);
  const report = join(dayDir, 'verify-report.json');
  writeFileSync(
    report,
    JSON.stringify({ date: opts.date, generatedAt: new Date().toISOString(), exitCode, editions, issues }, null, 2) + '\n',
  );
  written.push(report);
  return { issues, exitCode, written, editions };
}
