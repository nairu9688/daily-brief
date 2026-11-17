import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { HttpFetch } from '../../collect/http';
import { purgeExpiredAudio } from '../../publish/audio-purge';
import { createDriveClient, type DriveClient } from '../../publish/drive';
import { mp3File, pdfFile, type DayFile } from '../../publish/files';
import { MAX_ATTEMPTS, queuePending, resolvePending, retryPending } from '../../publish/retry-pending';
import { createSupabaseClient, type SupabaseClient } from '../../supabase/client';
import { FAKE_KEY, FAKE_URL, fakeSupabase, type FakeSupabase } from '../supabase/fake-supabase';
import { ALLOWED_EMAIL, createTestDb, resetData, rows, rpc, type TestDb } from '../supabase/pg';
import { DRIVE_TOKEN, startAppsScript } from './apps-script-server';
import { MP3_BYTES, PDF_BYTES } from './day';

const TODAY = '2026-11-08';
let db: TestDb;
let fake: FakeSupabase;
let client: SupabaseClient;
let server: Awaited<ReturnType<typeof startAppsScript>>;
let drive: DriveClient;

beforeAll(async () => {
  db = await createTestDb();
}, 60_000);
afterAll(async () => {
  await db.close();
});
beforeEach(async () => {
  await resetData(db);
  fake = fakeSupabase(db);
  client = createSupabaseClient({ url: FAKE_URL, serviceKey: FAKE_KEY }, fake.fetch);
  server = await startAppsScript();
  drive = createDriveClient({ url: server.url, token: DRIVE_TOKEN }, fetch as unknown as HttpFetch, { hosts: [server.host], timeoutMs: 5_000 });
});
afterEach(async () => {
  await server.close();
});

const pending = () => rows<{ date: string; files: DayFile[]; attempts: number; last_error: string | null }>(db, 'select date::text as date, files, attempts, last_error from public.drive_pending order by date');
/** Met un fichier dans le faux Storage et renvoie sa description. */
function stored(file: DayFile, bytes: Buffer = file.bucket === 'pdf' ? PDF_BYTES : MP3_BYTES): DayFile {
  fake.files.set(`${file.bucket}/${file.path}`, { bytes, contentType: file.mimeType });
  return file;
}

describe('fonctions SQL drive_pending_*', () => {
  it('put : première mise en attente à 1 tentative, puis une de plus à chaque nouvel échec', async () => {
    await queuePending(client, '2026-11-06', [pdfFile('2026-11-06')], 'Drive : HTTP 500');
    expect(await pending()).toEqual([{ date: '2026-11-06', files: [pdfFile('2026-11-06')], attempts: 1, last_error: 'Drive : HTTP 500' }]);
    await queuePending(client, '2026-11-06', [pdfFile('2026-11-06'), mp3File('2026-11-06', 'fr')], 'x'.repeat(900));
    const [row] = await pending();
    expect([row.attempts, row.files.length, row.last_error!.length]).toEqual([2, 2, 500]);
  });

  it('list : les plus anciens d’abord, sous le plafond de tentatives ; compte les abandonnés', async () => {
    for (const [date, attempts] of [['2026-11-03', 5], ['2026-11-05', 1], ['2026-11-04', 4], ['2026-11-02', 9]] as const) {
      await db.query(`insert into public.drive_pending (date, files, attempts) values ($1, '[]', $2)`, [date, attempts]);
    }
    expect(await rpc(db, 'drive_pending_list', { p_max_attempts: 5, p_limit: 10 })).toEqual({
      rows: [
        { date: '2026-11-04', files: [], attempts: 4 },
        { date: '2026-11-05', files: [], attempts: 1 },
      ],
      abandoned: 2,
    });
    expect(((await rpc(db, 'drive_pending_list', { p_max_attempts: 5, p_limit: 1 })) as { rows: unknown[] }).rows).toHaveLength(1);
  });

  it('resolve supprime la ligne ; sans ligne, rien ne se passe', async () => {
    await queuePending(client, '2026-11-06', [pdfFile('2026-11-06')], 'x');
    await resolvePending(client, '2026-11-06');
    await resolvePending(client, '2026-11-06');
    expect(await pending()).toEqual([]);
  });

  it('réservées à la clé service', async () => {
    for (const role of ['anon', { email: ALLOWED_EMAIL }] as const) {
      await expect(rpc(db, 'drive_pending_list', {}, role)).rejects.toThrow(/permission denied/);
      await expect(rpc(db, 'drive_pending_resolve', { p_date: '2026-11-06' }, role)).rejects.toThrow(/permission denied/);
      await expect(rpc(db, 'audio_expired', { p_date: '2026-11-06' }, role)).rejects.toThrow(/permission denied/);
    }
  });
});

