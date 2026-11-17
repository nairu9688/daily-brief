import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { capErrors, summarizeReports } from '../../publish/run-summary';
import { DAY, makeDay, RENDERED_AT } from './day';
import { stepReports } from './reports';

describe('summarizeReports', () => {
  it('résume les quatre rapports : statut, fin, compteurs, erreurs', () => {
    const { dayDir } = makeDay({ extra: stepReports() });
    const r = summarizeReports(dayDir, DAY);
    expect(r.issues).toEqual([]);
    expect(r.steps).toEqual({
      context: { status: 'ok', finishedAt: '2026-11-06T04:13:05.000Z', durationMs: null, counters: { openThreads: 5, yesterdayTopics: 9, closedThreads: 1, warnings: 1 }, errors: [] },
      collect: {
        status: 'degraded',
        finishedAt: '2026-11-06T04:18:40.000Z',
        durationMs: null,
        counters: { articles: 212, groups: 131, warnings: 1 },
        errors: ['webz : HTTP 429 (https://api.webz.io/newsApiLite?token=***) — source coupée'],
        perLang: { fr: { articles: 90, fullTexts: 31, light: false }, en: { articles: 70, fullTexts: 22, light: false }, es: { articles: 52, fullTexts: 9, light: true } },
      },
      verify: { status: 'degraded', finishedAt: '2026-11-06T04:31:00.000Z', durationMs: null, counters: { editions: 3, fixed: 1, warnings: 1, errors: 0 }, errors: [] },
      render: { status: 'ok', finishedAt: RENDERED_AT, durationMs: null, counters: { finals: 3, pdfEditions: 3, pdf: 1, warnings: 0 }, errors: [] },
    });
    expect(r.light).toEqual({ fr: false, en: false, es: true });
  });

  it('rapport absent : « missing », sans avertissement ; aucune édition n’est dite allégée', () => {
    const { dayDir } = makeDay();
    const r = summarizeReports(dayDir, DAY);
    const missing = { status: 'missing', finishedAt: null, durationMs: null, counters: {}, errors: [] };
    expect([r.steps.context, r.steps.collect, r.steps.verify]).toEqual([missing, missing, missing]);
    expect(r.steps.render.status).toBe('ok');
    expect(r.light).toEqual({});
    expect(r.issues).toEqual([]);
  });

  it('rapport illisible, d’une forme inattendue ou d’une autre date : « unreadable » et avertissement', () => {
    const { dayDir } = makeDay({ extra: { ...stepReports('2026-11-05'), 'context-report.json': '{ tronqué', 'verify-report.json': '{"date":"2026-11-06"}' } });
    const r = summarizeReports(dayDir, DAY);
    expect([r.steps.context.status, r.steps.collect.status, r.steps.verify.status]).toEqual(['unreadable', 'unreadable', 'unreadable']);
    expect(r.light).toEqual({});
    expect(r.issues).toEqual([
      { level: 'warning', message: 'context-report.json illisible : étape notée « unreadable » dans runs' },
      { level: 'warning', message: 'collect-report.json est celui du 2026-11-05 : étape notée « unreadable » dans runs' },
      { level: 'warning', message: 'verify-report.json illisible : étape notée « unreadable » dans runs' },
    ]);
  });

  it('codes de sortie 2 : étapes en échec ; rendu sans PDF : échec', () => {
    const reports = stepReports();
    const fail = (name: string) => JSON.stringify({ ...JSON.parse(reports[name]), exitCode: 2 });
    const { dayDir } = makeDay({ pdf: null, extra: { 'context-report.json': fail('context-report.json'), 'collect-report.json': fail('collect-report.json'), 'verify-report.json': fail('verify-report.json') } });
    const s = summarizeReports(dayDir, DAY).steps;
    expect([s.context.status, s.collect.status, s.verify.status, s.render.status]).toEqual(['failed', 'failed', 'failed', 'failed']);
    expect(s.render.counters).toEqual({ finals: 3, pdfEditions: 0, pdf: 0, warnings: 0 });
  });

  it('rendu réussi mais avec une édition en erreur : « degraded »', () => {
    const { dayDir } = makeDay();
    const report = { date: DAY, generatedAt: RENDERED_AT, exitCode: 0, pdf: 'Daily Brief 2026-11-06.pdf', langs: ['fr'], finals: ['fr'], issues: [{ level: 'error', lang: 'en', message: 'en.verified.json invalide' }] };
    writeFileSync(join(dayDir, 'render-report.json'), JSON.stringify(report));
    expect(summarizeReports(dayDir, DAY).steps.render).toMatchObject({ status: 'degraded', errors: ['en.verified.json invalide'] });
  });

  it('capErrors : au plus 5 messages de 300 caractères', () => {
    const out = capErrors(Array.from({ length: 8 }, (_, i) => `${i} ${'x'.repeat(400)}`));
    expect(out).toHaveLength(5);
    expect(out.every((m) => m.length === 300 && m.endsWith('…'))).toBe(true);
    expect(capErrors(['court'])).toEqual(['court']);
  });
});
