import type { FetchLike } from './http';
import { isHttpsOn, PEXELS_IMAGE_HOST } from './pexels';

export const MAX_IMAGE_BYTES = 3_000_000;

/** Seuls formats raster acceptés : exclut svg (scripts), gif, html, etc. */
export const ALLOWED_IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

/** Télécharge une image et la renvoie en data URI pour l'intégrer au PDF ; null en cas d'échec, de type non autorisé ou si trop lourde. */
export async function fetchAsDataUri(url: string, fetch: FetchLike, timeoutMs = 10_000): Promise<string | null> {
  try {
    if (!isHttpsOn(url, PEXELS_IMAGE_HOST)) return null;
    const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) return null;
    const type = (res.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
    if (!ALLOWED_IMAGE_TYPES.has(type)) return null;
    const declared = Number(res.headers.get('content-length'));
    if (Number.isFinite(declared) && declared > MAX_IMAGE_BYTES) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length === 0 || buf.length > MAX_IMAGE_BYTES) return null;
    return `data:${type};base64,${buf.toString('base64')}`;
  } catch {
    return null;
  }
}