describe('retryPending', () => {
  it('relit les fichiers dans Storage, les dépose dans Drive et solde la ligne', async () => {
    await queuePending(client, '2026-11-06', [stored(pdfFile('2026-11-06')), stored(mp3File('2026-11-06', 'fr'))], 'Drive : HTTP 500');
    const r = await retryPending(client, drive, TODAY);
    expect(r).toEqual({ resolved: ['2026-11-06'], failed: [], abandoned: 0, issues: [] });
    expect(await pending()).toEqual([]);
    expect(server.google.tree()).toEqual(['Daily Brief/2026/11 - Novembre/Daily Brief 2026-11-06.pdf', 'Daily Brief/2026/11 - Novembre/Daily Brief 2026-11-06 FR.mp3']);
    expect(server.google.root.folders[0].folders[0].folders[0].files[0].bytes).toEqual(PDF_BYTES);
  });

  it('un 400 de Storage qui n’est pas « objet absent » laisse la ligne en attente (pas de dépôt abandonné à tort)', async () => {
    await queuePending(client, '2026-11-06', [stored(pdfFile('2026-11-06'))], 'x');
    fake.intercept = (call) => (call.method === 'GET' && call.path.startsWith('/storage/') ? { status: 400, json: { statusCode: '403', error: 'Unauthorized', message: 'denied' } } : undefined);
    const r = await retryPending(client, drive, TODAY);
    expect(r.resolved).toEqual([]);
    expect(r.failed).toEqual(['2026-11-06']);
    expect(r.issues).toEqual([{ level: 'warning', message: expect.stringContaining('HTTP 400 — denied') }]);
    const [row] = await pending();
    expect([row.attempts, row.files]).toEqual([2, [pdfFile('2026-11-06')]]);
    expect(row.last_error).toContain('HTTP 400');
    expect(server.hits).toEqual([]);
  });

  it('ne touche pas au dépôt du jour, que le passage en cours envoie lui-même', async () => {
    await queuePending(client, TODAY, [stored(pdfFile(TODAY))], 'x');
    const r = await retryPending(client, drive, TODAY);
    expect(r).toEqual({ resolved: [], failed: [], abandoned: 0, issues: [] });
    expect((await pending())[0].attempts).toBe(1);
    expect(server.hits).toEqual([]);
  });

  it('nouvel échec : une tentative de plus, seuls les fichiers restants sont gardés', async () => {
    await queuePending(client, '2026-11-06', [stored(pdfFile('2026-11-06')), stored(mp3File('2026-11-06', 'fr'))], 'x');
    // Le PDF passe, puis Apps Script tombe en panne pour le MP3.
    const flaky = createDriveClient({ url: server.url, token: DRIVE_TOKEN }, async (url, init) => {
      if (init?.body?.includes('FR.mp3')) server.state.mode = 'http-500';
      return (fetch as unknown as HttpFetch)(url, init);
    }, { hosts: [server.host], timeoutMs: 5_000 });
    const r = await retryPending(client, flaky, TODAY);
    expect(r.resolved).toEqual([]);
    expect(r.failed).toEqual(['2026-11-06']);
    expect(r.issues).toEqual([{ level: 'warning', message: 'dépôt Drive du 2026-11-06 toujours en attente (tentative 2 sur 5) : Drive Daily Brief 2026-11-06 FR.mp3 : HTTP 500' }]);
    expect(await pending()).toEqual([{ date: '2026-11-06', files: [mp3File('2026-11-06', 'fr')], attempts: 2, last_error: 'Drive Daily Brief 2026-11-06 FR.mp3 : HTTP 500' }]);
    expect(server.google.tree()).toEqual(['Daily Brief/2026/11 - Novembre/Daily Brief 2026-11-06.pdf']);
  });

  it('plafond de tentatives : au bout de 5 échecs le dépôt est abandonné et signalé', async () => {
    await queuePending(client, '2026-11-06', [stored(pdfFile('2026-11-06'))], 'x');
    server.state.mode = 'http-500';
    for (let i = 0; i < 6; i++) {
      // Un client neuf à chaque passage, comme chaque matin : le disjoncteur ne se reporte pas.
      const d = createDriveClient({ url: server.url, token: DRIVE_TOKEN }, fetch as unknown as HttpFetch, { hosts: [server.host], timeoutMs: 5_000 });
      await retryPending(client, d, TODAY);
    }
    expect((await pending())[0].attempts).toBe(MAX_ATTEMPTS);
    expect(server.hits).toHaveLength(MAX_ATTEMPTS - 1);
    const last = await retryPending(client, drive, TODAY);
    expect(last).toEqual({ resolved: [], failed: [], abandoned: 1, issues: [{ level: 'warning', message: '1 dépôt(s) Drive abandonné(s) après 5 tentatives (table drive_pending)' }] });
  });

  it('fichier purgé de Storage : le dépôt est abandonné et reste visible, jamais soldé comme une réussite', async () => {
    await queuePending(client, '2026-10-01', [stored(pdfFile('2026-10-01')), mp3File('2026-10-01', 'es')], 'x');
    const r = await retryPending(client, drive, TODAY);
    expect(r.resolved).toEqual([]);
    expect(r.abandoned).toBe(1);
    expect(r.issues).toEqual([
      { level: 'warning', message: 'Daily Brief 2026-10-01 ES.mp3 n’existe plus dans Supabase Storage : dépôt Drive abandonné' },
      { level: 'warning', message: 'dépôt Drive du 2026-10-01 abandonné : fichier(s) introuvable(s) dans Storage : Daily Brief 2026-10-01 ES.mp3' },
    ]);
    expect(server.google.tree()).toEqual(['Daily Brief/2026/10 - Octobre/Daily Brief 2026-10-01.pdf']);
    expect(await pending()).toEqual([{ date: '2026-10-01', files: [mp3File('2026-10-01', 'es')], attempts: MAX_ATTEMPTS, last_error: 'fichier(s) introuvable(s) dans Storage : Daily Brief 2026-10-01 ES.mp3' }]);
    // Abandonné : plus retenté ; plus de 30 jours après sa date, il quitte la table au passage suivant.
    expect((await retryPending(client, drive, TODAY)).abandoned).toBe(0);
    expect(await pending()).toEqual([]);
  });

  it('tous les fichiers perdus : rien n’est envoyé et le dépôt est abandonné, pas soldé', async () => {
    await queuePending(client, '2026-10-01', [pdfFile('2026-10-01')], 'x');
    const r = await retryPending(client, drive, TODAY);
    expect(r.resolved).toEqual([]);
    expect(r.abandoned).toBe(1);
    expect((await pending())[0]).toMatchObject({ attempts: MAX_ATTEMPTS, last_error: 'fichier(s) introuvable(s) dans Storage : Daily Brief 2026-10-01.pdf' });
    expect(server.hits).toEqual([]);
  });

  it('ligne altérée : fichier d’une autre date, chemin étranger ou contenu qui n’est pas un PDF — jamais envoyé', async () => {
    stored(pdfFile('2026-11-06'), Buffer.from('<html>pas un pdf</html>'));
    fake.files.set('pdf/secret/autre.pdf', { bytes: PDF_BYTES, contentType: 'application/pdf' });
    const files = [pdfFile('2026-11-06'), { ...pdfFile('2026-11-06'), path: 'secret/autre.pdf' }, pdfFile('2026-11-05'), { name: 42 }, 'x'];
    await db.query(`insert into public.drive_pending (date, files, attempts) values ('2026-11-06', $1, 1), ('2026-11-05', '{"pas":"une liste"}', 1)`, [JSON.stringify(files)]);
    const r = await retryPending(client, drive, TODAY);
    // Rien d'exploitable n'a été envoyé : les deux dépôts sont abandonnés et restent visibles, jamais soldés.
    expect(r.resolved).toEqual([]);
    expect(r.abandoned).toBe(2);
    expect(r.issues.map((i) => i.message)).toEqual([
      'dépôt Drive du 2026-11-05 abandonné : fichier(s) introuvable(s) dans Storage : liste de fichiers illisible',
      'Daily Brief 2026-11-06.pdf relu dans Supabase Storage n’a pas le bon format : dépôt Drive abandonné',
      'dépôt en attente du 2026-11-06 : fichier incohérent ignoré',
      'dépôt en attente du 2026-11-06 : fichier incohérent ignoré',
      'dépôt en attente du 2026-11-06 : fichier incohérent ignoré',
      'dépôt en attente du 2026-11-06 : fichier incohérent ignoré',
      'dépôt Drive du 2026-11-06 abandonné : fichier(s) introuvable(s) dans Storage : Daily Brief 2026-11-06.pdf (format invalide), 4 entrée(s) incohérente(s)',
    ]);
    expect((await pending()).map((p) => [p.date, p.attempts])).toEqual([
      ['2026-11-05', MAX_ATTEMPTS],
      ['2026-11-06', MAX_ATTEMPTS],
    ]);
    expect((await pending())[0].last_error).toBe('fichier(s) introuvable(s) dans Storage : liste de fichiers illisible');
    expect(server.hits).toEqual([]);
    expect(fake.calls.filter((c) => c.method === 'GET').map((c) => c.path)).toEqual(['/storage/v1/object/pdf/2026-11-06/daily-brief-2026-11-06.pdf']);
  });

  it('jeton Drive refusé : arrêt immédiat, les autres dépôts ne perdent pas de tentative', async () => {
    for (const date of ['2026-11-04', '2026-11-05', '2026-11-06']) await queuePending(client, date, [stored(pdfFile(date)), stored(mp3File(date, 'fr'))], 'x');
    const refused = createDriveClient({ url: server.url, token: 'mauvais-jeton-de-test-0123456789-abcdef' }, fetch as unknown as HttpFetch, { hosts: [server.host], timeoutMs: 5_000 });
    const r = await retryPending(client, refused, TODAY);
    expect(r.failed).toEqual(['2026-11-04']);
    expect((await pending()).map((p) => [p.date, p.attempts, p.files.length])).toEqual([
      ['2026-11-04', 2, 2],
      ['2026-11-05', 1, 2],
      ['2026-11-06', 1, 2],
    ]);
    expect(server.hits.filter((h) => h.method === 'POST')).toHaveLength(1);
  });

  it('au plus 5 dépôts retentés par passage', async () => {
    for (let d = 1; d <= 7; d++) await queuePending(client, `2026-10-0${d}`, [stored(pdfFile(`2026-10-0${d}`))], 'x');
    const r = await retryPending(client, drive, TODAY);
    expect(r.resolved).toEqual(['2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04', '2026-10-05']);
    expect((await pending()).map((p) => p.date)).toEqual(['2026-10-06', '2026-10-07']);
  });

  it('la tentative est comptée avant le traitement : une panne en cours de ligne ne l’efface pas', async () => {
    await queuePending(client, '2026-11-06', [stored(pdfFile('2026-11-06'))], 'x');
    server.state.mode = 'http-500';
    // La mise à jour finale échoue aussi : seul le décompte posé d'avance survit.
    fake.intercept = (c) => (c.path.endsWith('/drive_pending_fail') ? { status: 500, json: {} } : undefined);
    const r = await retryPending(client, drive, TODAY);
    expect(r.failed).toEqual(['2026-11-06']);
    expect(r.issues.at(-1)!.message).toBe('dépôt en attente du 2026-11-06 : mise à jour impossible : Supabase drive_pending_fail : HTTP 500');
    expect((await pending())[0].attempts).toBe(2);
  });

  it('prise en charge impossible : cette ligne est sautée, les suivantes sont traitées', async () => {
    await queuePending(client, '2026-10-01', [stored(pdfFile('2026-10-01'))], 'x');
    await queuePending(client, '2026-10-02', [stored(pdfFile('2026-10-02'))], 'x');
    let claims = 0;
    fake.intercept = (c) => (c.path.endsWith('/drive_pending_claim') && claims++ === 0 ? { status: 500, json: {} } : undefined);
    const r = await retryPending(client, drive, TODAY);
    expect(r.resolved).toEqual(['2026-10-02']);
    expect(r.failed).toEqual(['2026-10-01']);
    expect(r.issues.map((i) => i.message)).toEqual(['dépôt en attente du 2026-10-01 : prise en charge impossible : Supabase drive_pending_claim : HTTP 500']);
    expect((await pending()).map((p) => [p.date, p.attempts])).toEqual([['2026-10-01', 1]]);
  });

  it('claim : une tentative de plus, la ligne rendue ; rien au-delà du plafond ni sans ligne', async () => {
    await queuePending(client, '2026-11-06', [pdfFile('2026-11-06')], 'x');
    expect(await rpc(db, 'drive_pending_claim', { p_date: '2026-11-06' })).toEqual({ date: '2026-11-06', files: [pdfFile('2026-11-06')], attempts: 2 });
    expect(await rpc(db, 'drive_pending_claim', { p_date: '2026-11-01' })).toBeNull();
    await db.query(`update public.drive_pending set attempts = 5`);
    expect(await rpc(db, 'drive_pending_claim', { p_date: '2026-11-06' })).toBeNull();
    for (const role of ['anon', { email: ALLOWED_EMAIL }] as const) {
      await expect(rpc(db, 'drive_pending_claim', { p_date: '2026-11-06' }, role)).rejects.toThrow(/permission denied/);
      await expect(rpc(db, 'drive_pending_expire', { p_today: TODAY }, role)).rejects.toThrow(/permission denied/);
    }
  });

  it('dépôts abandonnés depuis plus de 30 jours : supprimés de drive_pending, une seule ligne d’avertissement', async () => {
    for (const [date, attempts] of [['2026-09-01', 5], ['2026-09-15', 7], ['2026-09-20', 2], ['2026-10-20', 5]] as const) {
      await db.query(`insert into public.drive_pending (date, files, attempts) values ($1, '[]', $2)`, [date, attempts]);
    }
    const r = await retryPending(client, drive, TODAY);
    expect(r.issues.map((i) => i.message)).toEqual([
      '2 dépôt(s) Drive abandonné(s) depuis plus de 30 jours supprimé(s) de drive_pending : 2026-09-01, 2026-09-15',
      '1 dépôt(s) Drive abandonné(s) après 5 tentatives (table drive_pending)',
      'dépôt Drive du 2026-09-20 abandonné : fichier(s) introuvable(s) dans Storage : aucun fichier à déposer',
    ]);
    expect((await pending()).map((p) => p.date)).toEqual(['2026-09-20', '2026-10-20']);
  });

  it('Supabase illisible : un avertissement, aucun envoi', async () => {
    fake.intercept = () => ({ status: 500, json: {} });
    const r = await retryPending(client, drive, TODAY);
    expect(r).toEqual({ resolved: [], failed: [], abandoned: 0, issues: [{ level: 'warning', message: 'dépôts Drive en attente illisibles : Supabase drive_pending_list : HTTP 500' }] });
  });
});

