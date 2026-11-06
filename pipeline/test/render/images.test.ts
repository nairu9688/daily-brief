import { describe, expect, it } from 'vitest';
import { fetchAsDataUri, MAX_IMAGE_BYTES } from '../../render/images';
import { fakeFetch } from './fake-fetch';

describe('fetchAsDataUri', () => {
  it('encode une image en data URI', async () => {
    const { fetch } = fakeFetch({ 'https://img/': { body: new Uint8Array([1, 2, 3]), type: 'image/jpeg' } });
    expect(await fetchAsDataUri('https://img/a.jpg', fetch)).toBe('data:image/jpeg;base64,AQID');
  });

  it('renvoie null sur une erreur, un type non image, un corps vide ou trop lourd', async () => {
    const { fetch } = fakeFetch({
      'https://img/404': { status: 404 },
      'https://img/html': { body: new Uint8Array([1]), type: 'text/html' },
      'https://img/empty': { type: 'image/png' },
      'https://img/big': { body: new Uint8Array(MAX_IMAGE_BYTES + 1), type: 'image/png' },
      'https://img/throw': () => {
        throw new Error('réseau');
      },
    });
    for (const u of ['404', 'html', 'empty', 'big', 'throw']) expect(await fetchAsDataUri(`https://img/${u}`, fetch), u).toBeNull();
  });

  it('refuse les types non raster (svg, gif)', async () => {
    const { fetch } = fakeFetch({
      'https://img/svg': { body: new Uint8Array([1, 2, 3]), type: 'image/svg+xml' },
      'https://img/gif': { body: new Uint8Array([1, 2, 3]), type: 'image/gif' },
    });
    expect(await fetchAsDataUri('https://img/svg', fetch)).toBeNull();
    expect(await fetchAsDataUri('https://img/gif', fetch)).toBeNull();
  });

  it('normalise l’en-tête content-type (paramètres, casse)', async () => {
    const { fetch } = fakeFetch({ 'https://img/': { body: new Uint8Array([1, 2, 3]), type: 'image/jpeg; charset=binary' } });
    expect(await fetchAsDataUri('https://img/a.jpg', fetch)).toBe('data:image/jpeg;base64,AQID');
  });

  it('renvoie null après le délai réseau', async () => {
    const { fetch } = fakeFetch({ 'https://img/': { hang: true } });
    expect(await fetchAsDataUri('https://img/slow.jpg', fetch, 20)).toBeNull();
  });
});
