import type { Edition, PexelsPhoto } from '@daily-brief/schema';

export type PhotoFinder = (query: string) => Promise<PexelsPhoto | null>;

/**
 * Renseigne `visual.pexels` des sujets illustrés par une photo qui n'en ont pas encore.
 * Une recherche par requête distincte ; un échec laisse le sujet sans photo et est signalé.
 */
export async function fillPhotos(ed: Edition, find: PhotoFinder): Promise<{ edition: Edition; problems: string[] }> {
  const out = structuredClone(ed);
  const problems: string[] = [];
  const cache = new Map<string, PexelsPhoto | null>();
  for (const story of out.sections.flatMap((s) => s.stories)) {
    const v = story.visual;
    if (v.type !== 'photo' || v.pexels) continue;
    if (!cache.has(v.query)) {
      try {
        cache.set(v.query, await find(v.query));
      } catch (e) {
        cache.set(v.query, null);
        problems.push(`${story.id} : ${(e as Error).message}`);
        continue;
      }
    }
    const photo = cache.get(v.query);
    if (photo) v.pexels = photo;
    else problems.push(`${story.id} : aucune photo Pexels pour « ${v.query} »`);
  }
  return { edition: out, problems };
}
