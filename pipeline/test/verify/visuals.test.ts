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
});

describe('arcProblem', () => {
  it('vérifie que l’arc relie deux lieux de la carte', () => {
    const v = fixtureEdition('fr').sections[1].stories[1].visual;
    if (v.type !== 'map') throw new Error('carte attendue');
    expect(arcProblem(v.map)).toBeNull();
    expect(arcProblem({ ...v.map, arc: ['Madrid', 'Lviv'] })).toMatch(/Lviv/);
  });
});
