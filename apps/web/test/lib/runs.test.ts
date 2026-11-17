import { describe, expect, it } from 'vitest';
import { monthBounds, monthGrid, parseMonth, shiftMonth } from '@/lib/calendar';
import { runView } from '@/lib/runs';

const now = new Date('2026-11-06T12:00:00Z');

describe('page Santé', () => {
  it('affiche « interrompu » pour une ligne running de plus de 6 h, « en cours » sinon', () => {
    expect(runView({ date: '2026-11-06', status: 'running', steps: {}, notes: null, updatedAt: '2026-11-06T05:59:00Z' }, now).label).toBe('interrompu');
    expect(runView({ date: '2026-11-06', status: 'running', steps: {}, notes: null, updatedAt: '2026-11-06T06:01:00Z' }, now).label).toBe('en cours');
    expect(runView({ date: '2026-11-06', status: 'degraded', steps: {}, notes: null, updatedAt: '2026-11-01T00:00:00Z' }, now).label).toBe('dégradé');
  });

  it('range les étapes dans l’ordre de la routine, compte les Threads fermés et les éditions allégées', () => {
    const v = runView(
      {
        date: '2026-11-06',
        status: 'ok',
        notes: 'n',
        updatedAt: '2026-11-06T05:00:00Z',
        steps: {
          zeta: { status: 'ok' },
          publish: { status: 'ok', finishedAt: '2026-11-06T04:52:00Z', durationMs: 41000, counters: { editions: 3 }, errors: [] },
          collect: { status: 'degraded', counters: { articles: 10 }, errors: ['webz coupé'], perLang: { fr: { articles: 1, fullTexts: 3, light: true } } },
          audio: 'cassé',
          closedThreads: ['a', 'b'],
        },
      },
      now,
    );
    expect(v.steps.map((s) => s.name)).toEqual(['collect', 'audio', 'publish', 'zeta']);
    expect(v.steps[1].status).toBe('illisible');
    expect(v).toMatchObject({ closedThreads: 2, light: ['fr'], problems: 1 });
    expect(v.steps[2]).toMatchObject({ durationMs: 41000, counters: [['editions', 3]] });
  });
});

describe('calendrier de l’archive', () => {
  it('commence le lundi et complète les semaines', () => {
    const grid = monthGrid('2026-11');
    expect(grid.slice(0, 7)).toEqual([null, null, null, null, null, null, '2026-11-01']);
    expect(grid.length % 7).toBe(0);
    expect(grid.filter(Boolean)).toHaveLength(30);
  });

  it('valide et décale les mois', () => {
    expect(parseMonth('2026-11')).toBe('2026-11');
    expect(parseMonth('2026-13')).toBeNull();
    expect(parseMonth(undefined)).toBeNull();
    expect(shiftMonth('2026-01', -1)).toBe('2025-12');
    expect(monthBounds('2028-02')).toEqual({ first: '2028-02-01', last: '2028-02-29' });
  });
});
