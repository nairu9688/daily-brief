import type { Edition } from '@daily-brief/schema';
import { stableUuid } from './ids';
import type { EditionView } from './types';

export type FixtureMeta = { light: boolean; hasAudio: boolean; hasPdf: boolean; generatedAt: string };

/** Identifiant fixture d'un Thread : une langue, un titre (même règle d'unicité que les slugs du lot 4). */
export const fixtureThreadId = (lang: string, title: string) => stableUuid(`thread:${lang}:${title}`);
export const fixtureVocabId = (date: string, lang: string, term: string) => stableUuid(`vocab:${date}:${lang}:${term.trim().toLowerCase()}`);

/**
 * Édition de la fixture → modèle d'affichage. Doit donner exactement ce que donne une édition publiée
 * par `publish_edition` puis relue par `editionFromRows` (aux identifiants près) : c'est vérifié par
 * test/data/roundtrip.test.ts sur un vrai Postgres (PGlite).
 */
export function editionFromFixture(e: Edition, meta: FixtureMeta, state?: Map<string, { selected: boolean; ankiStatus: 'none' | 'queued' | 'sent' }>): EditionView {
  return {
    date: e.date,
    lang: e.lang,
    region: e.region,
    headline: e.headline,
    morningBrief: e.morningBrief,
    sections: e.sections.map((s) => ({
      key: s.key,
      title: s.title,
      stories: s.stories.map((st) => ({
        id: st.id,
        kicker: st.kicker,
        date: st.date,
        title: st.title,
        summary: st.summary,
        visual: st.visual,
        stats: st.stats,
        quote: st.quote,
        divergences: st.divergences,
        thread: st.thread ? { id: fixtureThreadId(e.lang, st.thread.title), title: st.thread.title, subtitle: st.thread.subtitle } : null,
        prepa: st.prepa,
        sources: st.sources,
      })),
      briefs: s.briefs,
    })),
    vocab: e.vocab
      ? {
          title: e.vocab.title,
          words: e.vocab.items.map((v) => {
            const id = fixtureVocabId(e.date, e.lang, v.term);
            const st = state?.get(id);
            return {
              id,
              term: v.term,
              pos: v.pos,
              translation: v.translation,
              example: v.example,
              sourceUrl: v.sourceUrl ?? null,
              selected: st?.selected ?? false,
              ankiStatus: st?.ankiStatus ?? 'none',
            };
          }),
        }
      : null,
    ...meta,
  };
}
