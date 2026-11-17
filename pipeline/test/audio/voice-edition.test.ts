import { describe, expect, it } from 'vitest';
import { Breaker } from '../../collect/breaker';
import { CharBudget, MAX_CHARS_PER_EDITION, MAX_CHARS_PER_RUN } from '../../audio/budget';
import { looksLikeMp3 } from '../../publish/files';
import { voiceEdition, VoiceEditionError, type VoiceEditionDeps } from '../../audio/voice-edition';
import { fakeTts, okSynth, SECONDS_PER_CHUNK } from './fake-tts';

const KEY = 'AIzaSy-cle-de-test-0123456789';
const VOICE = { languageCode: 'fr-FR', name: 'fr-FR-Chirp3-HD-Aoede', speakingRate: 1.05 };
/** Trois phrases de 30 octets : avec des morceaux de 70 octets, deux morceaux. */
const SCRIPT = 'Première phrase du brief ici. Deuxième phrase du brief ici. Troisième phrase, la fin.';

function deps(net: ReturnType<typeof fakeTts>, over: Partial<VoiceEditionDeps> = {}): VoiceEditionDeps {
  return { client: { apiKey: KEY, fetch: net.fetch }, breaker: new Breaker(), budget: new CharBudget(), ffmpeg: null, maxChunkBytes: 70, ...over };
}

const failure = (p: Promise<unknown>) => p.then(() => { throw new Error('succès inattendu'); }, (e: unknown) => e as VoiceEditionError);

describe('CharBudget', () => {
  it('plafonds : 5 000 caractères par édition, 15 000 par passage', () => {
    expect([MAX_CHARS_PER_EDITION, MAX_CHARS_PER_RUN]).toEqual([5000, 15000]);
    const b = new CharBudget();
    expect(b.refuseEdition(5001)).toBe('audioScript de 5001 caractères, au-delà du plafond de 5000 par édition');
    expect(b.refuseEdition(5000)).toBeNull();
    expect(b.take(14_000)).toBe(true);
    expect(b.refuseEdition(1001)).toBe('plafond du passage atteint (14000 caractères envoyés, 15000 au plus)');
    expect(b.take(1001)).toBe(false);
    expect(b.take(1000)).toBe(true);
    expect(b.sent).toBe(15_000);
  });
});

