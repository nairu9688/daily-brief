import { readFileSync } from 'node:fs';
import { z } from 'zod';
import { RUBRIC_KEYS, type Lang, type RubricKey } from '@daily-brief/schema';

/** Catégories acceptées par TheNewsAPI (`categories`). */
export const THENEWSAPI_CATEGORIES = ['general', 'science', 'sports', 'business', 'health', 'entertainment', 'tech', 'politics', 'food', 'travel'] as const;

const PerLang = <T extends z.ZodType>(t: T) => z.strictObject({ fr: t, en: t, es: t });

const RubricSchema = z.strictObject({
  categories: z.array(z.enum(THENEWSAPI_CATEGORIES)).min(1),
  searchKeywords: z.boolean(),
  keywords: PerLang(z.array(z.string().min(1)).min(1)),
  exaQuery: PerLang(z.string().min(1)),
});

const RubriquesSchema = z.strictObject({
  note: z.string().optional(),
  rubrics: z.strictObject(Object.fromEntries(RUBRIC_KEYS.map((k) => [k, RubricSchema])) as Record<RubricKey, typeof RubricSchema>),
});

export type Rubric = z.infer<typeof RubricSchema>;
export type Rubriques = Record<RubricKey, Rubric>;

export function loadRubriques(path: string): Rubriques {
  return RubriquesSchema.parse(JSON.parse(readFileSync(path, 'utf8'))).rubrics;
}

/** Paramètre `search` de TheNewsAPI : mots-clés en OU, expressions entre guillemets ; null si la rubrique n'en utilise pas. */
export function searchOf(rubric: Rubric, lang: Lang): string | null {
  if (!rubric.searchKeywords) return null;
  return rubric.keywords[lang].map((k) => (/\s/.test(k) ? `"${k.replace(/"/g, '')}"` : k)).join(' | ');
}
