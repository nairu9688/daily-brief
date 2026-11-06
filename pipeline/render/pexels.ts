import { z } from 'zod';
import type { PexelsPhoto } from '@daily-brief/schema';
import type { FetchLike } from './http';

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
      src: z.object({ large: z.string(), landscape: z.string() }),
    }),
  ),
});

/**
 * Cherche une photo libre de droits sur Pexels (R11 : la requête a déjà été validée par brief:verify).
 * Renvoie la première photo paysage, ou null si aucune ; lève une erreur si l'API répond en erreur.
 */
export async function findPhoto(query: string, opts: { apiKey: string; fetch: FetchLike }): Promise<PexelsPhoto | null> {
  const url = `${SEARCH}?${new URLSearchParams({ query, orientation: 'landscape', per_page: '5', size: 'medium' })}`;
  const res = await opts.fetch(url, { headers: { Authorization: opts.apiKey } });
  if (!res.ok) throw new Error(`Pexels ${res.status} pour « ${query} »`);
  const { photos } = PexelsSearchSchema.parse(await res.json());
  const p = photos.find((x) => x.width > x.height) ?? photos[0];
  if (!p) return null;
  return {
    id: p.id,
    src: p.src.large,
    width: p.width,
    height: p.height,
    photographer: p.photographer,
    photographerUrl: p.photographer_url,
    pexelsUrl: p.url,
    ...(p.alt ? { alt: p.alt } : {}),
  };
}
