import { existsSync, mkdtempSync, readdirSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { pickSampleVoices, runVoiceSamples, SAMPLE_TEXTS } from '../../audio/samples';
import { chirp3HdVoices, type VoiceInfo } from '../../audio/tts';
import { loadVoices } from '../../audio/voices';
import { looksLikeMp3 } from '../../publish/files';
import { fakeTts, okSynth, voicesOf } from './fake-tts';

const KEY = 'AIzaSy-cle-de-test-0123456789';
const names = (code: string) => chirp3HdVoices((voicesOf(code).json as { voices: VoiceInfo[] }).voices, code);

describe('pickSampleVoices', () => {
  it('la voix configurée d’abord, puis les autres, en alternant en-US et en-GB', () => {
    expect(pickSampleVoices({ 'en-US': names('en-US'), 'en-GB': names('en-GB') }, 'en-US-Chirp3-HD-Charon', 3)).toEqual(['en-US-Chirp3-HD-Charon', 'en-US-Chirp3-HD-Aoede', 'en-GB-Chirp3-HD-Aoede']);
  });

  it('voix configurée absente : seulement les voix trouvées ; jamais plus que demandé ni de doublon', () => {
    expect(pickSampleVoices({ 'fr-FR': names('fr-FR') }, 'fr-FR-Chirp3-HD-Inconnue', 2)).toEqual(['fr-FR-Chirp3-HD-Aoede', 'fr-FR-Chirp3-HD-Charon']);
    expect(pickSampleVoices({ 'fr-FR': names('fr-FR') }, 'fr-FR-Chirp3-HD-Kore', 10)).toEqual(['fr-FR-Chirp3-HD-Kore', 'fr-FR-Chirp3-HD-Aoede', 'fr-FR-Chirp3-HD-Charon', 'fr-FR-Chirp3-HD-Puck']);
    expect(pickSampleVoices({}, 'fr-FR-Chirp3-HD-Kore', 3)).toEqual([]);
  });
});

describe('runVoiceSamples', () => {
  it('liste les voix Chirp 3 HD, écrit 3 échantillons par langue et index.json ; code 0', async () => {
    const outDir = mkdtempSync(join(tmpdir(), 'samples-'));
    mkdirSync(join(outDir, 'voice-samples'));
    writeFileSync(join(outDir, 'voice-samples', 'ancien.mp3'), 'x');
    const net = fakeTts();
    const r = await runVoiceSamples({ apiKey: KEY, fetch: net.fetch, outDir, voices: loadVoices() });
    expect(r.exitCode).toBe(0);
    expect(net.calls.filter((c) => c.url.includes('/voices?')).map((c) => new URL(c.url).searchParams.get('languageCode'))).toEqual(['fr-FR', 'en-US', 'en-GB', 'es-ES']);
    expect(r.index.voices.fr).toEqual(['fr-FR-Chirp3-HD-Aoede', 'fr-FR-Chirp3-HD-Charon', 'fr-FR-Chirp3-HD-Kore', 'fr-FR-Chirp3-HD-Puck']);
    expect(r.index.voices.en).toHaveLength(8);
    expect(r.index.samples.map((s) => s.voice)).toEqual([
      'fr-FR-Chirp3-HD-Aoede', 'fr-FR-Chirp3-HD-Charon', 'fr-FR-Chirp3-HD-Kore',
      'en-US-Chirp3-HD-Charon', 'en-US-Chirp3-HD-Aoede', 'en-GB-Chirp3-HD-Aoede',
      'es-ES-Chirp3-HD-Kore', 'es-ES-Chirp3-HD-Aoede', 'es-ES-Chirp3-HD-Charon',
    ]);
    expect(net.requests[5].voice).toEqual({ languageCode: 'en-GB', name: 'en-GB-Chirp3-HD-Aoede' });
    expect(net.requests.map((q) => q.text)).toEqual([...Array(3).fill(SAMPLE_TEXTS.fr), ...Array(3).fill(SAMPLE_TEXTS.en), ...Array(3).fill(SAMPLE_TEXTS.es)]);
    expect(readdirSync(r.dir).sort()).toEqual([...r.index.samples.map((s) => s.file!), 'index.json'].sort());
    expect(looksLikeMp3(readFileSync(join(r.dir, 'fr-FR-Chirp3-HD-Aoede.mp3')))).toBe(true);
    expect(JSON.parse(readFileSync(join(r.dir, 'index.json'), 'utf8')).characters).toBe(r.index.characters);
    expect(net.calls.every((c) => c.headers?.['x-goog-api-key'] === KEY && !c.url.includes(KEY))).toBe(true);
  });

  it('un échantillon en échec : code 1, erreur notée sans la clé ; voix configurée absente signalée', async () => {
    const outDir = mkdtempSync(join(tmpdir(), 'samples-'));
    const net = fakeTts((q) => (q.voice.name.endsWith('Charon') && q.voice.languageCode === 'fr-FR' ? { error: new Error(`reset ${KEY}`) } : okSynth()));
    const voices = { ...loadVoices(), es: { languageCode: 'es-ES', name: 'es-ES-Chirp3-HD-Inconnue' } };
    const r = await runVoiceSamples({ apiKey: KEY, fetch: net.fetch, outDir, voices, count: 2 });
    expect(r.exitCode).toBe(1);
    expect(r.index.samples.find((s) => s.voice === 'fr-FR-Chirp3-HD-Charon')).toEqual({ lang: 'fr', voice: 'fr-FR-Chirp3-HD-Charon', file: null, error: 'reset ***' });
    expect(r.index.issues).toEqual(['es : la voix configurée es-ES-Chirp3-HD-Inconnue est absente de voices.list']);
    expect(readFileSync(join(r.dir, 'index.json'), 'utf8')).not.toContain(KEY);
  });

  it('--count au-delà du maximum : ramené à 10 avec un avertissement', async () => {
    const outDir = mkdtempSync(join(tmpdir(), 'samples-'));
    const r = await runVoiceSamples({ apiKey: KEY, fetch: fakeTts().fetch, outDir, voices: loadVoices(), count: 50 });
    expect(r.index.issues).toContain('--count 50 ramené à 10 (maximum)');
    expect(r.index.samples.filter((s) => s.lang === 'en')).toHaveLength(8);
  });

  it('clé refusée : les échantillons d’un passage précédent restent intacts', async () => {
    const outDir = mkdtempSync(join(tmpdir(), 'samples-'));
    await runVoiceSamples({ apiKey: KEY, fetch: fakeTts().fetch, outDir, voices: loadVoices(), count: 1 });
    const dir = join(outDir, 'voice-samples');
    const before = readdirSync(dir).sort();
    const indexBefore = readFileSync(join(dir, 'index.json'), 'utf8');
    expect(before).toHaveLength(4);
    const r = await runVoiceSamples({ apiKey: KEY, fetch: fakeTts(undefined, () => ({ status: 403, json: {} })).fetch, outDir, voices: loadVoices() });
    expect(r.exitCode).toBe(2);
    expect(readdirSync(dir).sort()).toEqual(before);
    expect(readFileSync(join(dir, 'index.json'), 'utf8')).toBe(indexBefore);
    expect(readdirSync(outDir)).toEqual(['voice-samples']);
  });

  it('un passage réussi remplace entièrement le dossier précédent', async () => {
    const outDir = mkdtempSync(join(tmpdir(), 'samples-'));
    mkdirSync(join(outDir, 'voice-samples'));
    writeFileSync(join(outDir, 'voice-samples', 'ancien.mp3'), 'x');
    await runVoiceSamples({ apiKey: KEY, fetch: fakeTts().fetch, outDir, voices: loadVoices(), count: 1 });
    expect(readdirSync(join(outDir, 'voice-samples'))).not.toContain('ancien.mp3');
    expect(readdirSync(outDir)).toEqual(['voice-samples']);
  });

  it('clé refusée : le service est coupé dès la première liste, aucun échantillon, code 2', async () => {
    const outDir = mkdtempSync(join(tmpdir(), 'samples-'));
    const net = fakeTts(undefined, () => ({ status: 403, json: {} }));
    const r = await runVoiceSamples({ apiKey: KEY, fetch: net.fetch, outDir, voices: loadVoices() });
    expect(r.exitCode).toBe(2);
    expect(net.calls).toHaveLength(1);
    expect(r.index.issues).toEqual(['voices.list fr-FR : HTTP 403 (https://texttospeech.googleapis.com/v1/voices?languageCode=fr-FR)']);
    expect(existsSync(join(r.dir, 'index.json'))).toBe(true);
  });
});
