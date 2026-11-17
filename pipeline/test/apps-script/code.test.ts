import { describe, expect, it } from 'vitest';
import { loadCodeGs } from './fake-google';

const TOKEN = 'jeton-de-test-0123456789-abcdefghij';
const PDF = { name: 'Daily Brief 2026-11-06.pdf', mimeType: 'application/pdf', base64: Buffer.from('%PDF-1.7 test').toString('base64') };
const MP3 = { name: 'Daily Brief 2026-11-06 FR.mp3', mimeType: 'audio/mpeg', base64: Buffer.from('ID3 test').toString('base64') };
const body = (extra: Record<string, unknown> = {}) => ({ token: TOKEN, date: '2026-11-06', files: [PDF], ...extra });

describe('Code.gs : fonctions pures', () => {
  const { gs } = loadCodeGs();

  it('folderNames : année, puis « MM - Mois » en français pour les douze mois', () => {
    expect(gs.folderNames('2026-11-06')).toEqual({ year: '2026', month: '11 - Novembre' });
    expect(Array.from({ length: 12 }, (_, i) => gs.folderNames(`2027-${String(i + 1).padStart(2, '0')}-15`).month)).toEqual([
      '01 - Janvier',
      '02 - Février',
      '03 - Mars',
      '04 - Avril',
      '05 - Mai',
      '06 - Juin',
      '07 - Juillet',
      '08 - Août',
      '09 - Septembre',
      '10 - Octobre',
      '11 - Novembre',
      '12 - Décembre',
    ]);
  });

  it('isRealDate : AAAA-MM-JJ existant seulement', () => {
    expect(['2026-11-06', '2028-02-29'].map(gs.isRealDate)).toEqual([true, true]);
    expect(['2026-02-30', '2026-13-01', '2026-1-1', '06/11/2026', '', null, 20261106, '2026-11-06T00:00:00Z'].map(gs.isRealDate)).toEqual(Array(8).fill(false));
  });

  it('safeEqual : égalité stricte de chaînes, quelle que soit la longueur', () => {
    expect(gs.safeEqual('abc', 'abc')).toBe(true);
    for (const [a, b] of [['abc', 'abd'], ['abc', 'ab'], ['ab', 'abc'], ['', 'a'], ['abc', 'abc\u0000'], ['abc', undefined], [null, null], [1, 1]]) expect(gs.safeEqual(a, b)).toBe(false);
    expect(gs.safeEqual('', '')).toBe(true);
  });

  it('tokenMatches : refuse tout si le jeton attendu est absent ou trop court', () => {
    expect(gs.tokenMatches(TOKEN, TOKEN)).toBe(true);
    expect(gs.tokenMatches(TOKEN, `${TOKEN}x`)).toBe(false);
    expect(gs.tokenMatches(TOKEN, undefined)).toBe(false);
    expect(gs.tokenMatches(null, null)).toBe(false);
    expect(gs.tokenMatches('', '')).toBe(false);
    expect(gs.tokenMatches('court', 'court')).toBe(false);
  });

  it('validatePayload : accepte le PDF et les trois MP3 du jour', () => {
    const files = [PDF, MP3, { ...MP3, name: 'Daily Brief 2026-11-06 EN.mp3' }, { ...MP3, name: 'Daily Brief 2026-11-06 ES.mp3' }];
    expect(gs.validatePayload({ date: '2026-11-06', files })).toEqual({ ok: true, date: '2026-11-06', files });
  });

  it.each([
    ['bad-request', null],
    ['bad-request', []],
    ['bad-date', { date: '2026-02-30', files: [PDF] }],
    ['bad-files', { date: '2026-11-06' }],
    ['bad-files', { date: '2026-11-06', files: [] }],
    ['bad-files', { date: '2026-11-06', files: [PDF, PDF, PDF, PDF, PDF] }],
    ['bad-file', { date: '2026-11-06', files: [{ name: PDF.name, mimeType: PDF.mimeType }] }],
    ['bad-file', { date: '2026-11-06', files: ['x'] }],
    ['bad-name', { date: '2026-11-06', files: [{ ...PDF, name: 'Daily Brief 2026-11-05.pdf' }] }],
    ['bad-name', { date: '2026-11-06', files: [{ ...PDF, name: '../Daily Brief 2026-11-06.pdf' }] }],
    ['bad-name', { date: '2026-11-06', files: [{ ...PDF, name: 'Daily Brief 2026-11-06.pdf.exe' }] }],
    ['bad-name', { date: '2026-11-06', files: [{ ...MP3, name: 'Daily Brief 2026-11-06 DE.mp3' }] }],
    ['bad-type', { date: '2026-11-06', files: [{ ...PDF, mimeType: 'text/html' }] }],
    ['bad-type', { date: '2026-11-06', files: [{ ...MP3, mimeType: 'application/pdf' }] }],
    ['bad-content', { date: '2026-11-06', files: [{ ...PDF, base64: '' }] }],
    ['bad-content', { date: '2026-11-06', files: [{ ...PDF, base64: '<script>' }] }],
    ['bad-content', { date: '2026-11-06', files: [{ ...PDF, base64: 'AAA' }] }],
    ['duplicate-name', { date: '2026-11-06', files: [PDF, PDF] }],
  ])('validatePayload : %s', (error, payload) => {
    expect(gs.validatePayload(payload)).toEqual({ ok: false, error });
  });
});

