import type { Edition, Photo } from '@daily-brief/schema';

export type PhotoFinder = (query: string) => Promise<Photo | null>;

/**
 * Renseigne `visual.photo` des sujets illustrés par une photo qui n'en ont pas encore.
 * Une recherche par requête distincte ; un échec laisse le sujet sans photo (aplat) et est signalé.
 */
export async function fillPhotos(ed: Edition, find: PhotoFinder): Promise<{ edition: Edition; problems: string[] }> {
  const out = structuredClone(ed);
  const problems: string[] = [];
  const cache = new Map<string, Photo | null>();
  for (const story of out.sections.flatMap((s) => s.stories)) {
    const v = story.visual;
    if (v.type !== 'photo' || v.photo) continue;
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
    if (photo) v.photo = photo;
    else problems.push(`${story.id} : aucune photo libre sur Wikimedia Commons pour « ${v.query} »`);
  }
  return { edition: out, problems };
}
