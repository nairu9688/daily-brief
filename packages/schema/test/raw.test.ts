import { describe, expect, it } from 'vitest';
import { ContextSchema, RawCollectionSchema } from '../src';

describe('schémas de collecte et de contexte', () => {
  it('valide une collecte minimale', () => {
    const raw = {
      date: '2026-11-06',
      collectedAt: '2026-11-06T04:20:00Z',
      errors: [{ source: 'webz', message: 'quota' }],
      articles: [
        { id: 'a1', url: 'https://www.pbs.org/x', outlet: 'PBS', title: 'T', description: null, lang: 'en', publishedAt: null, origin: 'thenewsapi', text: 'corps', groupId: 'g1' },
      ],
    };
    expect(RawCollectionSchema.safeParse(raw).success).toBe(true);
    expect(RawCollectionSchema.safeParse({ ...raw, articles: [{ ...raw.articles[0], origin: 'google' }] }).success).toBe(false);
  });

  it('valide un contexte et refuse une langue inconnue', () => {
    const ctx = {
      date: '2026-11-06',
      openThreads: [{ id: 't1', slug: 'midterms-2026', title: 'Midterms 2026', lang: 'en', updatedAt: '2026-11-05' }],
      yesterdayTopics: [{ lang: 'fr', title: 'Grève' }],
    };
    expect(ContextSchema.safeParse(ctx).success).toBe(true);
    expect(ContextSchema.safeParse({ ...ctx, openThreads: [{ ...ctx.openThreads[0], lang: 'de' }] }).success).toBe(false);
  });
});
