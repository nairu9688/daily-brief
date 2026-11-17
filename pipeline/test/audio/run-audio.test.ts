import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import type { Lang } from '@daily-brief/schema';
import { CharBudget } from '../../audio/budget';
import { findFfmpeg } from '../../audio/concat';
import { runAudio, type RunAudioOptions } from '../../audio/run-audio';
import { loadPublishInputs } from '../../publish/inputs';
import { fixtureEdition } from '../helpers';
import { fakeTts, okSynth } from './fake-tts';

const DAY = '2026-11-06';
const FFMPEG = findFfmpeg();
const KEY = 'AIzaSy-cle-de-test-0123456789';

/** Dossier du jour avec les éditions vérifiées demandées (copies de la fixture). */
function makeDay(langs: Lang[] = ['fr', 'en', 'es']) {
  const outDir = mkdtempSync(join(tmpdir(), 'audio-'));
  const dayDir = join(outDir, DAY);
  mkdirSync(dayDir, { recursive: true });
  for (const lang of langs) writeFileSync(join(dayDir, `${lang}.verified.json`), JSON.stringify(fixtureEdition(lang)));
  return { outDir, dayDir };
}

const run = (outDir: string, net: ReturnType<typeof fakeTts>, over: Partial<RunAudioOptions> = {}) => runAudio({ outDir, date: DAY, apiKey: KEY, fetch: net.fetch, ffmpeg: null, ...over });
const readJson = (path: string) => JSON.parse(readFileSync(path, 'utf8'));

/** Forme lue par brief:render (pipeline/render/run-render.ts). */
const RenderAudioSchema = z.object({ fr: z.object({ duration: z.string().min(1) }), en: z.object({ duration: z.string().min(1) }), es: z.object({ duration: z.string().min(1) }) }).partial();

