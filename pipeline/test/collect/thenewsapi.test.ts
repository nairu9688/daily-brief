import { describe, expect, it } from 'vitest';
import { RequestBudget } from '../../collect/budget';
import type { BudgetBucket, CollectConfig } from '../../collect/config';
import { collectTheNewsApi, parseNews, similarNews, THENEWSAPI_BASE, topNews } from '../../collect/thenewsapi';
import { apiFixture, NOW, testContext } from './source-context';
import { fakeHttp, type Reply } from './fake-http';

const TOKEN = 'tna-SECRET-123';
const budgetOf = (c: CollectConfig) => {
  const { total, ...limits } = c.thenewsapi.budget;
  return new RequestBudget<BudgetBucket>(limits, total);
};

/** Réponse pleine (3 articles distincts) quelle que soit la requête. */
const fullPage = (url: string): Reply => {
  const u = new URL(url);
  const lang = u.searchParams.get('language');
  const tag = `${u.pathname.split('/').pop()}-${u.searchParams.get('categories') ?? 'sim'}-${u.searchParams.get('page') ?? 1}`;
  return {
    json: {
      meta: { found: 99, returned: 3, limit: 3, page: 1 },
      data: [0, 1, 2].map((i) => ({
        uuid: `${lang}-${tag}-${i}`,
        title: `Titre ${lang} ${tag} ${i}`,
        description: null,
        url: `https://${i === 0 ? 'lemonde.fr' : 'fr.euronews.com'}/${lang}/${tag}/${i}`,
        language: lang,
        published_at: '2026-11-06T03:00:00Z',
        source: 'x',
      })),
    },
  };
};

describe('client TheNewsAPI', () => {
  it('appelle /top avec les paramètres de la spec et ignore un article mal formé', async () => {
    const { fetch, calls } = fakeHttp({ [`${THENEWSAPI_BASE}/top`]: { json: apiFixture('thenewsapi-top.json') } });
    const items = await topNews(
      { language: 'fr', locale: 'fr', categories: 'politics', search: 'a | b', publishedAfter: new Date('2026-11-05T04:13:00Z'), limit: 3, page: 2 },
      { token: TOKEN, fetch, timeoutMs: 1000 },
    );
    expect(items.map((i) => i.uuid)).toEqual(['6f1c0a52-3b7e-4d0e-9a51-2c8e7d4f1a01', '0b7d93a4-1f25-4c8e-8e6a-55d2b0c9e302']);
    const q = new URL(calls[0].url).searchParams;
    expect(Object.fromEntries(q)).toEqual({
      api_token: TOKEN,
      language: 'fr',
      limit: '3',
      locale: 'fr',
      categories: 'politics',
      search: 'a | b',
      published_after: '2026-11-05T04:13:00',
      page: '2',
    });
  });

  it('appelle /similar/{uuid}', async () => {
    const { fetch, calls } = fakeHttp({ [`${THENEWSAPI_BASE}/similar/`]: { json: apiFixture('thenewsapi-similar.json') } });
    const items = await similarNews('a/b', { language: 'fr', publishedAfter: NOW, limit: 3 }, { token: TOKEN, fetch, timeoutMs: 1000 });
    expect(items).toHaveLength(2);
    expect(calls[0].url).toMatch(/\/similar\/a%2Fb\?/);
  });

  it('lève sur une réponse sans tableau data', () => {
    expect(() => parseNews({ error: { code: 'invalid_api_token' } })).toThrow();
  });
});

