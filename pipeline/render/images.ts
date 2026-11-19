import { isHttpsUrlOn, PHOTO_IMAGE_HOSTS } from '@daily-brief/schema';
import { readCapped } from '../collect/http';
import { WIKIMEDIA_USER_AGENT, type FetchLike } from './http';

export const MAX_IMAGE_BYTES = 3_000_000;

/** Seuls formats raster acceptés : exclut svg (scripts), gif, html, etc. */
export const ALLOWED_IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

const IMAGE_HEADERS = { 'User-Agent': WIKIMEDIA_USER_AGENT };

/** Le contenu est-il bien du type annoncé ? Signatures JPEG (FF D8 FF), PNG (89 50 4E 47) et WebP (RIFF….WEBP). */
export function matchesMagic(buf: Uint8Array, type: string): boolean {
  const at = (offset: number, bytes: number[]) => bytes.every((b, i) => buf[offset + i] === b);
  if (type === 'image/jpeg') return at(0, [0xff, 0xd8, 0xff]);
  if (type === 'image/png') return at(0, [0x89, 0x50, 0x4e, 0x47]);
  if (type === 'image/webp') return at(0, [0x52, 0x49, 0x46, 0x46]) && at(8, [0x57, 0x45, 0x42, 0x50]);
  return false;
}

/**
 * Télécharge une image de Wikimedia (upload ou thumb, en https) et la renvoie en data URI pour
 * l'intégrer au PDF ; null en cas d'échec, de redirection, d'hôte ou de type non autorisé, de contenu
 * qui ne correspond pas au type annoncé, ou si elle dépasse 3 Mo.
 */
export async function fetchAsDataUri(url: string, fetch: FetchLike, timeoutMs = 10_000): Promise<string | null> {
  try {
    if (!isHttpsUrlOn(url, PHOTO_IMAGE_HOSTS)) return null;
    // Pas de redirection suivie : une 3xx vers un autre hôte ferait sortir du périmètre de confiance.
    const res = await fetch(url, { headers: IMAGE_HEADERS, redirect: 'error', signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok || (res.url !== undefined && res.url !== '' && !isHttpsUrlOn(res.url, PHOTO_IMAGE_HOSTS))) {
      await res.body?.cancel().catch(() => {});
      return null;
    }
    const type = (res.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
    if (!ALLOWED_IMAGE_TYPES.has(type)) {
      await res.body?.cancel().catch(() => {});
      return null;
    }
    const buf = await readCapped(res, MAX_IMAGE_BYTES);
    if (buf.length === 0 || !matchesMagic(buf, type)) return null;
    return `data:${type};base64,${buf.toString('base64')}`;
  } catch {
    return null;
  }
}
