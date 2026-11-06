import { describe, expect, it } from 'vitest';
import { fetchAsDataUri, MAX_IMAGE_BYTES } from '../../render/images';
import { fakeFetch } from './fake-fetch';

describe('fetchAsDataUri', () => {
  it('encode une image en data URI', async () => {
    const { fetch } = fakeFetch({ 'https://images.pexels.com/': { body: new Uint8Array([1, 2, 3]), type: 'image/jpeg' } });
    expect(await fetchAsDataUri('https://images.pexels.com/a.jpg', fetch)).toBe('data:image/jpeg;base64,AQID');
  });

  it('renvoie null sur une erreur, un type non image, un corps vide ou trop lourd', async () => {
    const { fetch } = fakeFetch({
      'https://images.pexels.com/404': { status: 404 },
      'https://images.pexels.com/html': { body: new Uint8Array([1]), type: 'text/html' },
      'https://images.pexels.com/empty': { type: 'image/png' },
      'https://images.pexels.com/big': { body: new Uint8Array(MAX_IMAGE_BYTES + 1), type: 'image/png' },
      'https://images.pexels.com/throw': () => {
        throw new Error('réseau');
      },
    });
    for (const u of ['404', 'html', 'empty', 'big', 'throw']) expect(await fetchAsDataUri(`https://images.pexels.com/${u}`, fetch), u).toBeNull();
  });

  it('refuse les types non raster (svg, gif)', async () => {
    const { fetch } = fakeFetch({
      'https://images.pexels.com/svg': { body: new Uint8Array([1, 2, 3]), type: 'image/svg+xml' },
      'https://images.pexels.com/gif': { body: new Uint8Array([1, 2, 3]), type: 'image/gif' },
    });
    expect(await fetchAsDataUri('https://images.pexels.com/svg', fetch)).toBeNull();
    expect(await fetchAsDataUri('https://images.pexels.com/gif', fetch)).toBeNull();
  });

  it('normalise l’en-tête content-type (paramètres, casse)', async () => {
    const { fetch } = fakeFetch({ 'https://images.pexels.com/': { body: new Uint8Array([1, 2, 3]), type: 'image/jpeg; charset=binary' } });
    expect(await fetchAsDataUri('https://images.pexels.com/a.jpg', fetch)).toBe('data:image/jpeg;base64,AQID');
  });

  it('renvoie null après le délai réseau', async () => {
    const { fetch } = fakeFetch({ 'https://images.pexels.com/': { hang: true } });
    expect(await fetchAsDataUri('https://images.pexels.com/slow.jpg', fetch, 20)).toBeNull();
  });

  it('refuse sur content-length trop grand sans lire le corps', async () => {
    let read = false;
    const { fetch } = fakeFetch({ 'https://images.pexels.com/': { body: new Uint8Array([1]), type: 'image/png', length: String(MAX_IMAGE_BYTES + 1) } });
    const spy: typeof fetch = async (u, i) => {
      const res = await fetch(u, i);
      return { ...res, arrayBuffer: async () => ((read = true), res.arrayBuffer()) };
    };
    expect(await fetchAsDataUri('https://images.pexels.com/big', spy)).toBeNull();
    expect(read).toBe(false);
  });

  it('refuse une réponse sans content-type', async () => {
    const { fetch } = fakeFetch({ 'https://images.pexels.com/': { body: new Uint8Array([1, 2, 3]), type: null } });
    expect(await fetchAsDataUri('https://images.pexels.com/a', fetch)).toBeNull();
  });

  it('ne télécharge que https://images.pexels.com', async () => {
    const { fetch, calls } = fakeFetch({ 'http': { body: new Uint8Array([1, 2, 3]), type: 'image/jpeg' } });
    for (const u of ['http://169.254.169.254/x.jpg', 'https://evil.example/x.jpg', 'http://images.pexels.com/x.jpg', 'https://images.pexels.com.evil.example/x.jpg', 'pas une url']) {
      expect(await fetchAsDataUri(u, fetch), u).toBeNull();
    }
    expect(calls).toHaveLength(0);
    expect(await fetchAsDataUri('https://images.pexels.com/photos/1/x.jpg', fetch)).toBe('data:image/jpeg;base64,AQID');
  });
});
