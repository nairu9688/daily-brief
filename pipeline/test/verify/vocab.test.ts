import { describe, expect, it } from 'vitest';
import { vocabWarnings } from '../../verify/vocab';
import { fixtureEdition } from '../helpers';

describe('vocabWarnings (R10)', () => {
  it('ne signale rien sur les vocabulaires de la fixture', () => {
    expect(vocabWarnings(fixtureEdition('en').vocab!)).toEqual([]);
    expect(vocabWarnings(fixtureEdition('es').vocab!)).toEqual([]);
  });

  it('signale un mot absent de sa phrase exemple', () => {
    const vocab = { title: 'T', items: [{ term: 'landslide', pos: 'n.', translation: 'raz-de-marée', example: 'Democrats won big.' }] };
    expect(vocabWarnings(vocab)).toEqual(['« landslide » absent de sa phrase exemple']);
  });

  it('traite les termes courts en mot entier', () => {
    const v = (term: string, example: string) => ({ title: 'T', items: [{ term, pos: 'n.', translation: 'x', example }] });
    expect(vocabWarnings(v('GDP', 'The GDP grew.'))).toEqual([]);
    expect(vocabWarnings(v('tax', 'Taxation rose.'))).toEqual(['« tax » absent de sa phrase exemple']);
  });
});