describe('runAudio', () => {
  it('trois éditions : trois MP3 aux noms du lot 4, audio.json lisible par brief:render, rapport ok, code 0', async () => {
    const { outDir, dayDir } = makeDay();
    const net = fakeTts();
    const r = await run(outDir, net);
    expect([r.exitCode, r.report.status, r.reportWritten]).toEqual([0, 'ok', true]);
    for (const L of ['FR', 'EN', 'ES']) expect(existsSync(join(dayDir, `Daily Brief ${DAY} ${L}.mp3`))).toBe(true);
    const audio = readJson(join(dayDir, 'audio.json'));
    expect(audio).toEqual({ fr: { duration: '0:03' }, en: { duration: '0:03' }, es: { duration: '0:03' } });
    expect(RenderAudioSchema.parse(audio)).toEqual(audio);
    expect(net.requests.map((q) => q.voice.languageCode)).toEqual(['fr-FR', 'en-US', 'es-ES']);
    expect(net.requests.map((q) => q.text)).toEqual(['fr', 'en', 'es'].map((l) => fixtureEdition(l as Lang).audioScript.replace(/\s+/g, ' ').trim()));
    const report = readJson(join(dayDir, 'audio-report.json'));
    expect(report.editions.map((e: { file: string; duration: string; method: string; error: null }) => [e.file, e.duration, e.method, e.error])).toEqual([
      [`Daily Brief ${DAY} FR.mp3`, '0:03', 'frames', null],
      [`Daily Brief ${DAY} EN.mp3`, '0:03', 'frames', null],
      [`Daily Brief ${DAY} ES.mp3`, '0:03', 'frames', null],
    ]);
    expect(report.characters.sent).toBe(net.requests.reduce((s, q) => s + [...q.text].length, 0));
    expect(report.characters).toMatchObject({ maxPerEdition: 5000, maxPerRun: 15000 });
    expect(report.issues.map((i: { message: string }) => i.message)).toEqual([
      'voix par défaut non confirmées : lancer npm run audio:samples et choisir les voix (voices.json)',
      'ffmpeg absent : trames concaténées sans réencodage (débit de la source)',
    ]);
    expect(readdirSync(dayDir).filter((f) => f.endsWith('.tmp'))).toEqual([]);
  });

  it('les MP3 écrits passent le contrôle de brief:publish (lot 4)', async () => {
    const { outDir, dayDir } = makeDay();
    await run(outDir, fakeTts());
    writeFileSync(join(dayDir, 'render-report.json'), JSON.stringify({ date: DAY, generatedAt: new Date().toISOString(), pdf: null, finals: ['fr', 'en', 'es'] }));
    for (const lang of ['fr', 'en', 'es'] as const) writeFileSync(join(dayDir, `${lang}.final.json`), JSON.stringify(fixtureEdition(lang)));
    const inputs = loadPublishInputs(dayDir, DAY);
    expect(inputs.audio.map((a) => [a.lang, a.path])).toEqual([
      ['fr', `${DAY}/fr.mp3`],
      ['en', `${DAY}/en.mp3`],
      ['es', `${DAY}/es.mp3`],
    ]);
    expect(inputs.issues.filter((i) => i.message.includes('.mp3'))).toEqual([]);
  });

  it('une édition en échec est sautée et signalée ; les autres continuent : code 0, degraded', async () => {
    const { outDir, dayDir } = makeDay();
    const net = fakeTts((q) => (q.voice.languageCode === 'en-US' ? { status: 400, json: {} } : okSynth()));
    const r = await run(outDir, net);
    expect([r.exitCode, r.report.status]).toEqual([0, 'degraded']);
    expect(existsSync(join(dayDir, `Daily Brief ${DAY} EN.mp3`))).toBe(false);
    expect(Object.keys(readJson(join(dayDir, 'audio.json')))).toEqual(['fr', 'es']);
    expect(r.report.issues).toContainEqual({ level: 'error', lang: 'en', message: 'morceau 1/1 : HTTP 400 (https://texttospeech.googleapis.com/v1/text:synthesize) : édition publiée sans lecteur' });
    expect(r.report.editions.find((e) => e.lang === 'en')).toMatchObject({ file: null, duration: null, error: 'morceau 1/1 : HTTP 400 (https://texttospeech.googleapis.com/v1/text:synthesize)' });
  });

  it('clé refusée (403) : un seul appel, aucune édition, pas d’audio.json, code 1 (failed) sans bloquer', async () => {
    const { outDir, dayDir } = makeDay();
    const net = fakeTts(() => ({ status: 403, json: { error: { message: `API key ${KEY} not valid` } } }));
    const r = await run(outDir, net);
    expect([r.exitCode, r.report.status, net.requests.length]).toEqual([1, 'failed', 1]);
    expect(existsSync(join(dayDir, 'audio.json'))).toBe(false);
    expect(r.report.editions.map((e) => e.error)).toEqual([
      'morceau 1/1 : HTTP 403 (https://texttospeech.googleapis.com/v1/text:synthesize) — Text-to-Speech coupé (HTTP 403)',
      'Text-to-Speech coupé (HTTP 403)',
      'Text-to-Speech coupé (HTTP 403)',
    ]);
  });

  it('sans clé : aucun appel, audio désactivé, code 0 avec un avertissement', async () => {
    const { outDir, dayDir } = makeDay();
    const net = fakeTts();
    const r = await run(outDir, net, { apiKey: '   ' });
    expect([r.exitCode, r.report.status, net.requests.length]).toEqual([0, 'disabled', 0]);
    expect(r.report.issues).toEqual([{ level: 'warning', message: 'GOOGLE_TTS_API_KEY absente : audio désactivé, éditions publiées sans lecteur' }]);
    expect(readJson(join(dayDir, 'audio-report.json')).status).toBe('disabled');
  });

  it('supprime d’abord les anciens MP3, audio.json et rapport, même sans clé', async () => {
    const { outDir, dayDir } = makeDay();
    const stale = [`Daily Brief ${DAY} FR.mp3`, `Daily Brief ${DAY} ES.mp3.tmp`, 'audio.json', 'audio-report.json'];
    for (const f of stale) writeFileSync(join(dayDir, f), 'ancien');
    await run(outDir, fakeTts(), { apiKey: undefined });
    for (const f of stale.slice(0, 3)) expect(existsSync(join(dayDir, f))).toBe(false);
    expect(readJson(join(dayDir, 'audio-report.json')).status).toBe('disabled');
  });

  it('entrée invalide : date incorrecte (rien n’est créé), aucune édition vérifiée, voices.json invalide : code 2', async () => {
    const outDir = mkdtempSync(join(tmpdir(), 'audio-'));
    const bad = await runAudio({ outDir, date: '2026-02-30', apiKey: KEY, fetch: fakeTts().fetch, ffmpeg: null });
    expect([bad.exitCode, bad.report.status, bad.reportWritten]).toEqual([2, 'invalid', false]);
    expect(readdirSync(outDir)).toEqual([]);

    const empty = makeDay([]);
    const none = await run(empty.outDir, fakeTts());
    expect([none.exitCode, none.report.status]).toEqual([2, 'invalid']);
    expect(none.report.issues.at(-1)?.message).toBe('aucune édition vérifiée lisible : pas d’audio');

    const day = makeDay(['fr']);
    const voicesPath = join(day.outDir, 'voices.json');
    writeFileSync(voicesPath, '{}');
    const cfg = await run(day.outDir, fakeTts(), { voicesPath });
    expect([cfg.exitCode, cfg.report.status]).toEqual([2, 'invalid']);
    expect(cfg.report.issues[0].message).toMatch(/^voices\.json invalide/);
  });

  it('édition absente, illisible ou d’une autre date : signalée, les autres sont lues', async () => {
    const { outDir, dayDir } = makeDay(['fr']);
    writeFileSync(join(dayDir, 'en.verified.json'), '{ pas du json');
    writeFileSync(join(dayDir, 'es.verified.json'), JSON.stringify({ ...fixtureEdition('es'), date: '2026-11-05' }));
    const r = await run(outDir, fakeTts());
    expect([r.exitCode, r.report.status]).toEqual([0, 'ok']);
    expect(r.report.editions.map((e) => e.lang)).toEqual(['fr']);
    expect(r.report.issues.filter((i) => i.level === 'error')).toEqual([
      { level: 'error', lang: 'en', message: expect.stringMatching(/^en\.verified\.json illisible : /) },
      { level: 'error', lang: 'es', message: 'es.verified.json contient l’édition es du 2026-11-05 (attendu : es, 2026-11-06)' },
    ]);
  });

  it('plafond du passage : les éditions qui ne tiennent plus sont sautées sans appel', async () => {
    const { outDir } = makeDay();
    const net = fakeTts();
    const frChars = [...fixtureEdition('fr').audioScript.replace(/\s+/g, ' ').trim()].length;
    const r = await run(outDir, net, { budget: new CharBudget(5000, frChars + 10) });
    expect(net.requests).toHaveLength(1);
    expect([r.exitCode, r.report.status, r.report.characters.sent]).toEqual([0, 'degraded', frChars]);
    expect(r.report.editions[1].error).toBe(`plafond du passage atteint (${frChars} caractères envoyés, ${frChars + 10} au plus)`);
  });

  it('aucun secret dans le rapport, les messages ni audio.json, même si une erreur réseau cite la clé', async () => {
    const { outDir, dayDir } = makeDay();
    const net = fakeTts(() => ({ error: new Error(`connect ECONNRESET https://texttospeech.googleapis.com/v1/text:synthesize?key=${KEY} (x-goog-api-key: ${KEY})`) }));
    const r = await run(outDir, net);
    expect(r.exitCode).toBe(1);
    const everything = JSON.stringify(r.report) + readFileSync(join(dayDir, 'audio-report.json'), 'utf8');
    expect(everything).not.toContain(KEY);
    expect(everything).toContain('***');
    expect(net.calls.every((c) => !c.url.includes(KEY) && c.headers?.['x-goog-api-key'] === KEY)).toBe(true);
  });

  it('échéance globale : le passage s’arrête sans attendre, code 1', async () => {
    const { outDir } = makeDay();
    const net = fakeTts(() => ({ hang: true }));
    const r = await run(outDir, net, { deadlineMs: 30 });
    expect(r.exitCode).toBe(1);
    expect(r.report.editions[0].error).toBe('morceau 1/1 : échéance du passage dépassée');
    // Après l'échéance, plus rien n'est envoyé ni compté.
    expect(net.requests).toHaveLength(1);
    expect(r.report.editions.slice(1).map((e) => [e.error, e.characters])).toEqual([
      ['morceau 1/1 : échéance du passage dépassée', 0],
      ['morceau 1/1 : échéance du passage dépassée', 0],
    ]);
  });

  it('déterministe : deux passages identiques donnent les mêmes MP3 et le même audio.json', async () => {
    const a = makeDay();
    const b = makeDay();
    await run(a.outDir, fakeTts());
    await run(b.outDir, fakeTts());
    for (const f of [`Daily Brief ${DAY} FR.mp3`, 'audio.json']) expect(readFileSync(join(a.dayDir, f))).toEqual(readFileSync(join(b.dayDir, f)));
  });

  it.skipIf(!FFMPEG)('avec ffmpeg (ignoré s’il est absent) : trames de silence décodables réencodées, méthode ffmpeg, aucun avertissement ffmpeg', async () => {
    const { outDir } = makeDay(['fr']);
    const r = await run(outDir, fakeTts(() => okSynth(0)), { ffmpeg: FFMPEG });
    expect([r.exitCode, r.report.ffmpeg, r.report.editions[0].method]).toEqual([0, true, 'ffmpeg']);
    expect(r.report.editions[0].duration).toBe('0:03');
    expect(r.report.issues.some((i) => i.message.includes('ffmpeg'))).toBe(false);
  }, 30_000);
});
