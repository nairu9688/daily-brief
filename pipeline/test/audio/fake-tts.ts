import type { HttpInit } from '../../collect/http';
import { TTS_BASE } from '../../audio/tts';
import { fakeHttp, type Reply } from '../collect/fake-http';
import { apiLikeMp3 } from './mp3';

/** Trames audio renvoyées par morceau : 125 trames de 576 échantillons à 24 kHz = 3 s. */
export const FRAMES_PER_CHUNK = 125;
export const SECONDS_PER_CHUNK = 3;

export type SynthRequest = { text: string; voice: { languageCode: string; name: string }; audioConfig: Record<string, unknown> };

/**
 * Réponse de synthèse réussie : un MP3 « comme celui de l'API » (ID3, Xing, trames). Avec `fill = 0`,
 * les trames sont du silence décodable par ffmpeg ; sinon leur contenu suit l'ordre mais ne se décode pas.
 */
export const okSynth = (fill = 1): Reply => ({ json: { audioContent: apiLikeMp3(FRAMES_PER_CHUNK, fill).toString('base64') } });

/** Liste de voix d'une langue, à la forme de voices.list : quatre Chirp 3 HD, une Neural2. */
export const voicesOf = (code: string): Reply => ({
  json: { voices: ['Aoede', 'Charon', 'Kore', 'Puck'].map((n) => ({ languageCodes: [code], name: `${code}-Chirp3-HD-${n}`, ssmlGender: 'FEMALE', naturalSampleRateHertz: 24000 })).concat([{ languageCodes: [code], name: `${code}-Neural2-A`, ssmlGender: 'FEMALE', naturalSampleRateHertz: 24000 }]) },
});

/**
 * Faux Text-to-Speech : `reply` choisit la réponse de chaque synthèse (par défaut, un MP3 de 3 s),
 * `voices` celle de chaque liste de voix. `requests` garde le corps de chaque synthèse.
 */
export function fakeTts(reply: (req: SynthRequest, n: number) => Reply = () => okSynth(), voices: (code: string) => Reply = voicesOf) {
  const requests: SynthRequest[] = [];
  const net = fakeHttp({
    [`${TTS_BASE}/text:synthesize`]: (_url: string, init?: HttpInit) => {
      const body = JSON.parse(init!.body!);
      const req = { text: body.input.text, voice: body.voice, audioConfig: body.audioConfig };
      requests.push(req);
      return reply(req, requests.length);
    },
    [`${TTS_BASE}/voices`]: (url: string) => voices(new URL(url).searchParams.get('languageCode') ?? ''),
  });
  return { ...net, requests };
}
