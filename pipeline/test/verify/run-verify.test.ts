import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
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

  it('signale un context.json illisible (code 2) mais écrit quand même les éditions vérifiées', () => {
    const { outDir, dayDir } = setupDay();
    writeFileSync(join(dayDir, 'context.json'), '{bad');
    const r = runVerify(opts(outDir));
    expect(r.exitCode).toBe(2);
    expect(r.issues).toContainEqual(expect.objectContaining({ rule: 'SCHEMA', level: 'error', message: expect.stringContaining('context.json') }));
    for (const lang of ['fr', 'en', 'es']) expect(existsSync(join(dayDir, `${lang}.verified.json`))).toBe(true);
  });

  it('signale un raw.json invalide (code 2) et retire alors toutes les citations et chiffres', () => {
    const { outDir, dayDir } = setupDay();
    writeFileSync(join(dayDir, 'raw.json'), JSON.stringify({ date: 'x' }));
    const r = runVerify(opts(outDir));
    expect(r.exitCode).toBe(2);
    expect(r.issues).toContainEqual(expect.objectContaining({ rule: 'SCHEMA', level: 'error', message: expect.stringContaining('raw.json') }));
    const fr = JSON.parse(readFileSync(join(dayDir, 'fr.verified.json'), 'utf8'));
    expect(fr.sections.flatMap((s: any) => s.stories).every((st: any) => st.quote === null && st.stats.length === 0)).toBe(true);
  });

  it('refuse une édition dont la langue ne correspond pas au fichier', () => {
    const { outDir, dayDir } = setupDay();
    writeFileSync(join(dayDir, 'fr.json'), readFileSync(join(dayDir, 'en.json')));
    const r = runVerify(opts(outDir));
    expect(r.exitCode).toBe(2);
    expect(r.issues).toContainEqual(expect.objectContaining({ rule: 'SCHEMA', level: 'error', lang: 'fr', message: expect.stringContaining('fr.json contient l’édition en') }));
    expect(existsSync(join(dayDir, 'fr.verified.json'))).toBe(false);
    expect(r.editions).toContainEqual({ lang: 'fr', written: false });
  });

  it('refuse une édition dont la date ne correspond pas au dossier', () => {
    const { outDir, dayDir } = setupDay();
    const fr = JSON.parse(readFileSync(join(dayDir, 'fr.json'), 'utf8'));
    fr.date = '2026-11-01';
    writeFileSync(join(dayDir, 'fr.json'), JSON.stringify(fr));
    const r = runVerify(opts(outDir));
    expect(r.exitCode).toBe(2);
    expect(r.issues).toContainEqual(expect.objectContaining({ level: 'error', lang: 'fr', message: expect.stringContaining('2026-11-01') }));
    expect(existsSync(join(dayDir, 'fr.verified.json'))).toBe(false);
  });

  it('ne laisse pas de fichier vérifié périmé quand l’entrée devient illisible', () => {
    const { outDir, dayDir } = setupDay();
    runVerify(opts(outDir));
    expect(existsSync(join(dayDir, 'fr.verified.json'))).toBe(true);
    writeFileSync(join(dayDir, 'fr.json'), '{');
    const r = runVerify(opts(outDir));
    expect(r.exitCode).toBe(2);
    expect(existsSync(join(dayDir, 'fr.verified.json'))).toBe(false);
  });

  it('refuse une date invalide sans rien écrire', () => {
    const { outDir } = setupDay();
    const r = runVerify({ ...opts(outDir), date: '../x' });
    expect(r.exitCode).toBe(2);
    expect(r.issues[0]).toMatchObject({ rule: 'SCHEMA', level: 'error' });
    expect(r.written).toEqual([]);
  });

  it('crée le dossier du jour s’il manque et sort en erreur', () => {
    const outDir = mkdtempSync(join(tmpdir(), 'brief-'));
    const r = runVerify(opts(outDir));
    expect(r.exitCode).toBe(2);
    expect(existsSync(join(outDir, '2026-11-06', 'verify-report.json'))).toBe(true);
  });

  it('indique dans le rapport quelles éditions ont été écrites', () => {
    const { outDir, dayDir } = setupDay(false);
    const r = runVerify(opts(outDir));
    expect(r.editions).toEqual([{ lang: 'fr', written: true }, { lang: 'en', written: true }, { lang: 'es', written: false }]);
    expect(JSON.parse(readFileSync(join(dayDir, 'verify-report.json'), 'utf8')).editions).toEqual(r.editions);
  });
});
