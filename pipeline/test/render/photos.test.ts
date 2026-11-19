import { describe, expect, it } from 'vitest';
import { fillPhotos } from '../../render/photos';
import { fixtureEdition } from '../helpers';
import { photo } from './photo';

const photoStories = (ed: ReturnType<typeof fixtureEdition>) =>
  ed.sections.flatMap((s) => s.stories).filter((st) => st.visual.type === 'photo');

describe('fillPhotos', () => {
  it('renseigne les photos, une recherche par requête, sans modifier l’entrée', async () => {
    const ed = fixtureEdition('fr');
    const before = JSON.stringify(ed);
    const queries: string[] = [];
    const r = await fillPhotos(ed, async (q) => {
      queries.push(q);
      return photo(queries.length);
    });
    expect(JSON.stringify(ed)).toBe(before);
    expect(queries).toEqual(['car factory', 'high-speed train']);
    for (const st of photoStories(r.edition)) expect(st.visual.type === 'photo' && st.visual.photo).toBeTruthy();
    expect(r.problems).toEqual([]);
  });

  it('signale une recherche sans résultat ou en erreur, sans bloquer', async () => {
    const r = await fillPhotos(fixtureEdition('fr'), async (q) => {
      if (q === 'car factory') throw new Error('HTTP 500');
      return null;
    });
    expect(r.problems).toEqual([
      '2026-11-06-fr-5 : HTTP 500',
      '2026-11-06-fr-6 : aucune photo libre sur Wikimedia Commons pour « high-speed train »',
    ]);
    for (const st of photoStories(r.edition)) expect(st.visual.type === 'photo' && st.visual.photo).toBeFalsy();
  });

  it('ne refait pas la recherche d’une photo déjà renseignée', async () => {
    const first = await fillPhotos(fixtureEdition('fr'), async () => photo(1));
    let calls = 0;
    await fillPhotos(first.edition, async () => {
      calls++;
      return photo(2);
    });
    expect(calls).toBe(0);
  });
});
