import { z } from 'zod';
import { Breaker, describeError } from '../collect/breaker';
import { BodyError, HttpError, isTimeout } from '../collect/http';
import { CharBudget } from './budget';
import { billedChars, chunkScript, MAX_CHUNK_BYTES, normalizeScript } from './chunk';
import { concatMp3, type ConcatMethod } from './concat';
import { synthesize, TtsAudioError, type TtsClient } from './tts';
import type { VoiceConfig } from './voices';

/** Tentatives par morceau : une seconde chance après une erreur 5xx ou réseau. */
export const ATTEMPTS_PER_CHUNK = 2;

export type VoiceEditionDeps = {
  client: TtsClient;
  /** Disjoncteur partagé par toutes les éditions du passage. */
  breaker: Breaker;
  budget: CharBudget;
  /** Chemin de ffmpeg, ou null pour la concaténation des trames. */
  ffmpeg: string | null;
  maxChunkBytes?: number;
};

export type VoicedEdition = {
  bytes: Buffer;
  seconds: number;
  chunks: number;
  /** Caractères envoyés pour cette édition (tentatives répétées comprises). */
  characters: number;
  method: ConcatMethod;
  warnings: string[];
};

/** Échec d'une édition ; le message est déjà résumé (sans corps de réponse), à masquer avant affichage. */
export class VoiceEditionError extends Error {
  constructor(
    message: string,
    readonly characters: number,
  ) {
    super(message);
    this.name = 'VoiceEditionError';
  }
}

/** Erreur passagère qui mérite une seconde tentative : 5xx ou erreur réseau (pas un délai, qui coupe le service). */
function retryable(e: unknown): boolean {
  if (e instanceof HttpError) return e.status >= 500;
  if (e instanceof TtsAudioError || e instanceof BodyError || e instanceof z.ZodError || e instanceof SyntaxError || isTimeout(e)) return false;
  return e instanceof Error;
}

/**
 * Lit un `audioScript` avec une voix : découpage, synthèse de chaque morceau (budget, disjoncteur,
 * une seconde tentative sur 5xx ou erreur réseau), puis concaténation. Lève VoiceEditionError.
 */
export async function voiceEdition(script: string, voice: VoiceConfig, deps: VoiceEditionDeps): Promise<VoicedEdition> {
  let characters = 0;
  const fail = (message: string): never => {
    throw new VoiceEditionError(message, characters);
  };
  if (deps.breaker.open) fail(`Text-to-Speech coupé (${deps.breaker.reason})`);
  let chunks: string[];
  try {
    chunks = chunkScript(script, deps.maxChunkBytes ?? MAX_CHUNK_BYTES);
  } catch (e) {
    return fail(`découpage impossible : ${(e as Error).message}`);
  }
  if (chunks.length === 0) fail('audioScript vide');
  const refusal = deps.budget.refuseEdition(billedChars(normalizeScript(script)));
  if (refusal) fail(refusal);

  const parts: Buffer[] = [];
  for (const [i, text] of chunks.entries()) {
    for (let attempt = 1; ; attempt++) {
      if (deps.client.signal?.aborted) fail(`morceau ${i + 1}/${chunks.length} : échéance du passage dépassée`);
      const chars = billedChars(text);
      if (!deps.budget.take(chars)) fail(`plafond du passage atteint (${deps.budget.sent} caractères envoyés, ${deps.budget.perRun} au plus)`);
      characters += chars;
      try {
        parts.push(await synthesize(text, { languageCode: voice.languageCode, name: voice.name }, { speakingRate: voice.speakingRate }, deps.client));
        deps.breaker.success();
        break;
      } catch (e) {
        if (deps.client.signal?.aborted) fail(`morceau ${i + 1}/${chunks.length} : échéance du passage dépassée`);
        const cut = deps.breaker.trip(e);
        const where = `morceau ${i + 1}/${chunks.length} : ${describeError(e)}`;
        if (cut) fail(`${where} — Text-to-Speech coupé (${deps.breaker.reason})`);
        if (attempt >= ATTEMPTS_PER_CHUNK || !retryable(e)) fail(where);
      }
    }
  }

  try {
    const r = await concatMp3(parts, deps.ffmpeg, { signal: deps.client.signal });
    return { bytes: r.bytes, seconds: r.seconds, chunks: chunks.length, characters, method: r.method, warnings: r.warnings };
  } catch (e) {
    return fail(`concaténation impossible : ${(e as Error).message}`);
  }
}
