import type { Lang, RubricKey } from '@daily-brief/schema';

/** Libellés de l'édition, repris de reference/render.mjs (T) et de design/maquette-v2.html. */
export type EditionStrings = {
  label: string;
  all: string;
  ai: string;
  read: string;
  sources: string;
  briefs: string;
  empty: string;
  listen: string;
  pause: string;
  translation: string;
  infos: string;
  subjects: (n: number) => string;
  full: string;
  title: string;
  diverge: string;
  prepa: string;
  follow: string;
  following: string;
  episodes: (n: number) => string;
  light: string;
  yesterday: (date: string) => string;
};

export const T: Record<Lang, EditionStrings> = {
  fr: {
    label: 'Français',
    all: 'Tout',
    ai: 'Résumé IA · d’après les sources citées',
    read: 'Lire',
    sources: 'sources',
    briefs: 'En bref',
    empty: 'Rien de marquant dans cette rubrique ce matin.',
    listen: 'Écouter',
    pause: 'Pause',
    translation: 'Traduction',
    infos: 'infos',
    subjects: (n) => (n > 1 ? `${n} sujets` : `${n} sujet`),
    full: 'lu en entier',
    title: 'titre + lien',
    diverge: 'Les chiffres divergent',
    prepa: 'Lien prépa',
    follow: 'Suivre ce thread',
    following: 'Thread suivi',
    episodes: (n) => (n > 1 ? `${n} épisodes` : `${n} épisode`),
    light: 'Édition allégée : peu de sources lisibles ce matin.',
    yesterday: (d) => `Brief de la veille (${d}) : l’édition du jour n’est pas encore disponible.`,
  },
  en: {
    label: 'English',
    all: 'All',
    ai: 'AI summary · based on cited sources',
    read: 'Read',
    sources: 'sources',
    briefs: 'In brief',
    empty: 'Nothing major in this section this morning.',
    listen: 'Listen',
    pause: 'Pause',
    translation: 'Translation',
    infos: 'stories',
    subjects: (n) => (n > 1 ? `${n} stories` : `${n} story`),
    full: 'read in full',
    title: 'headline + link',
    diverge: 'Sources differ',
    prepa: 'Lien prépa',
    follow: 'Follow this thread',
    following: 'Following',
    episodes: (n) => (n > 1 ? `${n} episodes` : `${n} episode`),
    light: 'Light edition: few readable sources this morning.',
    yesterday: (d) => `Yesterday’s brief (${d}): today’s edition is not available yet.`,
  },
  es: {
    label: 'Español',
    all: 'Todo',
    ai: 'Resumen IA · según las fuentes citadas',
    read: 'Leer',
    sources: 'fuentes',
    briefs: 'En breve',
    empty: 'Nada destacado en esta sección esta mañana.',
    listen: 'Escuchar',
    pause: 'Pausa',
    translation: 'Traducción',
    infos: 'temas',
    subjects: (n) => (n > 1 ? `${n} temas` : `${n} tema`),
    full: 'leído entero',
    title: 'titular + enlace',
    diverge: 'Las cifras difieren',
    prepa: 'Lien prépa',
    follow: 'Seguir este hilo',
    following: 'Hilo seguido',
    episodes: (n) => (n > 1 ? `${n} episodios` : `${n} episodio`),
    light: 'Edición reducida: pocas fuentes legibles esta mañana.',
    yesterday: (d) => `Brief del día anterior (${d}): la edición de hoy aún no está disponible.`,
  },
};

/** Libellés courts des puces de rubriques (maquette), distincts des titres de rubrique. */
export const CHIP_LABELS: Record<Lang, Record<RubricKey, string>> = {
  fr: { pol: 'Politique & société', int: 'International', eco: 'Économie', ent: 'Entreprises', dro: 'Droit', tec: 'Tech & IA', env: 'Environnement', cul: 'Culture', spo: 'Sport' },
  en: { pol: 'Politics & society', int: 'World', eco: 'Economy', ent: 'Business', dro: 'Law', tec: 'Tech & AI', env: 'Environment', cul: 'Culture', spo: 'Sport' },
  es: { pol: 'Política', int: 'Internacional', eco: 'Economía', ent: 'Empresas', dro: 'Derecho', tec: 'Tecnología', env: 'Medio ambiente', cul: 'Cultura', spo: 'Deporte' },
};

/** Région affichée sous chaque onglet d'édition quand l'édition n'est pas chargée. */
export const REGION: Record<Lang, string> = { fr: 'France · Monde', en: 'US · UK', es: 'España' };

/** Guillemets des citations (comme packages/render-pdf). */
export const QUOTE_MARKS: Record<Lang, [string, string]> = { fr: ['« ', ' »'], en: ['“', '”'], es: ['« ', ' »'] };

const PALETTE = ['#0F3B85', '#B8860B', '#7A1F2B', '#1F6F5C', '#5B3FA0', '#A23B12', '#2E5E9E', '#6B6B1F', '#8A2E62', '#305C2E'];

/** Couleur de la pastille d'un média, stable (même calcul que le prototype). */
export const favColor = (outlet: string) => PALETTE[[...outlet].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7) % PALETTE.length];

/** Initiales d'un média (« Sud Radio · AFP » → « SR »). */
export const initials = (outlet: string) =>
  outlet
    .split(/[\s·]+/)
    .filter((w) => /^[A-Za-zÀ-ÿ]/.test(w))
    .slice(0, 2)
    .map((w) => w[0].toUpperCase())
    .join('');

/** Médias distincts, dans l'ordre d'apparition. */
export const uniqueOutlets = (sources: { outlet: string }[]) => [...new Set(sources.map((s) => s.outlet))];
