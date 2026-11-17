import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { HttpFetch } from '../../collect/http';
import { createDriveClient, driveConfig, DriveError, MAX_DRIVE_BYTES, MISSING_DRIVE, type DriveClient } from '../../publish/drive';
import { mp3File, pdfFile } from '../../publish/files';
import { DRIVE_TOKEN, startAppsScript } from './apps-script-server';
import { DAY, MP3_BYTES, PDF_BYTES } from './day';

const realFetch = fetch as unknown as HttpFetch;
let server: Awaited<ReturnType<typeof startAppsScript>>;
let drive: DriveClient;
const client = (over: { token?: string; timeoutMs?: number; signal?: AbortSignal } = {}) =>
  createDriveClient({ url: server.url, token: over.token ?? DRIVE_TOKEN }, realFetch, { hosts: [server.host], timeoutMs: over.timeoutMs ?? 5_000, signal: over.signal });
const failure = async (p: Promise<unknown>) => {
  const e = await p.catch((x: unknown) => x);
  expect(e).toBeInstanceOf(DriveError);
  return e as DriveError;
};

beforeEach(async () => {
  server = await startAppsScript();
  drive = client();
});
afterEach(async () => {
  await server.close();
});

describe('driveConfig', () => {
  const URL_OK = 'https://script.google.com/macros/s/AKfycbx/exec';
  it('accepte une application web Apps Script et un jeton de 32 caractères au moins', () => {
    expect(driveConfig({ APPS_SCRIPT_URL: ` ${URL_OK} `, APPS_SCRIPT_TOKEN: ` ${DRIVE_TOKEN} ` })).toEqual({ ok: true, config: { url: URL_OK, token: DRIVE_TOKEN } });
  });

  it('signale une variable absente ou blanche', () => {
    expect(driveConfig({})).toEqual({ ok: false, error: MISSING_DRIVE });
    expect(driveConfig({ APPS_SCRIPT_URL: URL_OK, APPS_SCRIPT_TOKEN: '  ' })).toEqual({ ok: false, error: MISSING_DRIVE });
  });

  it('refuse une URL hors d’Apps Script, en http, ou avec des identifiants ; refuse un jeton court', () => {
    const bad = 'APPS_SCRIPT_URL invalide : application web Apps Script attendue (https://script.google.com/macros/s/…/exec)';
    for (const url of ['https://exemple.fr/macros/s/x/exec', 'http://script.google.com/macros/s/x/exec', 'https://u:p@script.google.com/macros/s/x/exec', 'https://script.google.com.exemple.fr/x']) {
      expect(driveConfig({ APPS_SCRIPT_URL: url, APPS_SCRIPT_TOKEN: DRIVE_TOKEN })).toEqual({ ok: false, error: bad });
    }
    expect(driveConfig({ APPS_SCRIPT_URL: 'pas une url', APPS_SCRIPT_TOKEN: DRIVE_TOKEN }).ok).toBe(false);
    expect(driveConfig({ APPS_SCRIPT_URL: URL_OK, APPS_SCRIPT_TOKEN: 'court' })).toEqual({ ok: false, error: 'APPS_SCRIPT_TOKEN trop court : 32 caractères au moins' });
  });
});

