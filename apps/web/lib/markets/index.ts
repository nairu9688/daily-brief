import 'server-only';
import { unstable_cache } from 'next/cache';
import { fixtureMode } from '@/lib/env';
import fixture from './fixture-spark.json';
import { parseSpark, SPARK_URL, type Quote } from './parse';

export type { Quote } from './parse';

/** Délai maximal de la requête, taille maximale de la réponse (≈ 10 Ko attendus). */
export const MARKETS_TIMEOUT_MS = 2500;
export const MARKETS_MAX_BYTES = 256 * 1024;
/** Cours gardés 10 minutes (données différées de toute façon). */
export const MARKETS_REVALIDATE_S = 600;
/** Après un échec, pas de nouvel essai avant une minute : une source en panne ne ralentit pas chaque page. */
const BACKOFF_MS = 60_000;

/** Lit au plus `max` octets du corps, sinon lève une erreur (la réponse est abandonnée). */
export async function readCapped(res: Response, max: number): Promise<string> {
  const declared = Number(res.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > max) throw new Error(`réponse trop grande (${declared} o)`);
  if (!res.body) return '';
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) {
      await reader.cancel();
      throw new Error(`réponse trop grande (> ${max} o)`);
    }
    chunks.push(value);
  }
  return new TextDecoder().decode(Buffer.concat(chunks));
}

/**
 * Une lecture de la source : délai strict, taille bornée, JSON validé par zod (parseSpark). Lève une
 * erreur en cas d'échec (jamais mise en cache).
 */
export async function fetchQuotes(fetchImpl: typeof fetch = fetch): Promise<Quote[]> {
  const res = await fetchImpl(SPARK_URL, {
    signal: AbortSignal.timeout(MARKETS_TIMEOUT_MS),
    headers: { accept: 'application/json', 'user-agent': 'Mozilla/5.0 (compatible; DailyBrief/1.0)' },
    redirect: 'error',
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const quotes = parseSpark(JSON.parse(await readCapped(res, MARKETS_MAX_BYTES)));
  if (!quotes) throw new Error('réponse illisible');
  return quotes;
}

const cachedQuotes = unstable_cache(() => fetchQuotes(), ['markets-spark-v1'], { revalidate: MARKETS_REVALIDATE_S, tags: ['markets'] });

let failedAt = 0;

/**
 * Cours pour le bloc « Marchés », ou null : le bloc est alors masqué, sans message (jamais d'erreur de page).
 * Mode fixture : la réponse enregistrée (lib/markets/fixture-spark.json), sauf FIXTURE_MARKETS=off (panne simulée).
 */
export async function loadMarkets(): Promise<Quote[] | null> {
  if (fixtureMode()) return process.env.FIXTURE_MARKETS === 'off' ? null : parseSpark(fixture);
  if (Date.now() - failedAt < BACKOFF_MS) return null;
  try {
    return await cachedQuotes();
  } catch (e) {
    failedAt = Date.now();
    console.warn('[daily-brief] marchés indisponibles :', e instanceof Error ? e.message : e);
    return null;
  }
}
