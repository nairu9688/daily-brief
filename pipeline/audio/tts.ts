import { z } from 'zod';
import { looksLikeMp3 } from '../publish/files';
import { fetchJson, type HttpFetch } from '../collect/http';
import { TTS_MAX_REQUEST_BYTES, utf8Bytes } from './chunk';

/** API REST Google Cloud Text-to-Speech v1. */
export const TTS_BASE = 'https://texttospeech.googleapis.com/v1';
/** Délai d'une synthèse (un morceau de 4 500 octets donne environ une minute d'audio). */
export const SYNTH_TIMEOUT_MS = 60_000;
/** Délai d'une liste de voix. */
export const LIST_TIMEOUT_MS = 20_000;
/** Taille maximale d'une réponse de synthèse (JSON, audio en base64) : 8 Mo. */
export const MAX_SYNTH_RESPONSE_BYTES = 8 * 1024 * 1024;
/** Taille maximale d'une liste de voix : 2 Mo. */
export const MAX_LIST_RESPONSE_BYTES = 2 * 1024 * 1024;

export type TtsVoice = { languageCode: string; name: string };
export type TtsAudio = { speakingRate?: number };
export type TtsClient = { apiKey: string; fetch: HttpFetch; signal?: AbortSignal; timeoutMs?: number };

/** Réponse de `text:synthesize` : `audioContent` en base64 (champ `bytes` de l'API). */
const SynthesizeResponse = z.object({ audioContent: z.base64().min(1) });

/** Réponse de `voices` : on ne garde que les champs utiles. */
const VoicesResponse = z.object({
  voices: z
    .array(
      z.object({
        languageCodes: z.array(z.string()),
        name: z.string().min(1),
        ssmlGender: z.string().optional(),
        naturalSampleRateHertz: z.number().int().optional(),
      }),
    )
    .max(5000)
    .default([]),
});

export type VoiceInfo = z.infer<typeof VoicesResponse>['voices'][number];

/** Réponse audio inutilisable (vide, pas un MP3, trop lourde) : comptée comme un échec du service. */
export class TtsAudioError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TtsAudioError';
  }
}

/** En-têtes : la clé passe par `x-goog-api-key`, jamais dans l'URL. */
const headers = (apiKey: string) => ({ 'x-goog-api-key': apiKey, 'content-type': 'application/json; charset=utf-8', accept: 'application/json' });

/**
 * Synthétise un morceau en MP3 (POST `text:synthesize`). La réponse est bornée en taille et validée,
 * et l'audio décodé doit être un MP3 (contrôle du lot 4). Lève HttpError, BodyError, ZodError,
 * TtsAudioError ou une erreur réseau ; le message ne contient jamais la clé.
 */
export async function synthesize(text: string, voice: TtsVoice, audio: TtsAudio, client: TtsClient): Promise<Buffer> {
  if (utf8Bytes(text) > TTS_MAX_REQUEST_BYTES) throw new Error(`morceau de ${utf8Bytes(text)} octets, au-dessus de la limite de l'API`);
  const body = JSON.stringify({
    input: { text },
    voice: { languageCode: voice.languageCode, name: voice.name },
    audioConfig: { audioEncoding: 'MP3', ...(audio.speakingRate !== undefined ? { speakingRate: audio.speakingRate } : {}) },
  });
  const json = await fetchJson(client.fetch, `${TTS_BASE}/text:synthesize`, {
    method: 'POST',
    headers: headers(client.apiKey),
    body,
    signal: client.signal,
    timeoutMs: client.timeoutMs ?? SYNTH_TIMEOUT_MS,
    maxBytes: MAX_SYNTH_RESPONSE_BYTES,
  });
  const bytes = Buffer.from(SynthesizeResponse.parse(json).audioContent, 'base64');
  if (!looksLikeMp3(bytes)) throw new TtsAudioError('réponse audio qui n’est pas un MP3');
  return bytes;
}

/** Liste les voix d'une langue (GET `voices?languageCode=`), validées. */
export async function listVoices(languageCode: string, client: TtsClient): Promise<VoiceInfo[]> {
  const json = await fetchJson(client.fetch, `${TTS_BASE}/voices?${new URLSearchParams({ languageCode })}`, {
    headers: headers(client.apiKey),
    signal: client.signal,
    timeoutMs: client.timeoutMs ?? LIST_TIMEOUT_MS,
    maxBytes: MAX_LIST_RESPONSE_BYTES,
  });
  return VoicesResponse.parse(json).voices;
}

/** Voix Chirp 3 HD d'une langue (spec §16 : filtre sur « Chirp3-HD »), triées par nom. */
export function chirp3HdVoices(voices: VoiceInfo[], languageCode: string): VoiceInfo[] {
  return voices.filter((v) => v.name.includes('Chirp3-HD') && v.languageCodes.includes(languageCode)).sort((a, b) => a.name.localeCompare(b.name));
}
