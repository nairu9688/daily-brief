import type { FetchLike } from './http';

export const MAX_IMAGE_BYTES = 3_000_000;

/** Seuls formats raster acceptés : exclut svg (scripts), gif, html, etc. */
export const ALLOWED_IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

/** Télécharge une image et la renvoie en data URI pour l'intégrer au PDF ; null en cas d'échec, de type non autorisé ou si trop lourde. */
export async function fetchAsDataUri(url: string, fetch: FetchLike): Promise<string | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const type = (res.headers.get('content-type') ?? 'image/jpeg').split(';')[0].trim().toLowerCase();
    if (!ALLOWED_IMAGE_TYPES.has(type)) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length === 0 || buf.length > MAX_IMAGE_BYTES) return null;
    return `data:${type};base64,${buf.toString('base64')}`;
  } catch {
    return null;
  }
}
