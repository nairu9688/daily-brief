import { describe, expect, it } from 'vitest';
import { fetchAsDataUri, MAX_IMAGE_BYTES } from '../../render/images';
import { fakeFetch } from './fake-fetch';

const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0]);
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a]);
const WEBP = new Uint8Array([0x52, 0x49, 0x46, 0x46, 1, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]);
const b64 = (b: Uint8Array) => Buffer.from(b).toString('base64');

describe('fetchAsDataUri', () => {
  it('encode une image en data URI', async () => {
    const { fetch } = fakeFetch({ 'https://upload.wikimedia.org/': { body: JPEG, type: 'image/jpeg' } });
    expect(await fetchAsDataUri('https://upload.wikimedia.org/a.jpg', fetch)).toBe(`data:image/jpeg;base64,${b64(JPEG)}`);
  });

  it('renvoie null sur une erreur, un type non image, un corps vide ou trop lourd', async () => {
    const { fetch } = fakeFetch({
      'https://upload.wikimedia.org/404': { status: 404 },
      'https://upload.wikimedia.org/html': { body: new Uint8Array([1]), type: 'text/html' },
      'https://upload.wikimedia.org/empty': { type: 'image/png' },
      'https://upload.wikimedia.org/big': { body: new Uint8Array(MAX_IMAGE_BYTES + 1), type: 'image/png' },
      'https://upload.wikimedia.org/throw': () => {
        throw new Error('réseau');
      },
    });
    for (const u of ['404', 'html', 'empty', 'big', 'throw']) expect(await fetchAsDataUri(`https://upload.wikimedia.org/${u}`, fetch), u).toBeNull();
  });

  it('refuse les types non raster (svg, gif)', async () => {
    const { fetch } = fakeFetch({
      'https://upload.wikimedia.org/svg': { body: new Uint8Array([1, 2, 3]), type: 'image/svg+xml' },
      'https://upload.wikimedia.org/gif': { body: new Uint8Array([1, 2, 3]), type: 'image/gif' },
    });
    expect(await fetchAsDataUri('https://upload.wikimedia.org/svg', fetch)).toBeNull();
    expect(await fetchAsDataUri('https://upload.wikimedia.org/gif', fetch)).toBeNull();
  });

  it('normalise l’en-tête content-type (paramètres, casse)', async () => {
    const { fetch } = fakeFetch({ 'https://upload.wikimedia.org/': { body: JPEG, type: 'image/jpeg; charset=binary' } });
    expect(await fetchAsDataUri('https://upload.wikimedia.org/a.jpg', fetch)).toBe(`data:image/jpeg;base64,${b64(JPEG)}`);
  });

  it('renvoie null après le délai réseau', async () => {
    const { fetch } = fakeFetch({ 'https://upload.wikimedia.org/': { hang: true } });
    expect(await fetchAsDataUri('https://upload.wikimedia.org/slow.jpg', fetch, 20)).toBeNull();
  });

  it('refuse sur content-length trop grand sans lire le corps', async () => {
    let read = false;
    const { fetch } = fakeFetch({ 'https://upload.wikimedia.org/': { body: new Uint8Array([1]), type: 'image/png', length: String(MAX_IMAGE_BYTES + 1) } });
    const spy: typeof fetch = async (u, i) => {
      const res = await fetch(u, i);
      return { ...res, arrayBuffer: async () => ((read = true), res.arrayBuffer()) };
    };
    expect(await fetchAsDataUri('https://upload.wikimedia.org/big', spy)).toBeNull();
    expect(read).toBe(false);
  });

  it('refuse une réponse sans content-type', async () => {
    const { fetch } = fakeFetch({ 'https://upload.wikimedia.org/': { body: new Uint8Array([1, 2, 3]), type: null } });
    expect(await fetchAsDataUri('https://upload.wikimedia.org/a', fetch)).toBeNull();
  });

  it('ne télécharge que https://upload.wikimedia.org et https://thumb.wikimedia.org', async () => {
    const { fetch, calls } = fakeFetch({ 'http': { body: JPEG, type: 'image/jpeg' } });
    for (const u of ['http://169.254.169.254/x.jpg', 'https://evil.example/x.jpg', 'http://upload.wikimedia.org/x.jpg', 'https://images.pexels.com/x.jpg', 'https://upload.wikimedia.org:444/x.jpg', 'https://upload.wikimedia.org.evil.example/x.jpg', 'pas une url']) {
      expect(await fetchAsDataUri(u, fetch), u).toBeNull();
    }
    expect(calls).toHaveLength(0);
    expect(await fetchAsDataUri('https://upload.wikimedia.org/photos/1/x.jpg', fetch)).toBe(`data:image/jpeg;base64,${b64(JPEG)}`);
    expect(await fetchAsDataUri('https://thumb.wikimedia.org/wikipedia/commons/thumb/a/ab/X.jpg/1920px-X.jpg', fetch)).toBe(`data:image/jpeg;base64,${b64(JPEG)}`);
  });

  it('refuse une image dont les premiers octets ne correspondent pas au type annoncé', async () => {
    const { fetch } = fakeFetch({
      'https://upload.wikimedia.org/fake.jpg': { body: new Uint8Array([1, 2, 3, 4]), type: 'image/jpeg' },
      'https://upload.wikimedia.org/html.png': { body: new TextEncoder().encode('<html><script>x</script>'), type: 'image/png' },
      'https://upload.wikimedia.org/png-as-jpeg.jpg': { body: PNG, type: 'image/jpeg' },
      'https://upload.wikimedia.org/riff.webp': { body: new Uint8Array([0x52, 0x49, 0x46, 0x46, 1, 0, 0, 0, 0x41, 0x56, 0x49, 0x20]), type: 'image/webp' },
      'https://upload.wikimedia.org/ok.png': { body: PNG, type: 'image/png' },
      'https://upload.wikimedia.org/ok.webp': { body: WEBP, type: 'image/webp' },
    });
    for (const u of ['fake.jpg', 'html.png', 'png-as-jpeg.jpg', 'riff.webp']) expect(await fetchAsDataUri(`https://upload.wikimedia.org/${u}`, fetch), u).toBeNull();
    expect(await fetchAsDataUri('https://upload.wikimedia.org/ok.png', fetch)).toBe(`data:image/png;base64,${b64(PNG)}`);
    expect(await fetchAsDataUri('https://upload.wikimedia.org/ok.webp', fetch)).toBe(`data:image/webp;base64,${b64(WEBP)}`);
  });

  it('ne suit pas de redirection et refuse une réponse venue d’un autre hôte', async () => {
    const { fetch, calls } = fakeFetch({ 'https://upload.wikimedia.org/': { body: JPEG, type: 'image/jpeg', finalUrl: 'http://169.254.169.254/x.jpg' } });
    expect(await fetchAsDataUri('https://upload.wikimedia.org/a.jpg', fetch)).toBeNull();
    expect(calls[0].redirect).toBe('error');
  });

  it('envoie l’agent générique exigé par Wikimedia', async () => {
    const { fetch, calls } = fakeFetch({ 'https://upload.wikimedia.org/': { body: JPEG, type: 'image/jpeg' } });
    await fetchAsDataUri('https://upload.wikimedia.org/a.jpg', fetch);
    expect(calls[0].headers).toMatchObject({ 'User-Agent': 'DailyBrief/1.0 (personal news digest)' });
  });
});
