import { z } from 'zod';
import { PexelsPhotoSchema, type PexelsPhoto } from '@daily-brief/schema';
import type { FetchLike } from './http';

/** Seuls hôtes de confiance : images (téléchargées) et pages de crédit (liées dans le PDF). */
export const PEXELS_IMAGE_HOST = 'images.pexels.com';
export const PEXELS_PAGE_HOST = 'www.pexels.com';

export function isHttpsOn(url: string, host: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === 'https:' && u.hostname === host;
  } catch {
    return false;
  }
}

/** Photo conforme au schéma, dont l'image est sur images.pexels.com et les crédits sur www.pexels.com (https). */
export function isTrustedPexelsPhoto(photo: unknown): photo is PexelsPhoto {
  const parsed = PexelsPhotoSchema.safeParse(photo);
  if (!parsed.success) return false;
  const p = parsed.data;
  return isHttpsOn(p.src, PEXELS_IMAGE_HOST) && isHttpsOn(p.pexelsUrl, PEXELS_PAGE_HOST) && isHttpsOn(p.photographerUrl, PEXELS_PAGE_HOST);
}

/** Erreur HTTP de l'API Pexels ; 401 (clé refusée) et 429 (quota) rendent l'API inutilisable pour la suite. */
export class PexelsHttpError extends Error {
  constructor(readonly status: number, query: string) {
    super(`Pexels ${status} pour « ${query} »`);
  }
}

const SEARCH = 'https://api.pexels.com/v1/search';

const PexelsSearchSchema = z.object({
  photos: z.array(
    z.object({
      id: z.number(),
      width: z.number(),
      height: z.number(),
      url: z.string(),
      photographer: z.string(),
      photographer_url: z.string(),
      alt: z.string().nullable().optional(),
      src: z.object({ large: z.string() }),
    }),
  ),
});

/**
 * Cherche une photo libre de droits sur Pexels (R11 : la requête a déjà été validée par brief:verify).
 * Renvoie la première photo paysage, ou null si aucune ; lève une erreur si l'API répond en erreur.
 */
export async function findPhoto(query: string, opts: { apiKey: string; fetch: FetchLike; timeoutMs?: number }): Promise<PexelsPhoto | null> {
  const url = `${SEARCH}?${new URLSearchParams({ query, orientation: 'landscape', per_page: '5', size: 'medium' })}`;
  const res = await opts.fetch(url, { headers: { Authorization: opts.apiKey }, signal: AbortSignal.timeout(opts.timeoutMs ?? 10_000) });
  if (!res.ok) throw new PexelsHttpError(res.status, query);
  const { photos } = PexelsSearchSchema.parse(await res.json());
  const p = photos.find((x) => x.width > x.height) ?? photos[0];
  if (!p) return null;
  const photo = {
    id: p.id,
    src: p.src.large,
    width: p.width,
    height: p.height,
    photographer: p.photographer,
    photographerUrl: p.photographer_url,
    pexelsUrl: p.url,
    ...(p.alt ? { alt: p.alt } : {}),
  };
  if (!isTrustedPexelsPhoto(photo)) throw new Error(`photo Pexels invalide pour « ${query} »`);
  return photo;
}
