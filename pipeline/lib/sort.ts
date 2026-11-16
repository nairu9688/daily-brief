import { LANGS } from '@daily-brief/schema';

/** Comparaison binaire de chaînes, indépendante de la locale. */
export const cmp = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** Rang d'une langue : FR, EN, ES, puis les autres. */
export const langRank = (l: string): number => {
  const i = (LANGS as readonly string[]).indexOf(l);
  return i === -1 ? LANGS.length : i;
};
