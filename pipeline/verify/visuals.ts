import type { MapSpec, RubricKey } from '@daily-brief/schema';

/** Requêtes Pexels de repli quand celle de Claude viole R11 : objets ou lieux, jamais de personne. */
export const DEFAULT_PHOTO_QUERY: Record<RubricKey, string> = {
  pol: 'parliament building',
  int: 'world map',
  eco: 'city skyline',
  ent: 'office building',
  dro: 'courthouse',
  tec: 'computer chip',
  env: 'forest',
  cul: 'theater stage',
  spo: 'stadium',
};

/** R11 : la requête ne doit contenir ni nom propre ni nom de personne cité dans l'édition. */
export function photoQueryProblem(query: string, people: string[]): string | null {
  if (/\p{Lu}/u.test(query)) return 'majuscule dans la requête : nom propre suspect';
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length > 5) return 'requête de plus de 5 mots';
  const names = new Set(
    people.flatMap((p) => p.toLowerCase().split(/[\s·().,]+/)).filter((w) => w.length >= 3),
  );
  const hit = words.find((w) => names.has(w));
  return hit ? `nom de personne dans la requête : ${hit}` : null;
}

/** Les extrémités de l'arc doivent être des lieux de la carte. */
export function arcProblem(map: MapSpec): string | null {
  if (!map.arc) return null;
  const names = new Set(map.places.map((p) => p.name));
  const missing = map.arc.filter((n) => !names.has(n));
  return missing.length ? `arc vers un lieu absent : ${missing.join(', ')}` : null;
}
