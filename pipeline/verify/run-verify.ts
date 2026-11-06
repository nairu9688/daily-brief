import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ContextSchema, LANGS, type OpenThread } from '@daily-brief/schema';
import { loadWhitelist } from '../lib/whitelist';
import { exitCodeFor, type Issue } from './issues';
import { parseProgrammeSubjects } from './prepa';
import { loadSourceTexts } from './sources';
import { verifyEdition } from './verify-edition';

export type RunVerifyOptions = {
  outDir: string;
  date: string;
  whitelistPath: string;
  programmePath: string;
};

export type RunVerifyResult = { issues: Issue[]; exitCode: 0 | 1 | 2; written: string[] };

/**
 * Contrôle `out/<date>/{fr,en,es}.json` et écrit `{lang}.verified.json` et `verify-report.json`.
 * Le contexte (`context.json`), la collecte (`raw.json`) et les newsletters sont facultatifs.
 */
export function runVerify(opts: RunVerifyOptions): RunVerifyResult {
  const dayDir = join(opts.outDir, opts.date);
  const contextPath = join(dayDir, 'context.json');
  const openThreads: OpenThread[] = existsSync(contextPath)
    ? ContextSchema.parse(JSON.parse(readFileSync(contextPath, 'utf8'))).openThreads
    : [];
  const ctx = {
    texts: loadSourceTexts(dayDir),
    whitelist: loadWhitelist(opts.whitelistPath),
    prepaSubjects: parseProgrammeSubjects(readFileSync(opts.programmePath, 'utf8')),
    openThreads,
  };

  const issues: Issue[] = [];
  const written: string[] = [];
  for (const lang of LANGS) {
    const path = join(dayDir, `${lang}.json`);
    if (!existsSync(path)) {
      issues.push({ rule: 'SCHEMA', level: 'error', lang, message: `${lang}.json manquant` });
      continue;
    }
    let input: unknown;
    try {
      input = JSON.parse(readFileSync(path, 'utf8'));
    } catch (e) {
      issues.push({ rule: 'SCHEMA', level: 'error', lang, message: `JSON illisible : ${(e as Error).message}` });
      continue;
    }
    const r = verifyEdition(input, ctx);
    issues.push(...r.issues.map((i) => ({ ...i, lang })));
    if (r.edition) {
      const out = join(dayDir, `${lang}.verified.json`);
      writeFileSync(out, JSON.stringify(r.edition, null, 2) + '\n');
      written.push(out);
    }
  }
  const exitCode = exitCodeFor(issues);
  const report = join(dayDir, 'verify-report.json');
  writeFileSync(report, JSON.stringify({ date: opts.date, generatedAt: new Date().toISOString(), exitCode, issues }, null, 2) + '\n');
  written.push(report);
  return { issues, exitCode, written };
}
