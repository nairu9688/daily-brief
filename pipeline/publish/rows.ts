import { createHash } from 'node:crypto';
import type { Edition, Lang, RubricKey, SourceRef } from '@daily-brief/schema';

export type SourcePayload = { rubric: RubricKey; position: number; outlet: string; title: string; url: string; lang: string; readFull: boolean; publishedAt: string | null };

export type StoryPayload = {
  key: string;
  rubric: RubricKey;
  /** Rang du sujet dans l'édition, à partir de 1, toutes rubriques confondues. */
  position: number;
  kicker: string;
  dateLabel: string;
  title: string;
  summary: string;
  visual: unknown;
  stats: unknown[];
  quote: unknown | null;
  divergences: unknown[];
  prepa: unknown | null;
  /** `id` présent : Thread existant ; absent : nouveau Thread, retrouvé ou créé par son `slug`. */
  thread: { id?: string; slug: string; title: string; subtitle: string } | null;
  sources: SourcePayload[];
};

/** Argument de la fonction SQL `publish_edition` (supabase/migrations/0003_publish.sql). */
export type EditionPayload = {
  edition: {
    date: string;
    lang: Lang;
    region: string;
    headline: string;
    morningBrief: Edition['morningBrief'];
    sections: { key: RubricKey; title: string }[];
    vocabTitle: string | null;
    audioPath: string | null;
    pdfPath: string | null;
    status: 'published' | 'light';
    generatedAt: string;
  };
  stories: StoryPayload[];
  /** Brèves (« En bref ») : sources sans sujet, rangées par rubrique. */
  briefs: SourcePayload[];
  vocab: { position: number; term: string; pos: string; translation: string; example: string; sourceUrl: string | null }[];
};

export type EditionMeta = {
  /** Chemin du PDF dans le bucket `pdf`, ou null s'il n'a pas pu être déposé. */
  pdfPath: string | null;
  /** Chemin du MP3 dans le bucket `audio`, ou null (édition sans lecteur, spec §9). */
  audioPath: string | null;
  /** Édition allégée : moins de 15 textes lus à la collecte (spec §12). */
  light: boolean;
  /** Horodatage ISO du rendu (`generatedAt` de render-report.json). */
  generatedAt: string;
};

/**
 * Slug d'un nouveau Thread : langue, puis titre sans accents ni ponctuation (« fr-midterms-2026 »).
 * Deux éditions peuvent suivre la même histoire sous le même titre : la langue les distingue.
 * Un titre sans lettre ni chiffre latin donne une empreinte stable.
 */
export function threadSlug(lang: Lang, title: string): string {
  const full = title
    .toLowerCase()
    // Lettres que NFKD ne décompose pas : sans cette table, « Œuvre » deviendrait « uvre ».
    .replace(/œ/g, 'oe')
    .replace(/æ/g, 'ae')
    .replace(/ß/g, 'ss')
    .replace(/ł/g, 'l')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  // Titre long : 71 caractères, un tiret et 8 signes d'une empreinte du titre complet, pour que deux
  // titres de même début ne se confondent pas.
  const base = full.length <= 80 ? full : `${full.slice(0, 71).replace(/-+$/, '')}-${createHash('sha256').update(full).digest('hex').slice(0, 8)}`;
  return `${lang}-${base || createHash('sha256').update(title.normalize('NFC')).digest('hex').slice(0, 12)}`;
}

const source = (rubric: RubricKey, position: number, s: SourceRef): SourcePayload => ({
  rubric,
  position,
  outlet: s.outlet,
  title: s.title,
  url: s.url,
  lang: s.lang,
  readFull: s.readFull,
  publishedAt: s.publishedAt ?? null,
});

/**
 * Édition → lignes à écrire (fonction pure). L'ordre du JSON est conservé par les rangs `position` :
 * sujets numérotés d'un bout à l'autre de l'édition, sources par sujet, brèves par rubrique, mots
 * dans l'ordre du « Vocab du jour ».
 */
export function editionPayload(edition: Edition, meta: EditionMeta): EditionPayload {
  let rank = 0;
  const stories: StoryPayload[] = [];
  const briefs: SourcePayload[] = [];
  for (const section of edition.sections) {
    for (const st of section.stories) {
      stories.push({
        key: st.id,
        rubric: section.key,
        position: ++rank,
        kicker: st.kicker,
        dateLabel: st.date,
        title: st.title,
        summary: st.summary,
        visual: st.visual,
        stats: st.stats,
        quote: st.quote,
        divergences: st.divergences,
        prepa: st.prepa,
        thread: st.thread ? { ...(st.thread.id ? { id: st.thread.id } : {}), slug: threadSlug(edition.lang, st.thread.title), title: st.thread.title, subtitle: st.thread.subtitle } : null,
        sources: st.sources.map((s, i) => source(section.key, i + 1, s)),
      });
    }
    section.briefs.forEach((s, i) => briefs.push(source(section.key, i + 1, s)));
  }
  return {
    edition: {
      date: edition.date,
      lang: edition.lang,
      region: edition.region,
      headline: edition.headline,
      morningBrief: edition.morningBrief,
      sections: edition.sections.map((s) => ({ key: s.key, title: s.title })),
      vocabTitle: edition.vocab?.title ?? null,
      audioPath: meta.audioPath,
      pdfPath: meta.pdfPath,
      status: meta.light ? 'light' : 'published',
      generatedAt: meta.generatedAt,
    },
    stories,
    briefs,
    vocab: (edition.vocab?.items ?? []).map((v, i) => ({ position: i + 1, term: v.term, pos: v.pos, translation: v.translation, example: v.example, sourceUrl: v.sourceUrl ?? null })),
  };
}
