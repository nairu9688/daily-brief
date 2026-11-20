import { describe, expect, it } from 'vitest';
import type { Edition, Lang } from '@daily-brief/schema';
import { buildNotification } from '../../run/notify';
import { audioReport, DAY, makeDay } from '../publish/day';
import { stepReports } from '../publish/reports';
import { runCli } from '../run-cli';

/** publish-report.json réduit à ce que lit la notification. */
const publishReport = (langs: Lang[], drive = 'sent', exitCode = 0, over: Record<string, unknown> = {}) =>
  JSON.stringify({ date: DAY, generatedAt: `${DAY}T04:45:00.000Z`, exitCode, status: 'ok', editions: (['fr', 'en', 'es'] as Lang[]).map((lang) => ({ lang, published: langs.includes(lang) })), drive: { status: drive }, ...over });
const newslettersReport = (written: number) => JSON.stringify({ date: DAY, generatedAt: `${DAY}T04:20:00.000Z`, exitCode: 0, written: Array.from({ length: written }, (_, i) => ({ file: `0${i + 1}-x.md` })), skipped: [], issues: [] });
/** Passage sans incident : collecte complète, newsletters lues, audio complet, Drive déposé. */
function cleanDay(extra: Record<string, string> = {}, edit?: (e: Edition) => void) {
  const reports = stepReports();
  const collect = JSON.parse(reports['collect-report.json']);
  collect.degraded = false;
  collect.perLang.es.light = false;
  return makeDay({ audio: ['fr', 'en', 'es'], edit, extra: { ...reports, 'collect-report.json': JSON.stringify(collect), 'newsletters-report.json': newslettersReport(6), 'publish-report.json': publishReport(['fr', 'en', 'es']), ...extra } });
}

describe('buildNotification', () => {
  it('passage complet : « Brief du jour prêt : N sujets, M médias »', () => {
    const { dayDir } = cleanDay();
    expect(buildNotification(dayDir, DAY)).toEqual({ ready: true, message: 'Brief du jour prêt : 10 sujets, 23 médias', editions: ['fr', 'en', 'es'], stories: 10, outlets: 23, notes: [] });
  });

  it('prêt avec des manques : collecte dégradée, édition allégée, audio partiel, Drive en attente', () => {
    const { dayDir } = makeDay({ audio: ['fr', 'en'], extra: { ...stepReports(), 'newsletters-report.json': newslettersReport(0), 'audio-report.json': audioReport(DAY, ['fr', 'en'], { status: 'degraded' }), 'publish-report.json': publishReport(['fr', 'en', 'es'], 'pending') } });
    expect(buildNotification(dayDir, DAY).message).toBe('Brief du jour prêt : 10 sujets, 23 médias (collecte dégradée : webz : HTTP 429 (https://api.webz.io/newsApiLite?token=***) — source coupée ; édition allégée : ES ; aucune newsletter ; audio partiel ; Drive en attente)');
  });

  it('une édition non publiée : « Brief incomplet », avec ce qui est publié', () => {
    const { dayDir } = cleanDay({ 'publish-report.json': publishReport(['fr', 'en']) });
    expect(buildNotification(dayDir, DAY)).toMatchObject({ ready: false, message: 'Brief incomplet : édition ES manquante — 8 sujets, 15 médias', editions: ['fr', 'en'] });
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
    expect(buildNotification(dayDir, DAY, { dryRun: true }).message).toBe('Répétition sans publication : 10 sujets, 23 médias');
  });
});

describe('buildNotification : médias comptés par clé normalisée (20/11/2026)', () => {
  /** Toutes les sources des trois éditions remplacées par ces URL et ces noms. */
  const only = (sources: [string, string][]) => (e: Edition) => {
    for (const section of e.sections) {
      section.briefs = [];
      for (const st of section.stories) st.sources = sources.map(([outlet, url]) => ({ outlet, title: 'T', url, lang: e.lang, readFull: true }));
    }
  };

  it('deux noms ou deux domaines du même média comptent pour un', () => {
    const { dayDir } = cleanDay({}, only([
      ['elDiario.es', 'https://www.eldiario.es/a'],
      ['eldiario.es', 'https://eldiario.es/b'],
      ['franceinfo', 'https://www.franceinfo.fr/c'],
      ['franceinfo.fr', 'https://www.francetvinfo.fr/d'],
      ['BBC News', 'https://www.bbc.co.uk/e'],
      ['bbc.com', 'https://www.bbc.com/f'],
      ['PBS NewsHour', 'https://www.pbs.org/newshour/g'],
      ['pbs.org', 'https://www.pbs.org/h'],
      ['Euronews', 'https://fr.euronews.com/i'],
      ['euronews.com', 'https://www.euronews.com/j'],
      ['Sud Radio · AFP', 'https://www.sudradio.fr/k'],
      ['Sud Radio', 'https://www.sudradio.fr/l'],
    ]));
    expect(buildNotification(dayDir, DAY)).toMatchObject({ ready: true, stories: 10, outlets: 6, message: 'Brief du jour prêt : 10 sujets, 6 médias' });
  });
});

