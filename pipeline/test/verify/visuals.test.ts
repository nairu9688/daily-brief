import { describe, expect, it } from 'vitest';
import { arcProblem, photoQueryProblem } from '../../verify/visuals';
import { fixtureEdition } from '../helpers';

describe('photoQueryProblem (R11)', () => {
  it('accepte une requête d’objets ou de lieux', () => {
    expect(photoQueryProblem('high-speed train', ['Sophie Binet · CGT'])).toBeNull();
    expect(photoQueryProblem('car factory', [])).toBeNull();
  });

  it('refuse un nom propre, un nom de personne citée et une requête trop longue', () => {
    expect(photoQueryProblem('Emmanuel Macron', [])).toMatch(/majuscule/);
    expect(photoQueryProblem('binet protest', ['Sophie Binet · CGT'])).toMatch(/binet/);
    expect(photoQueryProblem('a b c d e f', [])).toMatch(/5 mots/);
  });

  it('compare les noms sans accents ni ponctuation', () => {
    expect(photoQueryProblem('sanchez rally', ['Pedro Sánchez'])).toMatch(/sanchez/);
    expect(photoQueryProblem('binet, protest', ['Sophie Binet'])).toMatch(/binet/);
    expect(photoQueryProblem('luc portrait', ['Jean-Luc Mélenchon'])).toMatch(/luc/);
    expect(photoQueryProblem('xi portrait', ['Xi Jinping'])).toMatch(/xi/);
    expect(photoQueryProblem('high-speed train', ['Sophie Binet · CGT'])).toBeNull();
  });

  it('refuse une requête vide', () => {
    expect(photoQueryProblem('', [])).toBe('requête vide');
    expect(photoQueryProblem('   ', [])).toBe('requête vide');
  });
});

describe('arcProblem', () => {
  it('vérifie que l’arc relie deux lieux de la carte', () => {
    const v = fixtureEdition('fr').sections[1].stories[1].visual;
    if (v.type !== 'map') throw new Error('carte attendue');
    expect(arcProblem(v.map)).toBeNull();
    expect(arcProblem({ ...v.map, arc: ['Madrid', 'Lviv'] })).toMatch(/Lviv/);
    const name = v.map.places[0].name;
    expect(arcProblem({ ...v.map, arc: [name, name] })).toBe('arc vers un même lieu');
  });
});
