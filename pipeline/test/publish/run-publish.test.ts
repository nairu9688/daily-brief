import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { HttpFetch } from '../../collect/http';
import { mp3File, pdfFile } from '../../publish/files';
import { runPublish, type RunPublishOptions } from '../../publish/run-publish';
import { FAKE_KEY, FAKE_URL, fakeSupabase, type FakeSupabase } from '../supabase/fake-supabase';
import { createTestDb, resetData, rows, type TestDb } from '../supabase/pg';
import { DRIVE_TOKEN, startAppsScript } from './apps-script-server';
import { DAY, makeDay, MP3_BYTES, PDF_BYTES, type DayOptions } from './day';
import { stepReports } from './reports';

const NOW = new Date('2026-11-06T04:45:00.000Z');
let db: TestDb;
let fake: FakeSupabase;
let server: Awaited<ReturnType<typeof startAppsScript>>;

beforeAll(async () => {
  db = await createTestDb();
}, 60_000);
afterAll(async () => {
  await db.close();
});
beforeEach(async () => {
  await resetData(db);
  fake = fakeSupabase(db);
  server = await startAppsScript();
});
afterEach(async () => {
  await server.close();
});

const env = () => ({ SUPABASE_URL: FAKE_URL, SUPABASE_SERVICE_ROLE_KEY: FAKE_KEY, APPS_SCRIPT_URL: server.url, APPS_SCRIPT_TOKEN: DRIVE_TOKEN });
/** Lance la publication sur un dossier du jour neuf (ou sur `outDir`), avec une horloge fixe. */
async function publish(day: DayOptions = {}, over: Partial<RunPublishOptions> = {}) {
  const made = over.outDir ? { outDir: over.outDir, dayDir: join(over.outDir, over.date ?? day.date ?? DAY) } : makeDay(day);
  let t = 0;
  const r = await runPublish({
    outDir: made.outDir,
    date: day.date ?? DAY,
    env: env(),
    supabaseFetch: fake.fetch,
    driveFetch: fetch as unknown as HttpFetch,
    driveHosts: [server.host],
    driveTimeoutMs: 5_000,
    now: NOW,
    clock: () => (t += 250),
    ...over,
  });
  return { ...r, ...made };
}
const count = async (table: string) => (await rows<{ n: number }>(db, `select count(*)::int as n from public.${table}`))[0].n;
const runsRow = async () => (await rows<{ date: string; status: string; steps: Record<string, any>; notes: string }>(db, 'select date::text as date, status, steps, notes from public.runs order by date'))[0];
const TREE = ['Daily Brief/2026/11 - Novembre/Daily Brief 2026-11-06.pdf'];

