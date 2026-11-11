import { readFileSync } from 'node:fs';
import { z } from 'zod';

const PerLang = <T extends z.ZodType>(t: T) => z.strictObject({ fr: t, en: t, es: t });
const Ms = z.number().int().positive();

/** Plafond quotidien TheNewsAPI : 90 requêtes sur les 100 du plan gratuit (spec §4.1). */
export const THENEWSAPI_DAILY_CAP = 90;

const BudgetSchema = z
  .strictObject({
    total: z.number().int().min(0).max(THENEWSAPI_DAILY_CAP),
    fr: z.number().int().min(0),
    en: z.number().int().min(0),
    es: z.number().int().min(0),
    similar: z.number().int().min(0),
  })
  .refine((b) => b.fr + b.en + b.es + b.similar <= b.total, { message: 'la somme des postes dépasse le total' });

export const CollectConfigSchema = z.strictObject({
  note: z.string().optional(),
  primary: z.enum(['thenewsapi', 'exa']),
  windowHours: z.number().int().min(1).max(72),
  lightThreshold: z.number().int().min(1),
  thenewsapi: z.strictObject({
    limit: z.number().int().min(1).max(100),
    timeoutMs: Ms,
    locales: PerLang(z.string().regex(/^[a-z]{2}(,[a-z]{2})*$/)),
    budget: BudgetSchema,
  }),
  exa: z.strictObject({
    timeoutMs: Ms,
    numResults: z.number().int().min(1).max(100),
    maxRequests: z.number().int().min(0),
    fullDomains: PerLang(z.array(z.string().min(1))),
  }),
  webz: z.strictObject({
    timeoutMs: Ms,
    fallbackBelow: z.number().int().min(0),
    maxRequests: z.number().int().min(0),
    queries: PerLang(z.string().min(1)),
  }),
  rss: z.strictObject({ timeoutMs: Ms, maxBytes: z.number().int().positive(), maxItemsPerFeed: z.number().int().positive() }),
  fulltext: z.strictObject({
    timeoutMs: Ms,
    maxBytes: z.number().int().positive(),
    minChars: z.number().int().min(0),
    concurrency: z.number().int().min(1).max(16),
    maxFetches: z.number().int().min(0),
    deadlineMs: Ms,
  }),
});

export type CollectConfig = z.infer<typeof CollectConfigSchema>;
export type BudgetBucket = 'fr' | 'en' | 'es' | 'similar';

export function loadCollectConfig(path: string): CollectConfig {
  return CollectConfigSchema.parse(JSON.parse(readFileSync(path, 'utf8')));
}
