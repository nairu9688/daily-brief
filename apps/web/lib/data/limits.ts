/**
 * Bornes partagées par la lecture et l'écriture : /vocab lit au plus VOCAB_LIMIT mots, et une écriture
 * en accepte autant (« Tout cocher » en un appel). Ce module ne contient que des constantes.
 */
export const VOCAB_LIMIT = 500;
export const MAX_IDS = VOCAB_LIMIT;
/** Identifiants par requête d'écriture : l'URL `?id=in.(…)` reste sous les limites des passerelles. */
export const WRITE_BATCH = 100;
