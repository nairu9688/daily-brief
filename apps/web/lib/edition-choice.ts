import { LANGS, type Lang } from '@daily-brief/schema';

/** Cookie qui retient l'onglet d'édition choisi (FR/EN/ES). */
export const EDITION_COOKIE = 'ed';

export const isLang = (v: unknown): v is Lang => typeof v === 'string' && (LANGS as readonly string[]).includes(v);

/** Langue choisie : valeur du cookie si elle est valide, sinon FR. */
export const chosenLang = (cookie: string | undefined): Lang => (isLang(cookie) ? cookie : 'fr');
