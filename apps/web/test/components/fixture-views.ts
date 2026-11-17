import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Brief, Lang } from '@daily-brief/schema';
import { fixturesDir } from '@/lib/data/fixture';
import { editionFromFixture } from '@/lib/data/fixture-edition';
import type { EditionView, StoryView } from '@/lib/data/types';

// Lecture directe : en jsdom, les chemins tirés de import.meta.url (pipeline/test/helpers.ts) ne sont pas fiables.
const brief = (): Brief => JSON.parse(readFileSync(join(fixturesDir(), 'brief-2026-11-06.json'), 'utf8'));

/** Éditions de la fixture au format d'affichage, pour les tests de composants. */
export function fixtureView(lang: Lang, meta: Partial<{ light: boolean; hasAudio: boolean; hasPdf: boolean }> = {}): EditionView {
  const ed = brief().editions.find((e) => e.lang === lang)!;
  return editionFromFixture(ed, { light: false, hasAudio: true, hasPdf: false, generatedAt: '2026-11-06T04:41:00.000Z', ...meta });
}

export function fixtureStory(id: string): StoryView {
  for (const lang of ['fr', 'en', 'es'] as Lang[]) {
    for (const s of fixtureView(lang).sections) {
      const st = s.stories.find((x) => x.id === id);
      if (st) return structuredClone(st);
    }
  }
  throw new Error(`sujet ${id} absent de la fixture`);
}
