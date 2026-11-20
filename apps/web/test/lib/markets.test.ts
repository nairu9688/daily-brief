// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import fixture from '@/lib/markets/fixture-spark.json';
import { direction, formatChange, formatPrice, INSTRUMENTS, parseSpark, SPARK_URL } from '@/lib/markets/parse';

vi.mock('next/cache', () => ({ unstable_cache: (fn: () => unknown) => fn }));
const { fetchQuotes, readCapped, MARKETS_MAX_BYTES } = await import('@/lib/markets');

/** Réponse enregistrée le 2026-11-20 (lib/markets/fixture-spark.json), copiée pour être modifiée. */
const recorded = () => structuredClone(fixture) as { spark: { result: { symbol: string; response: { meta: Record<string, unknown> }[] }[] } };

describe('marchés : analyse de la réponse enregistrée', () => {
  it('lit les neuf instruments dans l’ordre d’affichage, avec cours, variation et heure', () => {
    const q = parseSpark(fixture)!;
    expect(q.map((x) => x.label)).toEqual(['CAC 40', 'Euro Stoxx 50', 'IBEX 35', 'FTSE 100', 'S&P 500', 'Nasdaq', 'Brent', 'EUR/USD', 'Bitcoin']);
    expect(q[0]).toEqual({ symbol: '^FCHI', label: 'CAC 40', digits: 2, price: 7990.64, change: -1.115, time: '2026-11-20T09:13:15.000Z' });
    expect(q.find((x) => x.symbol === 'EURUSD=X')).toMatchObject({ price: 1.0969, digits: 4 });
  });

  it('une seule requête, sans clé, pour tous les instruments', () => {
    expect(SPARK_URL.startsWith('https://query1.finance.yahoo.com/v7/finance/spark?symbols=')).toBe(true);
    expect(SPARK_URL).not.toMatch(/key|token|crumb/i);
    for (const i of INSTRUMENTS) expect(SPARK_URL).toContain(encodeURIComponent(i.symbol));
  });

  it('calcule la variation depuis la clôture précédente si elle manque, ignore un instrument illisible ou absurde', () => {
    const r = recorded();
    const cac = r.spark.result.find((x) => x.symbol === '^FCHI')!.response[0].meta;
    delete cac.regularMarketChangePercent;
    r.spark.result.find((x) => x.symbol === '^IBEX')!.response[0].meta.regularMarketPrice = 'NaN';
    r.spark.result.find((x) => x.symbol === '^FTSE')!.response[0].meta.regularMarketChangePercent = 80;
    r.spark.result.find((x) => x.symbol === '^GSPC')!.response[0].meta.symbol = '^AUTRE';
    const q = parseSpark(r)!;
    expect(q.find((x) => x.symbol === '^FCHI')!.change).toBeCloseTo((7990.64 / 8080.74 - 1) * 100, 6);
    expect(q.map((x) => x.symbol)).not.toContain('^IBEX');
    expect(q.map((x) => x.symbol)).not.toContain('^FTSE');
    expect(q.map((x) => x.symbol)).not.toContain('^GSPC');
  });

  it('null si la forme change ou s’il reste trop peu de cours', () => {
    for (const bad of [null, 'x', {}, { spark: {} }, { spark: { result: 'x' } }, { chart: { result: [] } }]) expect(parseSpark(bad)).toBeNull();
    const r = recorded();
    r.spark.result = r.spark.result.slice(0, 3);
    expect(parseSpark(r)).toBeNull();
  });

  it('formate à la française : espaces, virgule, vrai signe moins', () => {
    expect(formatPrice({ price: 7990.64, digits: 2 })).toBe('7 990,64');
    expect(formatPrice({ price: 61603.41, digits: 0 })).toBe('61 603');
    expect(formatPrice({ price: 1.0969, digits: 4 })).toBe('1,0969');
    expect(formatChange(-1.126)).toBe('−1,13 %');
    expect(formatChange(0.4)).toBe('+0,40 %');
    expect(formatChange(0.001)).toBe('0,00 %');
    expect([direction(-1), direction(0.3), direction(0.001)]).toEqual(['down', 'up', 'flat']);
  });
});

describe('marchés : lecture réseau (fausse, aucun réseau dans les tests)', () => {
  const body = JSON.stringify(fixture);
  const ok = (text: string, headers: Record<string, string> = {}) => new Response(text, { status: 200, headers: { 'content-type': 'application/json', ...headers } });

  it('lit la réponse avec un délai strict, sans suivre de redirection', async () => {
    const f = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => ok(body));
    const q = await fetchQuotes(f as typeof fetch);
    expect(q).toHaveLength(9);
    const [url, init] = f.mock.calls[0];
    expect(url).toBe(SPARK_URL);
    expect(init?.signal).toBeInstanceOf(AbortSignal);
    expect(init?.redirect).toBe('error');
  });

  it('lève une erreur sur un statut HTTP, un JSON invalide ou une réponse illisible', async () => {
    await expect(fetchQuotes((async () => new Response('x', { status: 429 })) as typeof fetch)).rejects.toThrow('HTTP 429');
    await expect(fetchQuotes((async () => ok('<html>')) as typeof fetch)).rejects.toThrow();
    await expect(fetchQuotes((async () => ok('{"spark":{"result":[]}}')) as typeof fetch)).rejects.toThrow('illisible');
  });

  it('refuse une réponse trop grande, annoncée ou non', async () => {
    await expect(readCapped(ok('{}', { 'content-length': String(MARKETS_MAX_BYTES + 1) }), MARKETS_MAX_BYTES)).rejects.toThrow('trop grande');
    await expect(readCapped(ok('x'.repeat(2000)), 1000)).rejects.toThrow('trop grande');
    expect(await readCapped(ok('abc'), 1000)).toBe('abc');
  });
});
