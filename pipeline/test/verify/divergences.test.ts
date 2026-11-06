import { describe, expect, it } from 'vitest';
import { checkDivergence } from '../../verify/divergences';
import { fixtureBrief } from '../helpers';

const div = (a: string, b: string, byA = 'Autorités', byB = 'CGT') => ({
  metric: 'Mesure',
  a: { value: a, by: byA },
  b: { value: b, by: byB },
});

describe('checkDivergence (R7)', () => {
  it('accepte toutes les divergences de la fixture', () => {
    const all = fixtureBrief().editions.flatMap((e) => e.sections.flatMap((s) => s.stories.flatMap((st) => st.divergences)));
    expect(all.length).toBeGreaterThan(0);
    for (const d of all) expect(checkDivergence(d), d.metric).toEqual({ ok: true });
  });

  it('rejette le contre-exemple des rames avec et hors Eurostar', () => {
    const r = checkDivergence(div('130 rames hors Eurostar', '160 rames avec Eurostar', 'SNCF', 'Alstom'));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/périmètres différents/);
  });

  it('rejette valeurs identiques, source identique et valeurs non comparables', () => {
    expect(checkDivergence(div('575 000', '575\u00a0000')).ok).toBe(false);
    expect(checkDivergence(div('575 000', '1,6 million', 'CGT', 'cgt')).ok).toBe(false);
    expect(checkDivergence(div('575 000', 'beaucoup')).ok).toBe(false);
  });
});