describe('Code.gs : doPost', () => {
  it('crée Daily Brief/AAAA/MM - Mois, dépose le fichier et renvoie son id', () => {
    const g = loadCodeGs({ TOKEN });
    const out = g.gs.doPost({ postData: { contents: JSON.stringify(body({ files: [PDF, MP3] })) } });
    expect(out.mime).toBe('application/json');
    const res = JSON.parse(out.text);
    expect(res).toEqual({ ok: true, ids: { [PDF.name]: 'file-4', [MP3.name]: 'file-5' } });
    expect(g.tree()).toEqual(['Daily Brief/2026/11 - Novembre/Daily Brief 2026-11-06.pdf', 'Daily Brief/2026/11 - Novembre/Daily Brief 2026-11-06 FR.mp3']);
    const file = g.root.folders[0].folders[0].folders[0].files[0];
    expect([file.mimeType, file.bytes.toString()]).toEqual(['application/pdf', '%PDF-1.7 test']);
    expect(g.state.locked).toBe(false);
  });

  it('mémorise le dossier racine et ne recrée aucun dossier au second dépôt', () => {
    const g = loadCodeGs({ TOKEN });
    g.post(body());
    expect(g.properties.ROOT_FOLDER_ID).toBe('folder-1');
    g.state.creations.length = 0;
    expect(g.post(body({ date: '2026-11-07', files: [{ ...PDF, name: 'Daily Brief 2026-11-07.pdf' }] })).ok).toBe(true);
    expect(g.state.creations).toEqual(['fichier Daily Brief 2026-11-07.pdf']);
    g.post(body({ date: '2026-12-01', files: [{ ...PDF, name: 'Daily Brief 2026-12-01.pdf' }] }));
    g.post(body({ date: '2027-01-01', files: [{ ...PDF, name: 'Daily Brief 2027-01-01.pdf' }] }));
    expect(g.tree()).toEqual([
      'Daily Brief/2026/11 - Novembre/Daily Brief 2026-11-06.pdf',
      'Daily Brief/2026/11 - Novembre/Daily Brief 2026-11-07.pdf',
      'Daily Brief/2026/12 - Décembre/Daily Brief 2026-12-01.pdf',
      'Daily Brief/2027/01 - Janvier/Daily Brief 2027-01-01.pdf',
    ]);
  });

  it('remplace un fichier de même nom : l’ancien va à la corbeille', () => {
    const g = loadCodeGs({ TOKEN });
    const first = g.post(body());
    const second = g.post(body({ files: [{ ...PDF, base64: Buffer.from('%PDF-1.7 v2').toString('base64') }] }));
    expect(second.ids[PDF.name]).not.toBe(first.ids[PDF.name]);
    expect(g.tree()).toEqual(['Daily Brief/2026/11 - Novembre/Daily Brief 2026-11-06.pdf (corbeille)', 'Daily Brief/2026/11 - Novembre/Daily Brief 2026-11-06.pdf']);
    const files = g.root.folders[0].folders[0].folders[0].files;
    expect(files.filter((f) => !f.trashed).map((f) => f.bytes.toString())).toEqual(['%PDF-1.7 v2']);
  });

  it('un base64 indécodable : bad-content avant toute mise à la corbeille', () => {
    const g = loadCodeGs({ TOKEN });
    g.post(body());
    g.state.creations.length = 0;
    expect(g.post(body({ files: [PDF, { ...MP3, base64: 'AB==' }] }))).toEqual({ ok: false, error: 'bad-content' });
    expect(g.tree()).toEqual(['Daily Brief/2026/11 - Novembre/Daily Brief 2026-11-06.pdf']);
    expect(g.state.creations).toEqual([]);
  });

  it('crée le nouveau fichier avant de mettre l’ancien à la corbeille : une création en échec laisse l’ancien', () => {
    const g = loadCodeGs({ TOKEN });
    g.post(body());
    g.state.failCreateFile = true;
    expect(g.post(body())).toEqual({ ok: false, error: 'drive-error' });
    expect(g.tree()).toEqual(['Daily Brief/2026/11 - Novembre/Daily Brief 2026-11-06.pdf']);
  });

  it('quota Drive dépassé : drive-quota, sans détail', () => {
    const g = loadCodeGs({ TOKEN });
    g.state.failCreateFile = true;
    g.state.failMessage = 'Service invoked too many times for one day: driveWriteOps. jeton interne';
    expect(g.gs.doPost({ postData: { contents: JSON.stringify(body()) } }).text).toBe('{"ok":false,"error":"drive-quota"}');
    g.state.failMessage = 'Limit Exceeded: DriveApp';
    expect(g.post(body())).toEqual({ ok: false, error: 'drive-quota' });
    expect(g.state.locked).toBe(false);
  });

  it('dossier racine mémorisé mis à la corbeille ou supprimé : retrouvé par son nom, sinon recréé', () => {
    const g = loadCodeGs({ TOKEN });
    g.post(body());
    g.root.folders[0].trashed = true;
    expect(g.post(body()).ok).toBe(true);
    expect(g.properties.ROOT_FOLDER_ID).toBe('folder-5');
    expect(g.tree()).toEqual(['Daily Brief/ (corbeille)', 'Daily Brief/2026/11 - Novembre/Daily Brief 2026-11-06.pdf']);
    // Id inconnu de Drive : le dossier existant de même nom est repris, pas dupliqué.
    g.properties.ROOT_FOLDER_ID = 'id-périmé';
    expect(g.post(body()).ok).toBe(true);
    expect(g.properties.ROOT_FOLDER_ID).toBe('folder-5');
    expect(g.root.folders.filter((f) => !f.trashed)).toHaveLength(1);
  });

  it('jeton faux, absent, ou propriété TOKEN non définie : unauthorized, rien n’est créé', () => {
    const g = loadCodeGs({ TOKEN });
    expect(g.post(body({ token: 'mauvais' }))).toEqual({ ok: false, error: 'unauthorized' });
    expect(g.post({ date: '2026-11-06', files: [PDF] })).toEqual({ ok: false, error: 'unauthorized' });
    expect(g.post('pas du json')).toEqual({ ok: false, error: 'unauthorized' });
    expect(g.gs.doPost({}).text).toBe('{"ok":false,"error":"unauthorized"}');
    expect(g.gs.doPost(undefined).text).toBe('{"ok":false,"error":"unauthorized"}');
    const unset = loadCodeGs({});
    expect(unset.post(body())).toEqual({ ok: false, error: 'unauthorized' });
    expect(unset.post(body({ token: undefined }))).toEqual({ ok: false, error: 'unauthorized' });
    expect(loadCodeGs({ TOKEN: 'court' }).post(body({ token: 'court' }))).toEqual({ ok: false, error: 'unauthorized' });
    expect([...g.tree(), ...unset.tree()]).toEqual([]);
  });

  it('le jeton est contrôlé avant la validation : une requête invalide sans jeton n’apprend rien', () => {
    const g = loadCodeGs({ TOKEN });
    expect(g.post({ token: 'mauvais', date: 'x' })).toEqual({ ok: false, error: 'unauthorized' });
    expect(g.post(body({ date: 'x' }))).toEqual({ ok: false, error: 'bad-date' });
    expect(g.post(body({ files: [{ ...PDF, name: 'virus.exe' }] }))).toEqual({ ok: false, error: 'bad-name' });
    expect(g.tree()).toEqual([]);
  });

  it('verrou indisponible : busy ; erreur Drive : drive-error sans détail, verrou relâché', () => {
    const g = loadCodeGs({ TOKEN });
    g.state.lockAvailable = false;
    expect(g.post(body())).toEqual({ ok: false, error: 'busy' });
    g.state.lockAvailable = true;
    g.state.failCreateFile = true;
    const out = g.gs.doPost({ postData: { contents: JSON.stringify(body()) } }).text;
    expect(out).toBe('{"ok":false,"error":"drive-error"}');
    expect(g.state.locked).toBe(false);
  });

  it('la réponse ne contient jamais le jeton', () => {
    const g = loadCodeGs({ TOKEN });
    for (const b of [body(), body({ token: 'x' }), body({ date: 'x' })]) expect(JSON.stringify(g.post(b))).not.toContain(TOKEN);
  });
});
