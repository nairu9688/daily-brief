import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { findPhoto } from '../../render/pexels';
import { repoPath } from '../helpers';
import { fakeFetch } from './fake-fetch';

const search = JSON.parse(readFileSync(repoPath('fixtures/api/pexels-search.json'), 'utf8'));

describe('findPhoto', () => {
  it('envoie la clé et la requête, et préfère une photo paysage', async () => {
    const { fetch, calls } = fakeFetch({ 'https://api.pexels.com/v1/search': { json: search } });
    const photo = await findPhoto('high-speed train', { apiKey: 'cle-test', fetch });
    expect(calls[0].headers).toEqual({ Authorization: 'cle-test' });
    expect(calls[0].url).toContain('query=high-speed+train');
    expect(calls[0].url).toContain('orientation=landscape');
    expect(photo).toEqual({
      id: 2002,
      src: 'https://images.pexels.com/photos/2002/pexels-photo-2002.jpeg?auto=compress&cs=tinysrgb&h=650&w=940',
      width: 6000,
      height: 4000,
      photographer: 'Jo Rails',
      photographerUrl: 'https://www.pexels.com/@jo-rails',
      pexelsUrl: 'https://www.pexels.com/photo/high-speed-train-2002/',
      alt: 'High-speed train at speed',
    });
  });

  it('renvoie null sans résultat et lève une erreur sur un statut HTTP en erreur', async () => {
    const empty = fakeFetch({ 'https://api.pexels.com': { json: { photos: [] } } });
    expect(await findPhoto('x', { apiKey: 'k', fetch: empty.fetch })).toBeNull();
    const denied = fakeFetch({ 'https://api.pexels.com': { status: 401, json: {} } });
    await expect(findPhoto('x', { apiKey: 'k', fetch: denied.fetch })).rejects.toThrow(/Pexels 401/);
  });

  it('rejette une photo invalide (photographe vide, URL non http)', async () => {
    const bad = (patch: (p: any) => void) => {
      const s = structuredClone(search);
      s.photos = [s.photos[1]];
      patch(s.photos[0]);
      return fakeFetch({ 'https://api.pexels.com': { json: s } }).fetch;
    };
    await expect(findPhoto('x', { apiKey: 'k', fetch: bad((p) => (p.photographer = '')) })).rejects.toThrow(/photo Pexels invalide/);
    await expect(findPhoto('x', { apiKey: 'k', fetch: bad((p) => (p.src.large = 'ftp://x')) })).rejects.toThrow(/photo Pexels invalide/);
  });

  it('abandonne après le délai réseau', async () => {
    const { fetch } = fakeFetch({ 'https://api.pexels.com': { hang: true } });
    await expect(findPhoto('x', { apiKey: 'k', fetch, timeoutMs: 20 })).rejects.toThrow();
  });
});
