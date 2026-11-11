import { describe, expect, it } from 'vitest';
import { BodyError, decodeBody, fetchJson, HttpError, readCapped } from '../../collect/http';
import { redactText, redactUrl } from '../../collect/redact';
import { fakeHttp } from './fake-http';

describe('masquage des secrets', () => {
  it('masque les jetons dans les URL (TheNewsAPI, Webz)', () => {
    expect(redactUrl('https://api.thenewsapi.com/v1/news/top?api_token=SECRET123&language=fr')).toBe(
      'https://api.thenewsapi.com/v1/news/top?api_token=***&language=fr',
    );
    expect(redactUrl('https://api.webz.io/newsApiLite?q=x&token=abc-def')).toBe('https://api.webz.io/newsApiLite?q=x&token=***');
  });

  it('masque un secret connu partout, même encodé', () => {
    const msg = redactText('échec : clé k3y/+sec refusée (k3y%2F%2Bsec)', ['k3y/+sec', undefined, '']);
    expect(msg).toBe('échec : clé *** refusée (***)');
  });
});

describe('HTTP', () => {
  it('fetchJson lève HttpError sans le jeton dans le message', async () => {
    const { fetch } = fakeHttp({ 'https://api.x/': { status: 429, json: {} } });
    const err = await fetchJson(fetch, 'https://api.x/top?api_token=SECRET', { timeoutMs: 1000 }).then(() => null, (e: HttpError) => e);
    expect(err).toBeInstanceOf(HttpError);
    expect(err?.status).toBe(429);
    expect(err?.message).not.toContain('SECRET');
  });

  it('fetchJson interrompt une réponse qui ne vient pas', async () => {
    const { fetch } = fakeHttp({ 'https://api.x/': { hang: true } });
    const err = await fetchJson(fetch, 'https://api.x/top', { timeoutMs: 20 }).then(() => null, (e: Error) => e);
    expect(err?.name).toBe('TimeoutError');
  });

  it('readCapped refuse un corps trop lourd, déclaré ou réel', async () => {
    const { fetch } = fakeHttp({
      'https://a/declared': { body: 'x', headers: { 'content-length': '999999' } },
      'https://a/real': { body: 'x'.repeat(50) },
    });
    await expect(readCapped(await fetch('https://a/declared'), 10)).rejects.toBeInstanceOf(BodyError);
    await expect(readCapped(await fetch('https://a/real'), 10)).rejects.toBeInstanceOf(BodyError);
    expect((await readCapped(await fetch('https://a/real'), 100)).length).toBe(50);
  });

  it('readCapped arrête un flux sans fin dès la limite dépassée', async () => {
    let pulled = 0;
    const endless = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulled++;
        controller.enqueue(new Uint8Array(1024));
      },
    });
    const res = { ok: true, status: 200, headers: { get: () => null }, json: async () => null, arrayBuffer: async () => new ArrayBuffer(0), body: endless };
    await expect(readCapped(res, 10_000)).rejects.toThrow('corps trop lourd (plus de 10000 octets)');
    expect(pulled).toBeLessThan(20);
    const small = new Response('café').body;
    expect((await readCapped({ ...res, body: small }, 100)).toString('utf8')).toBe('café');
  });

  it('decodeBody suit le charset annoncé', () => {
    expect(decodeBody(Buffer.from([0x63, 0x61, 0x66, 0xe9]), 'text/html; charset=iso-8859-1')).toBe('café');
    expect(decodeBody(Buffer.from('café'), 'text/html; charset=inconnu')).toBe('café');
  });
});
