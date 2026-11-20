// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Lang } from '@daily-brief/schema';
import { editionFromFixture } from '@/lib/data/fixture-edition';
import { EditionRowSchema, editionFromRows, parseRows, SourceRowSchema, StoryRowSchema, VocabRowSchema } from '@/lib/data/rows';
import type { EditionView } from '@/lib/data/types';
import { fixtureBrief } from '../../../../pipeline/test/helpers';
import { createTestDb, type TestDb } from '../../../../pipeline/test/supabase/pg';
import { editionRows, publishFixture } from './pg-rows';

/** Identifiants propres à chaque source (uuid de la base, uuid stables de la fixture) : hors comparaison. */
const withoutIds = (e: EditionView) => ({
  ...e,
  sections: e.sections.map((s) => ({ ...s, stories: s.stories.map((st) => ({ ...st, thread: st.thread && { ...st.thread, id: '-' } })) })),
  vocab: e.vocab && { ...e.vocab, words: e.vocab.words.map((w) => ({ ...w, id: '-' })) },
});

let db: TestDb;
beforeAll(async () => {
  db = await createTestDb();
  await publishFixture(db, { audio: ['fr', 'en'], light: ['es'] });
}, 60_000);
afterAll(async () => db.close());

describe('aller-retour Supabase ↔ fixture', () => {
  for (const lang of ['fr', 'en', 'es'] as Lang[]) {
    it(`l’édition ${lang} relue en base est celle de la fixture`, async () => {
      const raw = await editionRows(db, '2026-11-06', lang);
      const mapped = editionFromRows({
        edition: EditionRowSchema.parse(raw.edition),
        stories: parseRows(StoryRowSchema, raw.stories, 'sujet').value,
        sources: parseRows(SourceRowSchema, raw.sources, 'source').value,
        vocab: parseRows(VocabRowSchema, raw.vocab, 'mot').value,
      });
      expect(mapped.problems).toEqual([]);
      const ed = fixtureBrief().editions.find((e) => e.lang === lang)!;
      const expected = editionFromFixture(ed, { light: lang === 'es', hasAudio: lang !== 'es', hasPdf: true, generatedAt: '-' });
      expect(withoutIds({ ...mapped.value, generatedAt: '-' })).toEqual(withoutIds(expected));
      expect(mapped.value.generatedAt).toMatch(/^2026-11-06T04:41:00/);
    });
  }

  it('un visiteur sans session (anon) relit exactement les mêmes lignes que l’utilisateur autorisé', async () => {
    for (const lang of ['fr', 'en', 'es'] as Lang[]) {
      expect(await editionRows(db, '2026-11-06', lang, 'anon')).toEqual(await editionRows(db, '2026-11-06', lang));
    }
  });
});
