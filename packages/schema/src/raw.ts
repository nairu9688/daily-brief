import { z } from 'zod';
import { IsoDateSchema, LangSchema, UrlSchema } from './edition';

/** Un article collecté (lot 3). `text` n'est rempli que pour les domaines au statut `full` (R1). */
export const RawArticleSchema = z.object({
  id: z.string().min(1),
  url: UrlSchema,
  outlet: z.string().min(1),
  title: z.string().min(1),
  description: z.string().nullable(),
  lang: z.string().min(2),
  publishedAt: z.string().nullable(),
  origin: z.enum(['thenewsapi', 'exa', 'webz', 'rss', 'newsletter']),
  text: z.string().nullable(),
  groupId: z.string().optional(),
});

export const RawCollectionSchema = z.object({
  date: IsoDateSchema,
  collectedAt: z.iso.datetime({ offset: true }),
  articles: z.array(RawArticleSchema),
  errors: z.array(z.object({ source: z.string(), message: z.string() })),
});

export const OpenThreadSchema = z.object({
  id: z.string().min(1),
  slug: z.string().min(1),
  title: z.string().min(1),
  lang: LangSchema,
  updatedAt: z.iso.datetime({ offset: true }),
});

/** Sortie de `brief:context` : Threads ouverts et sujets de la veille. */
export const ContextSchema = z.object({
  date: IsoDateSchema,
  openThreads: z.array(OpenThreadSchema),
  yesterdayTopics: z.array(z.object({ lang: LangSchema, title: z.string() })),
});

export type RawArticle = z.infer<typeof RawArticleSchema>;
export type RawCollection = z.infer<typeof RawCollectionSchema>;
export type OpenThread = z.infer<typeof OpenThreadSchema>;
export type Context = z.infer<typeof ContextSchema>;
