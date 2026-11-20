import type { MapSpec, RubricKey } from '@daily-brief/schema';
import { findPlaces } from '../lib/places';

/** Requêtes photo (Wikimedia Commons) de repli quand celle de Claude viole R11 : objets ou lieux, jamais de personne. */
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

/** Mots d'un texte : sans accents, en minuscules, sans ponctuation, 2 caractères ou plus par défaut. */
const tokens = (text: string, min = 2): string[] =>
  text
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((w) => w.length >= min);

/** R11 : la requête ne doit contenir ni nom propre ni nom de personne cité dans l'édition. */
export function photoQueryProblem(query: string, people: string[]): string | null {
  if (query.trim() === '') return 'requête vide';
  if (/\p{Lu}/u.test(query)) return 'majuscule dans la requête : nom propre suspect';
  const words = tokens(query, 1); // le décompte compte aussi les mots d'une lettre
  if (words.length === 0) return 'requête vide';
  if (words.length > 5) return 'requête de plus de 5 mots';
  const names = new Set(people.flatMap(tokens));
  const hit = words.find((w) => w.length >= 2 && names.has(w));
  return hit ? `nom de personne dans la requête : ${hit}` : null;
}

/**
 * R11 (20/11/2026) : une requête photo doit nommer le pays, la région ou la ville du sujet (en minuscules) ;
 * sans lieu, Commons renvoie souvent une scène d'un autre pays (pancartes de l'Iowa pour un débat espagnol).
 * Avertissement seulement : le rendu refuse de toute façon une photo située ailleurs.
 */
export function photoQueryPlaceWarning(query: string): string | null {
  return findPlaces(query, { demonyms: true }).length ? null : `requête photo « ${query} » sans aucun lieu : nommer le pays ou la ville (en minuscules), ou préférer une carte`;
}

/** Les extrémités de l'arc doivent être deux lieux distincts de la carte. */
export function arcProblem(map: MapSpec): string | null {
  if (!map.arc) return null;
  const names = new Set(map.places.map((p) => p.name));
  const missing = map.arc.filter((n) => !names.has(n));
  if (missing.length) return `arc vers un lieu absent : ${missing.join(', ')}`;
  return map.arc[0] === map.arc[1] ? 'arc vers un même lieu' : null;
}