describe('voiceEdition', () => {
  it('découpe, synthétise chaque morceau dans l’ordre avec la voix, puis concatène', async () => {
    const net = fakeTts((_, n) => okSynth(n * 10));
    const r = await voiceEdition(SCRIPT, VOICE, deps(net));
    expect(net.requests.map((q) => q.text)).toEqual(['Première phrase du brief ici. Deuxième phrase du brief ici.', 'Troisième phrase, la fin.']);
    expect(net.requests[0].voice).toEqual({ languageCode: 'fr-FR', name: 'fr-FR-Chirp3-HD-Aoede' });
    expect(net.requests[0].audioConfig).toEqual({ audioEncoding: 'MP3', speakingRate: 1.05 });
    expect([r.chunks, r.seconds, r.method, r.characters]).toEqual([2, 2 * SECONDS_PER_CHUNK, 'frames', [...SCRIPT].length - 1]);
    expect(looksLikeMp3(r.bytes)).toBe(true);
    expect([r.bytes[50], r.bytes[r.bytes.length - 50]]).toEqual([10, 20 + 124]);
  });

  it('une erreur 500 passagère : seconde tentative réussie, caractères comptés deux fois', async () => {
    const net = fakeTts((_, n) => (n === 1 ? { status: 500, json: {} } : okSynth()));
    const budget = new CharBudget();
    const r = await voiceEdition('Une seule phrase.', VOICE, deps(net, { budget }));
    expect(net.requests).toHaveLength(2);
    expect(r.characters).toBe(34);
    expect(budget.sent).toBe(34);
  });

  it('deux erreurs 503 sur le même morceau : échec de l’édition, sans coupure du service', async () => {
    const net = fakeTts(() => ({ status: 503, json: {} }));
    const breaker = new Breaker();
    const e = await failure(voiceEdition('Une seule phrase.', VOICE, deps(net, { breaker })));
    expect(e).toBeInstanceOf(VoiceEditionError);
    expect(e.message).toBe('morceau 1/1 : HTTP 503 (https://texttospeech.googleapis.com/v1/text:synthesize)');
    expect(e.characters).toBe(34);
    expect(breaker.open).toBe(false);
  });

  it('403 : coupure immédiate du service, sans seconde tentative ; l’édition suivante n’appelle plus rien', async () => {
    const net = fakeTts(() => ({ status: 403, json: { error: { message: `clé ${KEY} refusée` } } }));
    const d = deps(net);
    const e = await failure(voiceEdition(SCRIPT, VOICE, d));
    expect(e.message).toBe('morceau 1/2 : HTTP 403 (https://texttospeech.googleapis.com/v1/text:synthesize) — Text-to-Speech coupé (HTTP 403)');
    expect(net.requests).toHaveLength(1);
    const next = await failure(voiceEdition(SCRIPT, VOICE, d));
    expect(next.message).toBe('Text-to-Speech coupé (HTTP 403)');
    expect(net.requests).toHaveLength(1);
  });

  it('429 et délai dépassé coupent aussi le service', async () => {
    for (const reply of [{ status: 429, json: {} }, { hang: true }]) {
      const net = fakeTts(() => reply);
      const d = deps(net, { client: { apiKey: KEY, fetch: net.fetch, timeoutMs: 20 } });
      const e = await failure(voiceEdition('Une phrase.', VOICE, d));
      expect(e.message).toMatch(/Text-to-Speech coupé \((HTTP 429|délai dépassé)\)$/);
    }
  });

  it('réponse invalide (pas un MP3) : échec sans seconde tentative', async () => {
    const net = fakeTts(() => ({ json: { audioContent: Buffer.from('<html>').toString('base64') } }));
    const e = await failure(voiceEdition('Une phrase.', VOICE, deps(net)));
    expect(e.message).toBe('morceau 1/1 : réponse audio qui n’est pas un MP3');
    expect(net.requests).toHaveLength(1);
  });

  it('script trop long pour le plafond par édition, ou budget du passage épuisé : aucun appel', async () => {
    const net = fakeTts();
    const long = await failure(voiceEdition('mot '.repeat(1300), VOICE, deps(net, { maxChunkBytes: 4500 })));
    expect(long.message).toBe('audioScript de 5199 caractères, au-delà du plafond de 5000 par édition');
    const budget = new CharBudget(5000, 50);
    const over = await failure(voiceEdition(SCRIPT, VOICE, deps(net, { budget })));
    expect(over.message).toMatch(/^plafond du passage atteint \(0 caractères envoyés, 50 au plus\)$/);
    expect(net.requests).toHaveLength(0);
  });

  it('script vide ou mot impossible à découper : échec lisible', async () => {
    const net = fakeTts();
    expect((await failure(voiceEdition('  ', VOICE, deps(net)))).message).toBe('audioScript vide');
    expect((await failure(voiceEdition('x'.repeat(80), VOICE, deps(net)))).message).toMatch(/^découpage impossible : mot de 80 octets/);
  });

  it('échéance du passage : l’appel en cours est interrompu et l’édition échoue', async () => {
    const net = fakeTts(() => ({ hang: true }));
    const ctrl = new AbortController();
    const p = failure(voiceEdition('Une phrase.', VOICE, deps(net, { client: { apiKey: KEY, fetch: net.fetch, signal: ctrl.signal } })));
    ctrl.abort(new Error('échéance'));
    expect((await p).message).toBe('morceau 1/1 : échéance du passage dépassée');
  });

  it('trois échecs non fatals consécutifs coupent le service', async () => {
    const net = fakeTts(() => ({ status: 400, json: {} }));
    const d = deps(net);
    for (let i = 0; i < 2; i++) expect((await failure(voiceEdition('Une phrase.', VOICE, d))).message).toMatch(/HTTP 400 \(/);
    expect((await failure(voiceEdition('Une phrase.', VOICE, d))).message).toMatch(/coupé \(source coupée après 3 échecs consécutifs\)$/);
  });
});
