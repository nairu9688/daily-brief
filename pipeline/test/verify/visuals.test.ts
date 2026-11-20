import { describe, expect, it } from 'vitest';
import { arcProblem, photoQueryPlaceWarning, photoQueryProblem } from '../../verify/visuals';
import { fixtureEdition } from '../helpers';

describe('photoQueryPlaceWarning (R11, 20/11/2026)', () => {
  it('signale une requête qui ne nomme aucun lieu : la photo risque d’être prise ailleurs', () => {
    expect(photoQueryPlaceWarning('television studio cameras debate')).toMatch(/aucun lieu/);
    expect(photoQueryPlaceWarning('car factory')).toMatch(/aucun lieu/);
  });

  it('accepte un pays, un adjectif de pays, une région ou une ville', () => {
    for (const q of ['spain parliament building madrid', 'spanish parliament', 'congreso de los diputados madrid', 'catalonia flag', 'paris skyline', 'iowa farm']) expect(photoQueryPlaceWarning(q), q).toBeNull();
  });
});

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
