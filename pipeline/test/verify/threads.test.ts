import { describe, expect, it } from 'vitest';
import { resolveThread } from '../../verify/threads';

const open = [{ id: 't-1', slug: 'midterms-2026', title: 'Midterms 2026', lang: 'en' as const, updatedAt: '2026-11-05' }];

describe('resolveThread (R12)', () => {
  it('garde un id ouvert et retire un id inconnu', () => {
    expect(resolveThread({ id: 't-1', title: 'Midterms 2026', subtitle: '' }, 'en', open).fix).toBeUndefined();
    const r = resolveThread({ id: 't-9', title: 'X', subtitle: '' }, 'en', open);
    expect(r.thread.id).toBeUndefined();
    expect(r.fix).toMatch(/t-9/);
  });

  it('rattache un titre identique au Thread ouvert de la même langue', () => {
    expect(resolveThread({ title: 'midterms 2026', subtitle: '' }, 'en', open).thread.id).toBe('t-1');
    expect(resolveThread({ title: 'Midterms 2026', subtitle: '' }, 'fr', open).thread.id).toBeUndefined();
  });

  it('laisse un nouveau Thread sans id', () => {
    expect(resolveThread({ title: 'Nouvelle affaire', subtitle: '' }, 'en', open)).toEqual({
      thread: { title: 'Nouvelle affaire', subtitle: '' },
    });
  });

  it('retire un id ouvert mais d’une autre langue', () => {
    const r = resolveThread({ id: 't-1', title: 'Autre', subtitle: '' }, 'fr', open);
    expect(r.thread.id).toBeUndefined();
    expect(r.fix).toMatch(/t-1/);
  });

  it('rattache par le titre après avoir retiré un id invalide', () => {
    const r = resolveThread({ id: 't-9', title: 'Midterms 2026', subtitle: '' }, 'en', open);
    expect(r.thread.id).toBe('t-1');
    expect(r.fix).toMatch(/t-9/);
    expect(r.fix).toMatch(/rattaché/);
  });
});