describe('purgeExpiredAudio', () => {
  const edition = (date: string, lang: string, audio: string | null) =>
    db.query(`insert into public.editions (date, lang, region, headline, morning_brief, generated_at, audio_path) values ($1, $2, 'r', 'h', '[]', now(), $3)`, [date, lang, audio]);
  const audioPaths = async () => (await rows<{ d: string; audio_path: string | null }>(db, `select date::text as d, audio_path from public.editions order by date, lang`)).map((r) => [r.d, r.audio_path]);

  it('supprime les MP3 de plus de 30 jours du bucket, puis vide audio_path', async () => {
    await edition('2026-10-08', 'fr', '2026-10-08/fr.mp3'); // 31 jours avant le 8 novembre
    await edition('2026-10-08', 'en', '2026-10-08/en.mp3');
    await edition('2026-10-09', 'fr', '2026-10-09/fr.mp3'); // 30 jours : gardé
    await edition('2026-11-08', 'fr', '2026-11-08/fr.mp3');
    await edition('2026-09-01', 'fr', null);
    for (const p of ['2026-10-08/fr.mp3', '2026-10-08/en.mp3', '2026-10-09/fr.mp3', '2026-11-08/fr.mp3']) fake.files.set(`audio/${p}`, { bytes: MP3_BYTES, contentType: 'audio/mpeg' });
    expect(await purgeExpiredAudio(client, TODAY)).toEqual({ removed: 2, issues: [] });
    expect([...fake.files.keys()]).toEqual(['audio/2026-10-09/fr.mp3', 'audio/2026-11-08/fr.mp3']);
    expect(await audioPaths()).toEqual([
      ['2026-09-01', null],
      ['2026-10-08', null],
      ['2026-10-08', null],
      ['2026-10-09', '2026-10-09/fr.mp3'],
      ['2026-11-08', '2026-11-08/fr.mp3'],
    ]);
    // Second passage : plus rien à faire, aucun appel à Storage.
    const before = fake.calls.length;
    expect(await purgeExpiredAudio(client, TODAY)).toEqual({ removed: 0, issues: [] });
    expect(fake.calls.slice(before).map((c) => c.path)).toEqual(['/rest/v1/rpc/audio_expired', '/storage/v1/object/list/audio']);
  });

  it('suppression en échec : avertissement, audio_path intact (rattrapé au passage suivant)', async () => {
    await edition('2026-10-01', 'fr', '2026-10-01/fr.mp3');
    fake.intercept = (c) => (c.method === 'DELETE' ? { status: 500, json: {} } : undefined);
    const r = await purgeExpiredAudio(client, TODAY);
    expect(r).toEqual({ removed: 0, issues: [{ level: 'warning', message: 'purge des MP3 de plus de 30 jours impossible : Supabase Storage (suppression dans audio) : HTTP 500' }] });
    expect(await audioPaths()).toEqual([['2026-10-01', '2026-10-01/fr.mp3']]);
  });

  it('ne supprime jamais un chemin qui n’a pas la forme AAAA-MM-JJ/<langue>.mp3', async () => {
    await edition('2026-10-01', 'fr', '../pdf/2026-10-01/daily-brief-2026-10-01.pdf');
    await edition('2026-10-02', 'fr', '2026-10-02/fr.mp3');
    const r = await purgeExpiredAudio(client, TODAY);
    expect(r).toEqual({ removed: 1, issues: [{ level: 'warning', message: 'purge audio : 1 chemin(s) inattendu(s) retiré(s) de editions.audio_path (aucun fichier supprimé pour eux)' }] });
    expect(fake.calls.find((c) => c.method === 'DELETE')!.body).toBe('{"prefixes":["2026-10-02/fr.mp3"]}');
    // Le chemin douteux est vidé : le prochain passage ne le signale plus.
    expect(await audioPaths()).toEqual([['2026-10-01', null], ['2026-10-02', null]]);
    expect(await purgeExpiredAudio(client, TODAY)).toEqual({ removed: 0, issues: [] });
  });

  it('un chemin dont la date n’est pas celle de l’édition n’est jamais supprimé : il est vidé et signalé une fois', async () => {
    await edition('2026-10-01', 'fr', '2026-11-07/fr.mp3');
    await edition('2026-10-01', 'en', '2026-10-01/en.mp3');
    fake.files.set('audio/2026-11-07/fr.mp3', { bytes: MP3_BYTES, contentType: 'audio/mpeg' });
    fake.files.set('audio/2026-10-01/en.mp3', { bytes: MP3_BYTES, contentType: 'audio/mpeg' });
    const r = await purgeExpiredAudio(client, TODAY);
    expect(r.removed).toBe(1);
    expect(r.issues).toHaveLength(1);
    expect([...fake.files.keys()]).toEqual(['audio/2026-11-07/fr.mp3']);
    expect(await audioPaths()).toEqual([['2026-10-01', null], ['2026-10-01', null]]);
  });

  it('MP3 orphelins : supprimés d’après leur dossier daté, sans ligne d’édition, listage paginé sur deux pages', async () => {
    for (const p of ['2026-08-30/es.mp3', '2026-09-01/fr.mp3', '2026-09-01/en.mp3', '2026-09-01/es.mp3', '2026-09-01/notes.txt', '2026-10-09/fr.mp3', '2026-11-08/fr.mp3']) {
      fake.files.set(`audio/${p}`, { bytes: MP3_BYTES, contentType: 'audio/mpeg' });
    }
    fake.files.set('audio/divers/fr.mp3', { bytes: MP3_BYTES, contentType: 'audio/mpeg' });
    const r = await purgeExpiredAudio(client, TODAY, { pageSize: 2 });
    expect(r).toEqual({ removed: 4, issues: [] });
    expect([...fake.files.keys()].sort()).toEqual(['audio/2026-09-01/notes.txt', 'audio/2026-10-09/fr.mp3', 'audio/2026-11-08/fr.mp3', 'audio/divers/fr.mp3']);
    const lists = fake.calls.filter((c) => c.path === '/storage/v1/object/list/audio').map((c) => JSON.parse(String(c.body)) as { prefix: string; offset: number; limit: number });
    // Racine : 5 entrées en 3 pages de 2 ; dossier du 2026-09-01 : 4 entrées en 3 pages ; 2026-08-30 : 1 page.
    expect(lists.filter((l) => l.prefix === '').map((l) => l.offset)).toEqual([0, 2, 4]);
    expect(lists.filter((l) => l.prefix === '2026-09-01').map((l) => l.offset)).toEqual([0, 2, 4]);
    expect(lists.every((l) => l.limit === 2)).toBe(true);
    expect(fake.calls.filter((c) => c.method === 'DELETE')).toHaveLength(1);
  });
});