describe('collectTheNewsApi', () => {
  it('ne dépasse jamais le budget : 25 FR, 20 EN, 20 ES, 25 similar, 90 au total', async () => {
    const { fetch, calls } = fakeHttp({ [THENEWSAPI_BASE]: fullPage });
    const ctx = testContext(fetch);
    const budget = budgetOf(ctx.config);
    const run = await collectTheNewsApi(ctx, TOKEN, budget);
    expect(calls).toHaveLength(90);
    expect(run.requests).toBe(90);
    expect(budget.usage()).toEqual({ fr: 25, en: 20, es: 20, similar: 25 });
    const langs = (lang: string) => calls.filter((c) => c.url.includes('/top?') && new URL(c.url).searchParams.get('language') === lang).length;
    expect([langs('fr'), langs('en'), langs('es')]).toEqual([25, 20, 20]);
  });

  it('parcourt les 9 rubriques en page 1 avant de passer en page 2', async () => {
    const { fetch, calls } = fakeHttp({ [THENEWSAPI_BASE]: fullPage });
    await collectTheNewsApi(testContext(fetch), TOKEN, budgetOf(testContext(fetch).config));
    const fr = calls.filter((c) => new URL(c.url).searchParams.get('language') === 'fr' && c.url.includes('/top?')).map((c) => new URL(c.url).searchParams);
    expect(new Set(fr.slice(0, 9).map((q) => q.get('categories') + '|' + q.get('search'))).size).toBe(9);
    expect(fr.slice(0, 9).every((q) => q.get('page') === null)).toBe(true);
    expect(fr[9].get('page')).toBe('2');
    expect(fr[0].get('locale')).toBe('fr');
  });

  it('abandonne une rubrique épuisée (moins de 3 résultats) sans gaspiller le budget', async () => {
    const { fetch, calls } = fakeHttp({ [`${THENEWSAPI_BASE}/top`]: { json: { data: [] } }, [`${THENEWSAPI_BASE}/similar/`]: { json: { data: [] } } });
    const run = await collectTheNewsApi(testContext(fetch), TOKEN, budgetOf(testContext(fetch).config));
    expect(calls).toHaveLength(27);
    expect(run.candidates).toEqual([]);
  });

  it('se coupe au premier 402 (quota) sans autre appel, sans jeton dans les erreurs', async () => {
    const { fetch, calls } = fakeHttp({ [THENEWSAPI_BASE]: { status: 402, json: { error: { code: 'usage_limit_reached' } } } });
    const run = await collectTheNewsApi(testContext(fetch), TOKEN, budgetOf(testContext(fetch).config));
    expect(calls).toHaveLength(1);
    expect(run.stoppedBy).toBe('HTTP 402');
    expect(JSON.stringify(run.errors)).not.toContain(TOKEN);
  });

  it('se coupe sur un délai dépassé au lieu de rester bloquée', async () => {
    const { fetch, calls } = fakeHttp({ [THENEWSAPI_BASE]: { hang: true } });
    const ctx = testContext(fetch, (c) => (c.thenewsapi.timeoutMs = 20));
    const run = await collectTheNewsApi(ctx, TOKEN, budgetOf(ctx.config));
    expect(calls).toHaveLength(1);
    expect(run.stoppedBy).toBe('délai dépassé');
  });

  it('une erreur 500 n’arrête que la rubrique concernée', async () => {
    let n = 0;
    const { fetch } = fakeHttp({ [THENEWSAPI_BASE]: (url) => (++n === 1 ? { status: 500, json: {} } : fullPage(url)) });
    const run = await collectTheNewsApi(testContext(fetch), TOKEN, budgetOf(testContext(fetch).config));
    expect(run.errors).toHaveLength(1);
    expect(run.errors[0]).toMatch(/^top fr\/pol p1 : HTTP 500/);
    expect(run.stoppedBy).toBeNull();
    expect(run.candidates.length).toBeGreaterThan(100);
  });

  it('relie les résultats de /similar à leur graine, domaines full d’abord', async () => {
    const { fetch, calls } = fakeHttp({
      [`${THENEWSAPI_BASE}/top`]: (url) => (url.includes('language=fr') && !url.includes('page=') && url.includes('categories=politics&') ? { json: apiFixture('thenewsapi-top.json') } : { json: { data: [] } }),
      [`${THENEWSAPI_BASE}/similar/`]: { json: apiFixture('thenewsapi-similar.json') },
    });
    const run = await collectTheNewsApi(testContext(fetch), TOKEN, budgetOf(testContext(fetch).config));
    const sims = calls.filter((c) => c.url.includes('/similar/'));
    expect(sims).toHaveLength(2);
    expect(sims[0].url).toContain('/similar/0b7d93a4-1f25-4c8e-8e6a-55d2b0c9e302?');
    const euronews = run.candidates.find((c) => c.article.url.includes('euronews'))!;
    const linked = run.candidates.filter((c) => c.seed === euronews.article.id).map((c) => c.article.outlet);
    expect(linked).toEqual(['sudradio.fr', 'lefigaro.fr']);
    expect(run.candidates.every((c) => c.article.text === null && c.article.origin === 'thenewsapi')).toBe(true);
  });
});

