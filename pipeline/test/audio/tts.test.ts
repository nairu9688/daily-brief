import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { BodyError, HttpError } from '../../collect/http';
import { chirp3HdVoices, listVoices, MAX_SYNTH_RESPONSE_BYTES, synthesize, TTS_BASE, TtsAudioError } from '../../audio/tts';
import { parseMp3 } from '../../audio/mp3';
import { fakeHttp } from '../collect/fake-http';
import { repoPath } from '../helpers';

const KEY = 'AIzaSy-cle-de-test-0123456789';
const VOICE = { languageCode: 'fr-FR', name: 'fr-FR-Chirp3-HD-Aoede' };
const SYNTH = JSON.parse(readFileSync(repoPath('fixtures/api/tts-synthesize.json'), 'utf8'));
const VOICES = JSON.parse(readFileSync(repoPath('fixtures/api/tts-voices.json'), 'utf8'));

describe('synthesize', () => {
  it('POST text:synthesize : texte, voix, MP3 ; la clé passe dans x-goog-api-key, jamais dans l’URL', async () => {
    const net = fakeHttp({ [`${TTS_BASE}/text:synthesize`]: { json: SYNTH } });
    const mp3 = await synthesize('Bonjour.', VOICE, { speakingRate: 1.05 }, { apiKey: KEY, fetch: net.fetch });
    expect(parseMp3(mp3).frames).toHaveLength(3);
    const [call] = net.calls;
    expect(call.url).toBe('https://texttospeech.googleapis.com/v1/text:synthesize');
    expect(call.method).toBe('POST');
    expect(call.headers?.['x-goog-api-key']).toBe(KEY);
    expect(call.url).not.toContain(KEY);
    expect(JSON.parse(call.body!)).toEqual({ input: { text: 'Bonjour.' }, voice: VOICE, audioConfig: { audioEncoding: 'MP3', speakingRate: 1.05 } });
  });

  it('sans speakingRate, audioConfig ne porte que l’encodage', async () => {
    const net = fakeHttp({ [TTS_BASE]: { json: SYNTH } });
    await synthesize('Bonjour.', VOICE, {}, { apiKey: KEY, fetch: net.fetch });
    expect(JSON.parse(net.calls[0].body!).audioConfig).toEqual({ audioEncoding: 'MP3' });
  });

  it('refuse un morceau au-dessus de la limite de l’API sans appeler le service', async () => {
    const net = fakeHttp({});
    await expect(synthesize('é'.repeat(2501), VOICE, {}, { apiKey: KEY, fetch: net.fetch })).rejects.toThrow(/5002 octets/);
    expect(net.calls).toHaveLength(0);
  });

  it('erreur HTTP : HttpError avec le statut, sans la clé ni le corps', async () => {
    const net = fakeHttp({ [TTS_BASE]: { status: 403, json: { error: { code: 403, message: `API key ${KEY} not valid`, status: 'PERMISSION_DENIED' } } } });
    const e = await synthesize('Bonjour.', VOICE, {}, { apiKey: KEY, fetch: net.fetch }).catch((x) => x);
    expect(e).toBeInstanceOf(HttpError);
    expect((e as HttpError).status).toBe(403);
    expect(String(e.message)).not.toContain(KEY);
  });

  it('réponse invalide : sans audioContent, base64 incorrect, audio qui n’est pas un MP3', async () => {
    const call = (json: unknown) => synthesize('Bonjour.', VOICE, {}, { apiKey: KEY, fetch: fakeHttp({ [TTS_BASE]: { json } }).fetch });
    await expect(call({})).rejects.toBeInstanceOf(z.ZodError);
    await expect(call({ audioContent: '***' })).rejects.toBeInstanceOf(z.ZodError);
    await expect(call({ audioContent: Buffer.from('<html>non</html>').toString('base64') })).rejects.toBeInstanceOf(TtsAudioError);
  });

  it('réponse trop lourde : BodyError avant lecture complète', async () => {
    const net = fakeHttp({ [TTS_BASE]: { json: SYNTH, headers: { 'content-length': String(MAX_SYNTH_RESPONSE_BYTES + 1) } } });
    await expect(synthesize('Bonjour.', VOICE, {}, { apiKey: KEY, fetch: net.fetch })).rejects.toBeInstanceOf(BodyError);
  });

  it('délai dépassé : l’appel est interrompu (TimeoutError)', async () => {
    const net = fakeHttp({ [TTS_BASE]: { hang: true } });
    const e = await synthesize('Bonjour.', VOICE, {}, { apiKey: KEY, fetch: net.fetch, timeoutMs: 20 }).catch((x) => x);
    expect((e as Error).name).toBe('TimeoutError');
  });

  it('le signal de l’appelant interrompt l’appel', async () => {
    const net = fakeHttp({ [TTS_BASE]: { hang: true } });
    const ctrl = new AbortController();
    const p = synthesize('Bonjour.', VOICE, {}, { apiKey: KEY, fetch: net.fetch, signal: ctrl.signal });
    ctrl.abort(new Error('échéance globale'));
    await expect(p).rejects.toThrow('échéance globale');
  });
});

describe('listVoices et chirp3HdVoices', () => {
  it('GET voices?languageCode= ; clé en en-tête ; seules les voix Chirp3-HD de la langue, triées', async () => {
    const net = fakeHttp({ [`${TTS_BASE}/voices`]: { json: VOICES } });
    const voices = await listVoices('fr-FR', { apiKey: KEY, fetch: net.fetch });
    expect(net.calls[0].url).toBe('https://texttospeech.googleapis.com/v1/voices?languageCode=fr-FR');
    expect(net.calls[0].headers?.['x-goog-api-key']).toBe(KEY);
    expect(voices).toHaveLength(8);
    expect(chirp3HdVoices(voices, 'fr-FR').map((v) => v.name)).toEqual(['fr-FR-Chirp3-HD-Aoede', 'fr-FR-Chirp3-HD-Charon', 'fr-FR-Chirp3-HD-Kore', 'fr-FR-Chirp3-HD-Puck']);
  });

  it('une réponse sans voix donne une liste vide ; une réponse mal formée est refusée', async () => {
    expect(await listVoices('xx-XX', { apiKey: KEY, fetch: fakeHttp({ [TTS_BASE]: { json: {} } }).fetch })).toEqual([]);
    await expect(listVoices('fr-FR', { apiKey: KEY, fetch: fakeHttp({ [TTS_BASE]: { json: { voices: [{ name: 3 }] } } }).fetch })).rejects.toBeInstanceOf(z.ZodError);
  });
});
