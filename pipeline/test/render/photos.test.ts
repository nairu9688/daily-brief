import { describe, expect, it } from 'vitest';
import type { PexelsPhoto } from '@daily-brief/schema';
import { fillPhotos } from '../../render/photos';
import { fixtureEdition } from '../helpers';

const photo = (id: number): PexelsPhoto => ({
  id,
  src: `https://images.pexels.com/photos/${id}/p.jpeg`,
  width: 6000,
  height: 4000,
  photographer: 'P',
  photographerUrl: 'https://www.pexels.com/@p',
  pexelsUrl: `https://www.pexels.com/photo/${id}/`,
});

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
    for (const st of photoStories(r.edition)) expect(st.visual.type === 'photo' && st.visual.pexels).toBeTruthy();
    expect(r.problems).toEqual([]);
  });

  it('signale une recherche sans résultat ou en erreur, sans bloquer', async () => {
    const r = await fillPhotos(fixtureEdition('fr'), async (q) => {
      if (q === 'car factory') throw new Error('Pexels 500');
      return null;
    });
    expect(r.problems).toEqual([
      '2026-11-06-fr-5 : Pexels 500',
      '2026-11-06-fr-6 : aucune photo Pexels pour « high-speed train »',
    ]);
    for (const st of photoStories(r.edition)) expect(st.visual.type === 'photo' && st.visual.pexels).toBeFalsy();
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
