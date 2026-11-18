import { describe, expect, it } from 'vitest';
import type { Lang } from '@daily-brief/schema';
import { buildNotification } from '../../run/notify';
import { audioReport, DAY, makeDay } from '../publish/day';
import { stepReports } from '../publish/reports';

/** publish-report.json réduit à ce que lit la notification. */
const publishReport = (langs: Lang[], drive = 'sent', exitCode = 0) =>
  JSON.stringify({ date: DAY, generatedAt: `${DAY}T04:45:00.000Z`, exitCode, status: 'ok', editions: (['fr', 'en', 'es'] as Lang[]).map((lang) => ({ lang, published: langs.includes(lang) })), drive: { status: drive } });
const newslettersReport = (written: number) => JSON.stringify({ date: DAY, generatedAt: `${DAY}T04:20:00.000Z`, exitCode: 0, written: Array.from({ length: written }, (_, i) => ({ file: `0${i + 1}-x.md` })), skipped: [], issues: [] });
/** Passage sans incident : collecte complète, newsletters lues, audio complet, Drive déposé. */
function cleanDay(extra: Record<string, string> = {}) {
  const reports = stepReports();
  const collect = JSON.parse(reports['collect-report.json']);
  collect.degraded = false;
  collect.perLang.es.light = false;
  return makeDay({ audio: ['fr', 'en', 'es'], extra: { ...reports, 'collect-report.json': JSON.stringify(collect), 'newsletters-report.json': newslettersReport(6), 'publish-report.json': publishReport(['fr', 'en', 'es']), ...extra } });
}

describe('buildNotification', () => {
  it('passage complet : « Brief du jour prêt : N sujets, M médias »', () => {
    const { dayDir } = cleanDay();
    expect(buildNotification(dayDir, DAY)).toEqual({ ready: true, message: 'Brief du jour prêt : 10 sujets, 24 médias', editions: ['fr', 'en', 'es'], stories: 10, outlets: 24, notes: [] });
  });

  it('prêt avec des manques : collecte dégradée, édition allégée, audio partiel, Drive en attente', () => {
    const { dayDir } = makeDay({ audio: ['fr', 'en'], extra: { ...stepReports(), 'newsletters-report.json': newslettersReport(0), 'audio-report.json': audioReport(DAY, ['fr', 'en'], { status: 'degraded' }), 'publish-report.json': publishReport(['fr', 'en', 'es'], 'pending') } });
    expect(buildNotification(dayDir, DAY).message).toBe('Brief du jour prêt : 10 sujets, 24 médias (collecte dégradée ; édition allégée : ES ; aucune newsletter ; audio partiel ; Drive en attente)');
  });

  it('une édition non publiée : « Brief incomplet », avec ce qui est publié', () => {
    const { dayDir } = cleanDay({ 'publish-report.json': publishReport(['fr', 'en']) });
    expect(buildNotification(dayDir, DAY)).toMatchObject({ ready: false, message: 'Brief incomplet : édition ES manquante — 8 sujets, 16 médias', editions: ['fr', 'en'] });
  });

  it.each([
    ['collecte en échec (code 2)', (r: Record<string, string>) => ({ 'collect-report.json': JSON.stringify({ ...JSON.parse(r['collect-report.json']), exitCode: 2 }), 'publish-report.json': '' }), 'Brief incomplet : collecte impossible : aucun article'],
    ['contrôle sans édition valide', (r: Record<string, string>) => ({ 'verify-report.json': JSON.stringify({ ...JSON.parse(r['verify-report.json']), exitCode: 2, editions: [{ lang: 'fr', written: false }] }), 'publish-report.json': '' }), 'Brief incomplet : aucune édition valide après le contrôle'],
    ['publication en échec', () => ({ 'publish-report.json': publishReport([], 'skipped', 2) }), 'Brief incomplet : publication impossible'],
    ['publication non lancée', () => ({ 'publish-report.json': '' }), 'Brief incomplet : publication non lancée'],
  ])('%s', (_label, edit, expected) => {
    const { dayDir } = cleanDay(edit(stepReports()));
    expect(buildNotification(dayDir, DAY).message.split(' (')[0]).toBe(expected);
  });

  it('rapports absents ou d’une autre date : contexte, newsletters et audio signalés', () => {
    const { dayDir } = makeDay({ extra: { 'publish-report.json': publishReport(['fr', 'en', 'es']), 'context-report.json': stepReports('2026-11-05')['context-report.json'] } });
    expect(buildNotification(dayDir, DAY).notes).toEqual(['contexte indisponible : Threads non rattachés', 'newsletters non lues', 'audio non lancé']);
  });

  it('répétition : compte les éditions rendues, sans publish-report.json', () => {
    const { dayDir } = cleanDay({ 'publish-report.json': '' });
    expect(buildNotification(dayDir, DAY, { dryRun: true }).message).toBe('Répétition sans publication : 10 sujets, 24 médias');
  });
});
