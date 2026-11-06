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

  it('garde les grandes îles d’un archipel (Indonésie au-delà de Bornéo)', () => {
    const [[w], [e]] = mainBounds(countryByAlpha3('IDN')!);
    expect(w).toBeLessThan(100); // Sumatra
    expect(e).toBeGreaterThan(125); // Nouvelle-Guinée occidentale
  });

  it('rend une emprise qui traverse l’antiméridien sans artefact (Russie, Fidji)', () => {
    const [[w, s], [e, n]] = mainBounds(countryByAlpha3('RUS')!);
    expect(w).toBeGreaterThan(25); // pas Kaliningrad
    expect(e).toBeLessThan(-165); // Tchoukotka, au-delà de 180°
    expect(s).toBeGreaterThan(40);
    expect(n).toBeLessThan(80);
    const [[wf], [ef]] = mainBounds(countryByAlpha3('FJI')!);
    expect(wf).toBeGreaterThan(170);
    expect(ef < -170 || ef > 178).toBe(true);
  });

  it('retrouve par leur nom les pays sans identifiant dans world-atlas', () => {
    expect(countryByAlpha3('XKX')?.properties.name).toBe('Kosovo');
    expect(countryByAlpha3('CYN')?.properties.name).toBe('N. Cyprus');
    expect(countryByAlpha3('SOL')?.properties.name).toBe('Somaliland');
  });
});
