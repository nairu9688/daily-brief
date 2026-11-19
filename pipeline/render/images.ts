import { isHttpsUrlOn, PHOTO_IMAGE_HOSTS } from '@daily-brief/schema';
import { readCapped } from '../collect/http';
import { WIKIMEDIA_USER_AGENT, type FetchLike } from './http';

export const MAX_IMAGE_BYTES = 3_000_000;

/** Seuls formats raster acceptés : exclut svg (scripts), gif, html, etc. */
export const ALLOWED_IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

const IMAGE_HEADERS = { 'User-Agent': WIKIMEDIA_USER_AGENT };

/**
 * Télécharge une image de Wikimedia (upload ou thumb, en https) et la renvoie en data URI pour
 * l'intégrer au PDF ; null en cas d'échec, d'hôte ou de type non autorisé, ou si elle dépasse 3 Mo.
 */
export async function fetchAsDataUri(url: string, fetch: FetchLike, timeoutMs = 10_000): Promise<string | null> {
  try {
    if (!isHttpsUrlOn(url, PHOTO_IMAGE_HOSTS)) return null;
    const res = await fetch(url, { headers: IMAGE_HEADERS, signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) {
      await res.body?.cancel().catch(() => {});
      return null;
    }
    const type = (res.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
    if (!ALLOWED_IMAGE_TYPES.has(type)) {
      await res.body?.cancel().catch(() => {});
      return null;
    }
    const buf = await readCapped(res, MAX_IMAGE_BYTES);
    if (buf.length === 0) return null;
    return `data:${type};base64,${buf.toString('base64')}`;
  } catch {
    return null;
  }
}