describe('réponses bornées', () => {
  const big = (n: number) => ({ data: Array.from({ length: n }, (_, i) => ({ uuid: `u${i}`, title: `T${i}`, url: `https://lemonde.fr/${i}` })) });

  it('coupe une réponse de 50 000 articles à limit', async () => {
    expect(parseNews(big(50_000), 3)).toHaveLength(3);
    const { fetch } = fakeHttp({ [`${THENEWSAPI_BASE}/top`]: { json: big(50_000) } });
    const items = await topNews({ language: 'fr', limit: 3 }, { token: TOKEN, fetch, timeoutMs: 1000 });
    expect(items).toHaveLength(3);
  });

  it('un corps trop lourd échoue sans être lu en entier', async () => {
    const { fetch } = fakeHttp({ [`${THENEWSAPI_BASE}/top`]: { json: big(1), headers: { 'content-length': '99999999' } } });
    await expect(topNews({ language: 'fr', limit: 3 }, { token: TOKEN, fetch, timeoutMs: 1000 })).rejects.toThrow(/corps trop lourd/);
  });

  it('la pagination se fonde sur le nombre brut d’articles, pas sur les valides', async () => {
    const page = (url: string): Reply => {
      const page = new URL(url).searchParams.get('page');
      if (page) return { json: { data: [] } };
      return { json: { data: [{ uuid: 'a', title: 'A', url: 'https://lemonde.fr/a' }, { nope: 1 }, { nope: 2 }] } };
    };
    const { fetch, calls } = fakeHttp({ [THENEWSAPI_BASE]: page });
    await collectTheNewsApi(testContext(fetch), TOKEN, budgetOf(testContext(fetch).config));
    // 3 articles bruts (dont 2 mal formés) : la page 1 est « pleine », la page 2 est donc demandée.
    expect(calls.some((c) => new URL(c.url).searchParams.get('page') === '2')).toBe(true);
  });
});

describe('réponses illisibles', () => {
  it('du HTML au lieu de JSON : « réponse non JSON », sans fragment du corps, et coupure après 3 échecs', async () => {
    const { fetch, calls } = fakeHttp({ [THENEWSAPI_BASE]: { body: '<html>SECRET-FRAGMENT</html>' } });
    const ctx = testContext(fetch);
    const budget = budgetOf(ctx.config);
    const run = await collectTheNewsApi(ctx, TOKEN, budget);
    expect(calls).toHaveLength(3);
    expect(budget.usage()).toEqual({ fr: 3, en: 0, es: 0, similar: 0 });
    expect(run.stoppedBy).toBe('source coupée après 3 échecs consécutifs');
    expect(run.errors[0]).toMatch(/^top fr\/pol p1 : réponse non JSON$/);
    expect(JSON.stringify(run)).not.toContain('SECRET-FRAGMENT');
  });

  it('une réponse JSON de forme inattendue est résumée', async () => {
    const { fetch } = fakeHttp({ [THENEWSAPI_BASE]: { json: { error: { code: 'x' } } } });
    const run = await collectTheNewsApi(testContext(fetch), TOKEN, budgetOf(testContext(fetch).config));
    expect(run.errors[0]).toMatch(/: réponse inattendue \(1 champs invalides\)$/);
  });
});
