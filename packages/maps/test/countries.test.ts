import { describe, expect, it } from 'vitest';
import { countryByAlpha3, mainBounds, numericId } from '../src/countries';

describe('pays', () => {
  it('convertit les codes alpha-3 en identifiants world-atlas', () => {
    expect(numericId('FRA')).toBe('250');
    expect(numericId('AUT')).toBe('040');
    expect(numericId('XXX')).toBeUndefined();
    expect(countryByAlpha3('ESP')?.properties.name).toBe('Spain');
  });

  it('cadre la métropole, sans outre-mer ni îles lointaines', () => {
    const [[w, s], [e, n]] = mainBounds(countryByAlpha3('FRA')!);
    expect(w).toBeGreaterThan(-6);
    expect(e).toBeLessThan(9);
    expect(s).toBeGreaterThan(42);
    expect(n).toBeLessThan(52);
    const [[, sEsp]] = mainBounds(countryByAlpha3('ESP')!);
    expect(sEsp).toBeGreaterThan(35);
  });
});