describe('client Drive contre un faux Apps Script local (302)', () => {
  it('POST, puis GET de la redirection : le fichier arrive dans Daily Brief/AAAA/MM - Mois', async () => {
    const id = await drive.send(DAY, pdfFile(DAY), PDF_BYTES);
    expect(id).toBe('file-4');
    expect(server.google.tree()).toEqual(['Daily Brief/2026/11 - Novembre/Daily Brief 2026-11-06.pdf']);
    expect(server.google.root.folders[0].folders[0].folders[0].files[0].bytes).toEqual(PDF_BYTES);
    expect(server.hits.map((h) => [h.method, h.path])).toEqual([
      ['POST', '/macros/s/test/exec'],
      ['GET', '/macros/echo?user_content_key=k1'],
    ]);
    expect(JSON.parse(server.hits[0].body)).toEqual({ token: DRIVE_TOKEN, date: DAY, files: [{ name: 'Daily Brief 2026-11-06.pdf', mimeType: 'application/pdf', base64: PDF_BYTES.toString('base64') }] });
    // Le jeton ne suit pas la redirection.
    expect(server.hits[1].body).toBe('');
  });

  it('un fichier par requête ; renvoyer le même nom le remplace', async () => {
    await drive.send(DAY, pdfFile(DAY), PDF_BYTES);
    await drive.send(DAY, mp3File(DAY, 'fr'), MP3_BYTES);
    await drive.send(DAY, pdfFile(DAY), Buffer.concat([PDF_BYTES, Buffer.from('v2')]));
    expect(server.hits.filter((h) => h.method === 'POST').map((h) => JSON.parse(h.body).files.length)).toEqual([1, 1, 1]);
    expect(server.google.tree()).toEqual([
      'Daily Brief/2026/11 - Novembre/Daily Brief 2026-11-06.pdf (corbeille)',
      'Daily Brief/2026/11 - Novembre/Daily Brief 2026-11-06 FR.mp3',
      'Daily Brief/2026/11 - Novembre/Daily Brief 2026-11-06.pdf',
    ]);
  });

  it('accepte une réponse 200 sans redirection', async () => {
    server.state.mode = 'direct';
    expect(await drive.send(DAY, pdfFile(DAY), PDF_BYTES)).toBe('file-4');
    expect(server.hits).toHaveLength(1);
  });

  it('jeton refusé : erreur fatale, Drive coupé, plus aucun envoi', async () => {
    drive = client({ token: 'mauvais-jeton-de-test-0123456789-abcdef' });
    const e = await failure(drive.send(DAY, pdfFile(DAY), PDF_BYTES));
    expect(e.message).toBe('Drive Daily Brief 2026-11-06.pdf : refus d’Apps Script (unauthorized)');
    expect(e.fatal).toBe(true);
    const again = await failure(drive.send(DAY, mp3File(DAY, 'fr'), MP3_BYTES));
    expect(again.message).toBe('Drive coupé (jeton refusé)');
    expect(server.hits.filter((h) => h.method === 'POST')).toHaveLength(1);
    expect(server.google.tree()).toEqual([]);
  });

  it('refus de validation côté script : erreur non fatale, avec le code', async () => {
    const e = await failure(drive.send('2026-11-07', pdfFile(DAY), PDF_BYTES));
    expect(e.message).toBe('Drive Daily Brief 2026-11-06.pdf : refus d’Apps Script (bad-name)');
    expect(e.fatal).toBe(false);
    expect(drive.breaker.open).toBe(false);
  });

  it('redirection vers la connexion Google : refusée sans la suivre (application non publique)', async () => {
    server.state.mode = 'login';
    const e = await failure(drive.send(DAY, pdfFile(DAY), PDF_BYTES));
    expect(e.message).toBe('Drive Daily Brief 2026-11-06.pdf : redirection hors d’Apps Script (accounts.google.com) : l’application web doit être déployée avec l’accès « Tout le monde »');
    expect(e.fatal).toBe(true);
    expect(server.hits).toHaveLength(1);
    expect(drive.breaker.reason).toBe('application web non publique');
  });

  it('redirections sans fin : abandon après trois sauts', async () => {
    server.state.mode = 'loop';
    const e = await failure(drive.send(DAY, pdfFile(DAY), PDF_BYTES));
    expect(e.message).toBe('Drive Daily Brief 2026-11-06.pdf : trop de redirections');
    expect(server.hits).toHaveLength(4);
  });

  it.each([
    ['html', 'réponse non JSON (page d’erreur d’Apps Script ?)'],
    ['http-500', 'HTTP 500'],
    ['no-id', 'réponse sans l’id du fichier envoyé'],
    ['odd', 'réponse inattendue'],
  ] as const)('mode %s : erreur sans fragment de la réponse', async (mode, message) => {
    server.state.mode = mode;
    const e = await failure(drive.send(DAY, pdfFile(DAY), PDF_BYTES));
    expect(e.message).toBe(`Drive Daily Brief 2026-11-06.pdf : ${message}`);
    expect(e.fatal).toBe(false);
  });

  it('serveur muet : interrompu au délai, et le délai coupe Drive', async () => {
    server.state.mode = 'hang';
    drive = client({ timeoutMs: 100 });
    const e = await failure(drive.send(DAY, pdfFile(DAY), PDF_BYTES));
    expect(e.message).toBe('Drive Daily Brief 2026-11-06.pdf : délai dépassé');
    expect(drive.breaker.reason).toBe('délai dépassé');
    server.state.mode = 'ok';
    await failure(drive.send(DAY, pdfFile(DAY), PDF_BYTES));
    expect(server.hits).toHaveLength(1);
  });

  it('honore le signal de l’appelant', async () => {
    server.state.mode = 'hang';
    const c = new AbortController();
    const p = failure(client({ signal: c.signal }).send(DAY, pdfFile(DAY), PDF_BYTES));
    setTimeout(() => c.abort(), 50);
    expect((await p).message).toMatch(/^Drive Daily Brief 2026-11-06\.pdf : /);
  });

  it('trois échecs de suite coupent Drive', async () => {
    server.state.mode = 'http-500';
    for (let i = 0; i < 3; i++) await failure(drive.send(DAY, pdfFile(DAY), PDF_BYTES));
    server.state.mode = 'ok';
    const e = await failure(drive.send(DAY, pdfFile(DAY), PDF_BYTES));
    expect(e.message).toBe('Drive coupé (source coupée après 3 échecs consécutifs)');
    expect(server.hits).toHaveLength(3);
  });

  it('fichier vide ou trop lourd : refusé sans requête', async () => {
    expect((await failure(drive.send(DAY, pdfFile(DAY), new Uint8Array()))).message).toBe('Daily Brief 2026-11-06.pdf : fichier vide');
    const big = { byteLength: MAX_DRIVE_BYTES + 1 } as Uint8Array;
    expect((await failure(drive.send(DAY, pdfFile(DAY), big))).message).toBe(`Daily Brief 2026-11-06.pdf : trop lourd pour Apps Script (${MAX_DRIVE_BYTES + 1} octets, ${MAX_DRIVE_BYTES} au plus)`);
    expect(server.hits).toEqual([]);
  });

  it('ni le jeton ni l’URL de l’application ne paraissent dans une erreur', async () => {
    const leaky: HttpFetch = async () => {
      throw new Error(`connexion à ${server.url} refusée (jeton ${DRIVE_TOKEN})`);
    };
    const e = await failure(createDriveClient({ url: server.url, token: DRIVE_TOKEN }, leaky, { hosts: [server.host] }).send(DAY, pdfFile(DAY), PDF_BYTES));
    expect(e.message).toBe('Drive Daily Brief 2026-11-06.pdf : connexion à *** refusée (jeton ***)');
    for (const mode of ['html', 'http-500', 'login', 'loop'] as const) {
      server.state.mode = mode;
      const m = (await failure(client().send(DAY, pdfFile(DAY), PDF_BYTES))).message;
      expect(m).not.toContain(DRIVE_TOKEN);
      expect(m).not.toContain(server.url);
      expect(m).not.toContain('user_content_key');
    }
  });
});
