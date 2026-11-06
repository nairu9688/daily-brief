const QUOTE_CHARS = /[«»“”„‟"‹›]/g;
const APOSTROPHES = /[’‘ʼ`´]/g;
const DASHES = /[‐-―−]/g;
const SPACES = /\s+/g;

/**
 * Forme de comparaison pour R5 : NFKC (espaces insécables → espace), apostrophes et tirets unifiés,
 * guillemets supprimés, espaces fusionnées, pas d'espace avant la ponctuation, minuscules.
 */
export function normalizeForMatch(s: string): string {
  return s
    .normalize('NFKC')
    .replace(APOSTROPHES, "'")
    .replace(QUOTE_CHARS, ' ')
    .replace(/…/g, '...')
    .replace(DASHES, '-')
    .replace(SPACES, ' ')
    .replace(/ ([?!:;.,])/g, '$1')
    .trim()
    .toLowerCase();
}
