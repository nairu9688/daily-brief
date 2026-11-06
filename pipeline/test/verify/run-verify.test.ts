import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { EditionSchema } from '@daily-brief/schema';
import { runVerify } from '../../verify/run-verify';
import { fixtureArticles, fixtureBrief, PROGRAMME_PATH, WHITELIST_PATH } from '../helpers';

function setupDay(withEs = true) {
  const outDir = mkdtempSync(join(tmpdir(), 'brief-'));
  const dayDir = join(outDir, '2026-11-06');
  mkdirSync(dayDir, { recursive: true });
  for (const e of fixtureBrief().editions) {
    if (e.lang === 'es' && !withEs) continue;
    writeFileSync(join(dayDir, `${e.lang}.json`), JSON.stringify(e));
  }
  const articles = fixtureArticles().map((a, i) => ({
    id: `a${i}`, url: a.url, outlet: 'X', title: 'T', description: null, lang: 'fr',
    publishedAt: null, origin: 'thenewsapi', text: a.text,
  }));
  writeFileSync(join(dayDir, 'raw.json'), JSON.stringify({ date: '2026-11-06', collectedAt: '2026-11-06T04:20:00Z', articles, errors: [] }));
  return { outDir, dayDir };
}

const opts = (outDir: string) => ({ outDir, date: '2026-11-06', whitelistPath: WHITELIST_PATH, programmePath: PROGRAMME_PATH });

describe('runVerify', () => {
  it('écrit trois éditions vérifiées valides et le rapport', () => {
    const { outDir, dayDir } = setupDay();
    const r = runVerify(opts(outDir));
    expect(r.exitCode).toBe(1);
    for (const lang of ['fr', 'en', 'es']) {
      const ed = JSON.parse(readFileSync(join(dayDir, `${lang}.verified.json`), 'utf8'));
      expect(EditionSchema.safeParse(ed).success).toBe(true);
    }
    const report = JSON.parse(readFileSync(join(dayDir, 'verify-report.json'), 'utf8'));
    expect(report.exitCode).toBe(1);
    expect(report.issues.length).toBe(r.issues.length);
  });

  it('sort en erreur si une édition manque', () => {
    const { outDir } = setupDay(false);
    const r = runVerify(opts(outDir));
    expect(r.exitCode).toBe(2);
    expect(r.issues).toContainEqual(expect.objectContaining({ lang: 'es', level: 'error' }));
  });

  it('est idempotent : un second passage sur les fichiers vérifiés ne corrige plus rien', () => {
    const { outDir, dayDir } = setupDay();
    runVerify(opts(outDir));
    for (const lang of ['fr', 'en', 'es']) {
      writeFileSync(join(dayDir, `${lang}.json`), readFileSync(join(dayDir, `${lang}.verified.json`)));
    }
    const second = runVerify(opts(outDir));
    expect(second.issues.filter((i) => i.level === 'fixed')).toEqual([]);
    expect(second.exitCode).toBe(0);
  });
});