describe('runPublish', () => {
  it('passage complet : éditions, Storage, Drive, runs et rapport', async () => {
    const r = await publish({ audio: ['fr', 'en'], extra: stepReports() });
    expect(r.exitCode).toBe(0);
    expect(r.reportWritten).toBe(true);
    expect(r.report).toEqual({
      date: DAY,
      generatedAt: '2026-11-06T04:45:00.000Z',
      exitCode: 0,
      status: 'ok',
      editions: [
        { lang: 'fr', published: true, stories: 7, sources: 26, vocab: 0, threadsCreated: 4 },
        { lang: 'en', published: true, stories: 1, sources: 11, vocab: 6, threadsCreated: 1 },
        { lang: 'es', published: true, stories: 2, sources: 13, vocab: 6, threadsCreated: 1 },
      ],
      files: [
        { name: 'Daily Brief 2026-11-06.pdf', bucket: 'pdf', path: '2026-11-06/daily-brief-2026-11-06.pdf', stored: true },
        { name: 'Daily Brief 2026-11-06 FR.mp3', bucket: 'audio', path: '2026-11-06/fr.mp3', stored: true },
        { name: 'Daily Brief 2026-11-06 EN.mp3', bucket: 'audio', path: '2026-11-06/en.mp3', stored: true },
      ],
      drive: { status: 'sent', sent: ['Daily Brief 2026-11-06.pdf', 'Daily Brief 2026-11-06 FR.mp3', 'Daily Brief 2026-11-06 EN.mp3'], pending: [], retried: { resolved: [], failed: [], abandoned: 0 } },
      audioPurged: 0,
      runSaved: true,
      durationMs: 500,
      issues: [],
    });
    expect(JSON.parse(readFileSync(join(r.dayDir, 'publish-report.json'), 'utf8'))).toEqual(r.report);
    expect(existsSync(join(r.dayDir, 'publish-report.json.tmp'))).toBe(false);
    expect(await rows(db, 'select lang, status, pdf_path, audio_path from public.editions order by lang')).toEqual([
      { lang: 'en', status: 'published', pdf_path: '2026-11-06/daily-brief-2026-11-06.pdf', audio_path: '2026-11-06/en.mp3' },
      { lang: 'es', status: 'light', pdf_path: '2026-11-06/daily-brief-2026-11-06.pdf', audio_path: null },
      { lang: 'fr', status: 'published', pdf_path: '2026-11-06/daily-brief-2026-11-06.pdf', audio_path: '2026-11-06/fr.mp3' },
    ]);
    expect([...fake.files.keys()].sort()).toEqual(['audio/2026-11-06/en.mp3', 'audio/2026-11-06/fr.mp3', 'pdf/2026-11-06/daily-brief-2026-11-06.pdf']);
    expect(server.google.tree()).toEqual([...TREE, 'Daily Brief/2026/11 - Novembre/Daily Brief 2026-11-06 FR.mp3', 'Daily Brief/2026/11 - Novembre/Daily Brief 2026-11-06 EN.mp3']);
    expect(await count('drive_pending')).toBe(0);
  });

  it('écrit la ligne runs : statut, bilan de chaque étape, édition allégée recopiée de la collecte', async () => {
    await publish({ extra: stepReports() });
    const run = await runsRow();
    expect([run.date, run.status, run.notes]).toEqual([DAY, 'ok', '3 édition(s) publiée(s) : FR, EN, ES ; Drive : sent']);
    expect(Object.keys(run.steps).sort()).toEqual(['closedThreads', 'collect', 'context', 'drive', 'publish', 'render', 'verify']);
    expect(run.steps.collect.perLang.es).toEqual({ articles: 52, fullTexts: 9, light: true });
    expect(run.steps.collect.status).toBe('degraded');
    expect(run.steps.verify.counters).toEqual({ editions: 3, fixed: 1, warnings: 1, errors: 0 });
    expect(run.steps.publish).toEqual({
      status: 'ok',
      finishedAt: '2026-11-06T04:45:00.000Z',
      durationMs: 250,
      counters: { editions: 3, stories: 10, sources: 50, vocab: 12, threadsCreated: 6, files: 1, audioPurged: 0 },
      errors: [],
    });
    expect(run.steps.drive).toEqual({ status: 'sent', counters: { sent: 1, pending: 0, retriedResolved: 0, retriedFailed: 0, abandoned: 0 }, errors: [] });
  });

  it('relancer la date remplace tout proprement : mêmes lignes, un seul fichier dans Drive, une seule ligne runs', async () => {
    const first = await publish();
    const before = [await count('editions'), await count('stories'), await count('sources'), await count('vocab_items'), await count('threads'), await count('thread_events'), await count('runs')];
    const second = await publish({}, { outDir: first.outDir });
    expect(second.report.editions.map((e) => e.threadsCreated)).toEqual([0, 0, 0]);
    expect([await count('editions'), await count('stories'), await count('sources'), await count('vocab_items'), await count('threads'), await count('thread_events'), await count('runs')]).toEqual(before);
    expect(server.google.tree()).toEqual(['Daily Brief/2026/11 - Novembre/Daily Brief 2026-11-06.pdf (corbeille)', ...TREE]);
    expect(fake.files.size).toBe(1);
  });

  it('garde les fermetures de Threads notées par brief:context dans runs', async () => {
    await db.query(`insert into public.runs (date, status, steps) values ($1, 'running', '{"closedThreads":["t-1","t-2"]}')`, [DAY]);
    await publish();
    const run = await runsRow();
    expect(run.status).toBe('ok');
    expect(run.steps.closedThreads).toEqual(['t-1', 't-2']);
  });

  it('supprime d’abord l’ancien rapport', async () => {
    const { outDir, dayDir } = makeDay();
    writeFileSync(join(dayDir, 'publish-report.json'), '{"exitCode":0,"périmé":true}');
    const r = await publish({}, { outDir, env: {} });
    expect(r.exitCode).toBe(2);
    expect(JSON.parse(readFileSync(join(dayDir, 'publish-report.json'), 'utf8')).périmé).toBeUndefined();
  });

  it('Drive en panne : éditions publiées, fichiers mis en attente, code 0 et statut dégradé', async () => {
    server.state.mode = 'http-500';
    const r = await publish({ audio: ['fr'] });
    expect(r.exitCode).toBe(0);
    expect(r.report.status).toBe('degraded');
    expect(r.report.drive).toEqual({ status: 'pending', sent: [], pending: ['Daily Brief 2026-11-06.pdf', 'Daily Brief 2026-11-06 FR.mp3'], retried: { resolved: [], failed: [], abandoned: 0 } });
    expect(r.report.issues).toEqual([{ level: 'warning', message: 'Drive : 2 fichier(s) non déposé(s) (Drive Daily Brief 2026-11-06.pdf : HTTP 500) — mis en attente, retentés au prochain passage' }]);
    expect(await rows(db, 'select date::text as date, files, attempts, last_error from public.drive_pending')).toEqual([
      { date: DAY, files: [pdfFile(DAY), mp3File(DAY, 'fr')], attempts: 1, last_error: 'Drive Daily Brief 2026-11-06 FR.mp3 : HTTP 500' },
    ]);
    expect(await count('editions')).toBe(3);
    const run = await runsRow();
    expect([run.status, run.steps.drive.status, run.steps.drive.errors.length]).toEqual(['degraded', 'pending', 2]);
  });

  it('le lendemain, le dépôt en attente est retenté d’abord, puis soldé', async () => {
    server.state.mode = 'http-500';
    await publish({ audio: ['fr'] });
    server.state.mode = 'ok';
    const next = await publish({ date: '2026-11-07' }, { now: new Date('2026-11-07T04:45:00Z') });
    expect(next.report.drive).toEqual({ status: 'sent', sent: ['Daily Brief 2026-11-07.pdf'], pending: [], retried: { resolved: [DAY], failed: [], abandoned: 0 } });
    expect(next.report.status).toBe('ok');
    expect(await count('drive_pending')).toBe(0);
    expect(server.google.tree()).toEqual([...TREE, 'Daily Brief/2026/11 - Novembre/Daily Brief 2026-11-06 FR.mp3', 'Daily Brief/2026/11 - Novembre/Daily Brief 2026-11-07.pdf']);
    // Les fichiers retentés viennent de Storage : mêmes octets que ceux publiés la veille.
    const files = server.google.root.folders[0].folders[0].folders[0].files;
    expect([files[0].bytes, files[1].bytes]).toEqual([PDF_BYTES, MP3_BYTES]);
    // L'ordre : la relance précède l'envoi du jour.
    expect(server.hits.filter((h) => h.method === 'POST').slice(-3).map((h) => JSON.parse(h.body).date)).toEqual([DAY, DAY, '2026-11-07']);
  });

  it('relancer une date dont le dépôt était en attente le solde sans passer par la relance', async () => {
    server.state.mode = 'http-500';
    const first = await publish();
    server.state.mode = 'ok';
    const second = await publish({}, { outDir: first.outDir });
    expect(second.report.drive).toMatchObject({ status: 'sent', retried: { resolved: [], failed: [] } });
    expect(await count('drive_pending')).toBe(0);
  });

  it('sans configuration Supabase : code 2, rapport écrit, aucun appel à Supabase', async () => {
    const r = await publish({}, { env: { APPS_SCRIPT_URL: server.url, APPS_SCRIPT_TOKEN: DRIVE_TOKEN } });
    expect(r.exitCode).toBe(2);
    expect(r.report.status).toBe('failed');
    expect(r.report.issues.filter((i) => i.level === 'error').map((i) => i.message)).toEqual([
      'SUPABASE_URL ou SUPABASE_SERVICE_ROLE_KEY absente : rien n’est publié dans Supabase',
      'aucune édition publiée',
    ]);
    expect(r.report.editions.map((e) => e.published)).toEqual([false, false, false]);
    expect(fake.calls).toEqual([]);
    // Le PDF part quand même dans Drive : l'archive ne dépend pas de Supabase.
    expect(r.report.drive.status).toBe('sent');
    expect(server.google.tree()).toEqual(TREE);
    expect(existsSync(join(r.dayDir, 'publish-report.json'))).toBe(true);
  });

  it('sans configuration Drive : avertissement, publication complète, rien en attente', async () => {
    const r = await publish({}, { env: { SUPABASE_URL: FAKE_URL, SUPABASE_SERVICE_ROLE_KEY: FAKE_KEY } });
    expect(r.exitCode).toBe(0);
    expect(r.report.status).toBe('ok');
    expect(r.report.drive.status).toBe('skipped');
    expect(r.report.issues).toEqual([{ level: 'warning', message: 'APPS_SCRIPT_URL ou APPS_SCRIPT_TOKEN absente : dépôt Drive ignoré' }]);
    expect(await count('drive_pending')).toBe(0);
    expect(server.hits).toEqual([]);
  });

  it('URL Apps Script hors de Google : erreur, le jeton n’est envoyé nulle part', async () => {
    const r = await publish({}, { env: { ...env(), APPS_SCRIPT_URL: 'https://exemple.fr/macros/s/x/exec' }, driveHosts: undefined });
    expect(r.exitCode).toBe(0);
    expect(r.report.status).toBe('degraded');
    expect(r.report.issues).toEqual([{ level: 'error', message: 'APPS_SCRIPT_URL invalide : application web Apps Script attendue (https://script.google.com/macros/s/…/exec) : dépôt Drive ignoré' }]);
    expect(server.hits).toEqual([]);
  });

  it('clé Supabase refusée : code 2, Supabase coupé après le premier appel, rien en base', async () => {
    const r = await publish({}, { env: { ...env(), SUPABASE_SERVICE_ROLE_KEY: 'mauvaise-clé-de-service-000000' } });
    expect(r.exitCode).toBe(2);
    expect(r.report.runSaved).toBe(false);
    expect(fake.calls).toHaveLength(1);
    expect(await count('editions')).toBe(0);
    expect(r.report.issues.map((i) => i.message)).toContain('aucune édition publiée');
  });

  it('Supabase muet : interrompu au délai, code 2, jamais bloqué', async () => {
    fake.intercept = () => ({ hang: true });
    const started = Date.now();
    const r = await publish({}, { deadlineMs: 300 });
    expect(Date.now() - started).toBeLessThan(5_000);
    expect(r.exitCode).toBe(2);
    expect(r.reportWritten).toBe(true);
  });

  it('une édition invalide n’empêche pas les autres ; statut dégradé', async () => {
    const { outDir, dayDir } = makeDay();
    writeFileSync(join(dayDir, 'en.final.json'), '{ tronqué');
    const r = await publish({}, { outDir });
    expect(r.exitCode).toBe(0);
    expect(r.report.status).toBe('degraded');
    expect(r.report.editions.map((e) => [e.lang, e.published])).toEqual([
      ['fr', true],
      ['es', true],
    ]);
    expect(r.report.issues).toHaveLength(1);
    expect(r.report.issues[0]).toMatchObject({ level: 'error', lang: 'en' });
    expect((await runsRow()).steps.publish.errors[0]).toMatch(/^EN : en\.final\.json illisible/);
  });

  it('sans render-report.json : code 2, rien n’est envoyé, la ligne runs dit « failed »', async () => {
    const { outDir, dayDir } = makeDay();
    writeFileSync(join(dayDir, 'render-report.json'), '');
    const r = await publish({}, { outDir });
    expect(r.exitCode).toBe(2);
    expect(r.report.issues.map((i) => i.message)).toEqual(['render-report.json illisible : Unexpected end of JSON input', 'render-report.json illisible : étape notée « unreadable » dans runs', 'aucune édition publiée']);
    expect(fake.files.size).toBe(0);
    expect(server.hits).toEqual([]);
    expect((await runsRow()).status).toBe('failed');
  });

  it('PDF refusé par Storage : éditions publiées sans PDF, Drive servi, statut dégradé', async () => {
    fake.intercept = (c) => (c.path.startsWith('/storage/v1/object/pdf/') ? { status: 500, json: {} } : undefined);
    const r = await publish();
    expect(r.exitCode).toBe(0);
    expect(r.report.status).toBe('degraded');
    expect(r.report.files).toEqual([{ name: 'Daily Brief 2026-11-06.pdf', bucket: 'pdf', path: '2026-11-06/daily-brief-2026-11-06.pdf', stored: false }]);
    expect(await rows(db, 'select distinct pdf_path from public.editions')).toEqual([{ pdf_path: null }]);
    expect(r.report.drive.status).toBe('sent');
  });

  it('PDF absent de Storage et Drive en panne : ni déposé ni en attente, c’est une erreur', async () => {
    fake.intercept = (c) => (c.path.startsWith('/storage/v1/object/pdf/') ? { status: 500, json: {} } : undefined);
    server.state.mode = 'http-500';
    const r = await publish();
    expect(r.exitCode).toBe(0);
    expect(r.report.drive).toMatchObject({ status: 'failed', sent: [], pending: [] });
    expect(r.report.issues.at(-1)).toEqual({ level: 'error', message: 'Drive : Daily Brief 2026-11-06.pdf ni déposé(s) ni mis en attente (absent(s) de Supabase Storage)' });
    expect(await count('drive_pending')).toBe(0);
  });

  it('un MP3 refusé par Storage rend le passage dégradé, même si le PDF et Drive passent', async () => {
    fake.intercept = (c) => (c.path.startsWith('/storage/v1/object/audio/') ? { status: 500, json: {} } : undefined);
    const r = await publish({ audio: ['fr'] });
    expect(r.exitCode).toBe(0);
    expect(r.report.status).toBe('degraded');
    expect(r.report.files.map((f) => [f.bucket, f.stored])).toEqual([['pdf', true], ['audio', false]]);
    expect(r.report.drive.status).toBe('sent');
    expect((await runsRow()).status).toBe('degraded');
  });

  it('Drive muet jusqu’à l’échéance : éditions publiées, PDF mis en attente, ligne runs écrite', async () => {
    server.state.mode = 'hang';
    const started = Date.now();
    // Drive est coupé 1 s après le début ; l'échéance globale tombe à 4 s.
    const r = await publish({}, { deadlineMs: 4_000, driveReserveMs: 3_000, driveTimeoutMs: 60_000 });
    expect(Date.now() - started).toBeLessThan(10_000);
    expect(r.exitCode).toBe(0);
    expect(r.report.status).toBe('degraded');
    expect(r.report.runSaved).toBe(true);
    expect(r.report.drive).toMatchObject({ status: 'pending', pending: ['Daily Brief 2026-11-06.pdf'] });
    expect((await rows<{ date: string }>(db, 'select date::text as date from public.drive_pending')).map((x) => x.date)).toEqual([DAY]);
    expect((await runsRow()).status).toBe('degraded');
  });

  it('échéance globale déjà passée : la mise en attente et la ligne runs ont leur propre délai', async () => {
    server.state.mode = 'hang';
    const r = await publish({}, { deadlineMs: 2_500, driveReserveMs: 0, driveTimeoutMs: 60_000 });
    expect(r.exitCode).toBe(0);
    expect(r.report.runSaved).toBe(true);
    expect(r.report.drive.status).toBe('pending');
    expect(await count('drive_pending')).toBe(1);
  });

  it('mise en attente impossible : le message le dit, sans accuser Storage', async () => {
    server.state.mode = 'http-500';
    fake.intercept = (c) => (c.path.endsWith('/drive_pending_put') ? { status: 500, json: {} } : undefined);
    const r = await publish();
    expect(r.report.drive.status).toBe('failed');
    const messages = r.report.issues.map((i) => i.message);
    expect(messages).toContain('mise en attente Drive impossible : Supabase drive_pending_put : HTTP 500');
    expect(messages.some((m) => m.includes('absent(s) de Supabase Storage'))).toBe(false);
    expect(messages).toContain('Drive : Daily Brief 2026-11-06.pdf ni déposé(s) ni mis en attente (mise en attente impossible)');
  });

  it('purge les MP3 de plus de 30 jours après une publication réussie', async () => {
    await db.query(`insert into public.editions (date, lang, region, headline, morning_brief, generated_at, audio_path) values ('2026-10-01', 'fr', 'r', 'h', '[]', now(), '2026-10-01/fr.mp3')`);
    fake.files.set('audio/2026-10-01/fr.mp3', { bytes: MP3_BYTES, contentType: 'audio/mpeg' });
    const r = await publish();
    expect(r.report.audioPurged).toBe(1);
    expect(fake.files.has('audio/2026-10-01/fr.mp3')).toBe(false);
  });

  it('date invalide : code 2, aucun fichier écrit', async () => {
    const { outDir } = makeDay();
    const r = await publish({}, { outDir, date: '2026-02-30' });
    expect(r).toMatchObject({ exitCode: 2, reportWritten: false });
    expect(r.report.issues).toEqual([{ level: 'error', message: 'date incorrecte : « 2026-02-30 »' }]);
    expect(existsSync(join(outDir, '2026-02-30'))).toBe(false);
  });

  it('aucun secret dans le rapport, dans runs ni dans drive_pending', async () => {
    // Des erreurs qui citent la clé, le jeton et l'URL de l'application.
    const leakyDrive: HttpFetch = async () => {
      throw new Error(`échec vers ${server.url} avec ${DRIVE_TOKEN}`);
    };
    fake.intercept = (c) => (c.path.endsWith('/audio_expired') ? { status: 400, json: { message: `clé ${FAKE_KEY} citée` } } : undefined);
    const r = await publish({}, { driveFetch: leakyDrive });
    expect(r.exitCode).toBe(0);
    const everything = readFileSync(join(r.dayDir, 'publish-report.json'), 'utf8') + JSON.stringify(await rows(db, 'select * from public.runs')) + JSON.stringify(await rows(db, 'select * from public.drive_pending'));
    for (const secret of [FAKE_KEY, DRIVE_TOKEN, server.url]) expect(everything).not.toContain(secret);
    expect(everything).toContain('échec vers *** avec ***');
    expect(everything).toContain('clé *** citée');
  });
});
