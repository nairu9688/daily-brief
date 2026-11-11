import { describe, expect, it } from 'vitest';
import { collectWebz, WEBZ_LITE, webzLang } from '../../collect/webz';
import { apiFixture, testContext } from './source-context';
import { fakeHttp } from './fake-http';

const TOKEN = 'WEBZ-SECRET-789';

describe('collectWebz', () => {
  it('appelle News API Lite avec le jeton et la requête de la langue', async () => {
    const { fetch, calls } = fakeHttp({ [WEBZ_LITE]: { json: { posts: [] } } });
    await collectWebz(testContext(fetch), TOKEN, ['es']);
    const q = new URL(calls[0].url).searchParams;
    expect(q.get('token')).toBe(TOKEN);
    expect(q.get('q')).toBe('language:spanish thread.country:ES');
  });

  it('R1 : garde le texte d’eldiario.es (full), écarte celui d’elpais.com (meta), ignore les posts hors fenêtre ou mal formés', async () => {
    const { fetch } = fakeHttp({ [WEBZ_LITE]: { json: apiFixture('webz-news-lite.json') } });
    const run = await collectWebz(testContext(fetch), TOKEN, ['es']);
    expect(run.candidates.map((c) => c.article.outlet)).toEqual(['eldiario.es', 'elpais.com']);
    const [eldiario, elpais] = run.candidates.map((c) => c.article);
    expect(eldiario).toMatchObject({ lang: 'es', origin: 'webz', publishedAt: '2026-11-06T04:10:00.000Z', description: null });
    expect(eldiario.text).toBe('El pleno del Congreso aprobó este jueves los Presupuestos Generales del Estado.\nLa votación salió adelante por un estrecho margen.');
    expect(elpais.text).toBeNull();
    expect(elpais.description).toBeNull();
    expect(run.discardedTexts).toBe(1);
  });

  it('plafonne les requêtes et se coupe sur un 429 sans jeton dans les erreurs', async () => {
    const ok = fakeHttp({ [WEBZ_LITE]: { json: { posts: [] } } });
    await collectWebz(testContext(ok.fetch, (c) => (c.webz.maxRequests = 2)), TOKEN, ['fr', 'en', 'es']);
    expect(ok.calls).toHaveLength(2);
    const ko = fakeHttp({ [WEBZ_LITE]: { status: 429, json: {} } });
    const run = await collectWebz(testContext(ko.fetch), TOKEN, ['fr', 'en', 'es']);
    expect(ko.calls).toHaveLength(1);
    expect(run.stoppedBy).toBe('HTTP 429');
    expect(run.errors[0]).toContain('token=***');
    expect(JSON.stringify(run)).not.toContain(TOKEN);
  });

  it('langue : nom ou code ISO, langue de la requête si absente, article écarté si autre langue', async () => {
    expect([webzLang('Spanish', 'fr'), webzLang('en', 'fr'), webzLang(null, 'es'), webzLang('german', 'fr')]).toEqual(['es', 'en', 'es', 'german']);
    const post = (url: string, language?: string) => ({ url, title: `Titre ${url}`, published: '2026-11-06T04:00:00Z', ...(language ? { language } : {}) });
    const { fetch } = fakeHttp({
      [WEBZ_LITE]: { json: { posts: [post('https://eldiario.es/a', 'spanish'), post('https://eldiario.es/b'), post('https://dw.com/c', 'german')] } },
    });
    const run = await collectWebz(testContext(fetch), TOKEN, ['es']);
    expect(run.candidates.map((c) => [c.article.url, c.article.lang])).toEqual([
      ['https://eldiario.es/a', 'es'],
      ['https://eldiario.es/b', 'es'],
    ]);
  });

  it('une réponse sans tableau posts est une erreur, pas un plantage', async () => {
    const { fetch } = fakeHttp({ [WEBZ_LITE]: { json: { message: 'Bad query' } } });
    const run = await collectWebz(testContext(fetch), TOKEN, ['fr', 'en']);
    expect(run.errors).toHaveLength(2);
    expect(run.stoppedBy).toBeNull();
  });
});
