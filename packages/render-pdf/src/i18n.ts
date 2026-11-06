import type { Lang } from '@daily-brief/schema';

/** Libellés du PDF, repris de reference/render.mjs. */
export const T: Record<
  Lang,
  {
    edition: string;
    ai: string;
    sources: string;
    briefs: string;
    infos: string;
    subjects: (n: number) => string;
    translation: string;
    diverge: string;
    kpis: string;
    inThisEdition: string;
    vocab: string;
    words: string;
  }
> = {
  fr: {
    edition: 'Édition française',
    ai: 'Résumé IA · d’après les sources citées',
    sources: 'sources',
    briefs: 'En bref',
    infos: 'infos',
    subjects: (n) => (n > 1 ? `${n} sujets` : `${n} sujet`),
    translation: 'Traduction',
    diverge: 'Les sources divergent',
    kpis: 'Les chiffres du jour',
    inThisEdition: 'Dans cette édition',
    vocab: 'Vocab du jour',
    words: 'mots',
  },
  en: {
    edition: 'English edition',
    ai: 'AI summary · based on cited sources',
    sources: 'sources',
    briefs: 'In brief',
    infos: 'stories',
    subjects: (n) => (n > 1 ? `${n} stories` : `${n} story`),
    translation: 'Translation',
    diverge: 'Sources differ',
    kpis: 'Numbers of the day',
    inThisEdition: 'In this edition',
    vocab: 'Vocab du jour',
    words: 'mots',
  },
  es: {
    edition: 'Edición en español',
    ai: 'Resumen IA · según las fuentes citadas',
    sources: 'fuentes',
    briefs: 'En breve',
    infos: 'temas',
    subjects: (n) => (n > 1 ? `${n} temas` : `${n} tema`),
    translation: 'Traducción',
    diverge: 'Las fuentes difieren',
    kpis: 'Las cifras del día',
    inThisEdition: 'En esta edición',
    vocab: 'Vocab du jour',
    words: 'mots',
  },
};

/** Guillemets d'ouverture et de fermeture des citations. */
export const QUOTE_MARKS: Record<Lang, [string, string]> = { fr: ['« ', ' »'], en: ['“', '”'], es: ['« ', ' »'] };

/** Accents d'impression (design/pdf.css et prototype : ES plus sombre que dans l'appli, pour l'impression). */
export const ACCENT: Record<Lang, string> = { fr: '#3E6BFF', en: '#0E9F6E', es: '#C08A00' };