describe('buildNotification (revue du lot 7)', () => {
  it('collecte dégradée : reprend les erreurs du rapport, masquées et bornées', () => {
    const collect = JSON.parse(stepReports()['collect-report.json']);
    collect.issues = [
      { level: 'error', source: 'exa', message: `exa : HTTP 401 sur https://api.exa.ai/search?apikey=EXA-TEMOIN-123 ${'x'.repeat(200)}` },
      { level: 'error', source: 'webz', message: 'webz : clé WEBZ-TEMOIN-456 refusée' },
      { level: 'error', source: 'rss', message: 'troisième erreur' },
      { level: 'warning', source: 'rss', message: 'avertissement ignoré' },
    ];
    const { dayDir } = cleanDay({ 'collect-report.json': JSON.stringify({ ...collect, degraded: true }) });
    const note = buildNotification(dayDir, DAY, { secrets: ['WEBZ-TEMOIN-456'] }).notes[0];
    expect(note).toMatch(/^collecte dégradée : exa : HTTP 401 sur https:\/\/api\.exa\.ai\/search\?apikey=\*\*\* x+… ; webz : clé \*\*\* refusée$/);
    expect(note).not.toMatch(/TEMOIN|troisième|avertissement/);
  });

  it('publication dégradée hors Drive : PDF non enregistré, ou première erreur', () => {
    const pdfLost = cleanDay({ 'publish-report.json': publishReport(['fr', 'en', 'es'], 'sent', 0, { status: 'degraded', files: [{ name: `Daily Brief ${DAY}.pdf`, bucket: 'pdf', stored: false }], issues: [{ level: 'error', message: 'Storage : HTTP 500' }] }) });
    expect(buildNotification(pdfLost.dayDir, DAY).message).toBe('Brief du jour prêt : 10 sujets, 23 médias (PDF non enregistré dans Storage)');
    const other = cleanDay({ 'publish-report.json': publishReport(['fr', 'en', 'es'], 'sent', 0, { status: 'degraded', files: [], issues: [{ level: 'warning', message: 'w' }, { level: 'error', lang: 'es', message: 'Thread inconnu' }] }) });
    expect(buildNotification(other.dayDir, DAY).notes).toEqual(['publication dégradée : ES : Thread inconnu']);
    const mp3 = cleanDay({ 'publish-report.json': publishReport(['fr', 'en', 'es'], 'pending', 0, { status: 'degraded', files: [{ name: `Daily Brief ${DAY} FR.mp3`, bucket: 'audio', stored: false }] }) });
    expect(buildNotification(mp3.dayDir, DAY).notes).toEqual(['MP3 non enregistré dans Storage : FR', 'Drive en attente']);
  });

  it('publication dégradée par une édition manquante : pas de note « publication dégradée » en plus de « édition ES manquante »', () => {
    const { dayDir } = cleanDay({ 'publish-report.json': publishReport(['fr', 'en'], 'sent', 0, { status: 'degraded', files: [], issues: [] }) });
    expect(buildNotification(dayDir, DAY).message).toBe('Brief incomplet : édition ES manquante — 8 sujets, 15 médias');
  });

  it('audio « invalid » parce qu’un ancien fichier n’a pas pu être supprimé : le message du lot 5', () => {
    const { dayDir } = cleanDay({ 'audio-report.json': audioReport(DAY, [], { exitCode: 2, status: 'invalid', issues: [{ level: 'error', message: `ancien fichier audio impossible à supprimer : Daily Brief ${DAY} FR.mp3 (EACCES)` }] }) });
    expect(buildNotification(dayDir, DAY).notes).toEqual(['audio : ancien fichier audio impossible à supprimer, éditions sans lecteur']);
  });

  it('répétition : l’audio désactivé est celui de la répétition', () => {
    const { dayDir } = cleanDay({ 'publish-report.json': '', 'audio-report.json': audioReport(DAY, [], { status: 'disabled' }) });
    expect(buildNotification(dayDir, DAY, { dryRun: true }).message).toBe('Répétition sans publication : 10 sujets, 23 médias (audio désactivé (répétition))');
  });
});

describe('CLI brief:notify', () => {
  it('--record sans variables Supabase : dit que la ligne runs n’est pas écrite, puis le message en dernière ligne', () => {
    const { outDir } = makeDay({ extra: { 'collect-report.json': JSON.stringify({ ...JSON.parse(stepReports()['collect-report.json']), exitCode: 2 }) } });
    const r = runCli('pipeline/run/notify-cli.ts', ['--date', DAY, '--out', outDir, '--record']);
    expect(r.status).toBe(2);
    const lines = r.stdout.trim().split('\n');
    expect(lines[0]).toMatch(/^ligne runs non écrite : /);
    expect(lines.at(-1)).toMatch(/^Brief incomplet : collecte impossible : aucun article/);
  });
});
