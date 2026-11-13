import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { checkRealtime, describeRealtime } from '../../collect/realtime';
import { THENEWSAPI_BASE } from '../../collect/thenewsapi';
import { runCli } from '../run-cli';
import { fakeHttp, type Reply } from './fake-http';

const TOKEN = 'tna-SECRET-123';
const NOW = new Date('2026-11-06T10:00:00Z');

/** Réponse /top dont l'article le plus récent a `ages[lang]` minutes (null : aucun article). */
function top(ages: Record<string, number | null>) {
  return (url: string): Reply => {
    const lang = new URL(url).searchParams.get('language')!;
    const age = ages[lang];
    if (age === null) return { json: { meta: { found: 0, returned: 0, limit: 3, page: 1 }, data: [] } };
    const at = (m: number) => new Date(NOW.getTime() - m * 60_000).toISOString().replace('Z', '000Z');
    return {
      json: {
        meta: { found: 50, returned: 2, limit: 3, page: 1 },
        data: [
          { uuid: `${lang}-1`, title: 'Ancien', url: `https://ex.com/${lang}/1`, language: lang, published_at: at(age + 300), source: 'ex.com' },
          { uuid: `${lang}-2`, title: 'Récent', url: `https://ex.com/${lang}/2`, language: lang, published_at: at(age), source: 'ex.com' },
        ],
      },
    };
  };
}

describe('vérification §16 : TheNewsAPI en temps réel', () => {
  it('un appel /top par langue, sans published_after ; trois langues fraîches : TheNewsAPI reste principale', async () => {
    const { fetch, calls } = fakeHttp({ [`${THENEWSAPI_BASE}/top`]: top({ fr: 12, en: 3, es: 120 }) });
    const r = await checkRealtime({ token: TOKEN, fetch, now: NOW });
    expect(calls.map((c) => Object.fromEntries(new URL(c.url).searchParams))).toEqual(
      ['fr', 'en', 'es'].map((language) => ({ api_token: TOKEN, language, limit: '3' })),
    );
    expect(r.perLang.fr).toEqual({ newest: '2026-11-06T09:48:00.000Z', ageMinutes: 12, articles: 2, error: null });
    expect(r.perLang.es.ageMinutes).toBe(120);
    expect(r).toMatchObject({ verdict: 'thenewsapi', requests: 3, maxAgeMinutes: 120, checkedAt: '2026-11-06T10:00:00.000Z' });
    expect(describeRealtime(r, 'thenewsapi')).toEqual([
      'FR : article le plus récent publié il y a 12 min (2026-11-06T09:48:00.000Z)',
      'EN : article le plus récent publié il y a 3 min (2026-11-06T09:57:00.000Z)',
      'ES : article le plus récent publié il y a 120 min (2026-11-06T08:00:00.000Z)',
      'Verdict : TheNewsAPI est en temps réel (au plus 120 min dans les trois langues).',
      'Requêtes TheNewsAPI utilisées : 3 (comptées dans le quota du jour, que brief:collect lit dans out/thenewsapi-usage.json).',
    ]);
  });

  it('plus de 2 h ou aucun article dans une langue : Exa doit devenir principale', async () => {
    const late = await checkRealtime({ token: TOKEN, fetch: fakeHttp({ [`${THENEWSAPI_BASE}/top`]: top({ fr: 5, en: 121, es: 5 }) }).fetch, now: NOW });
    expect(late.verdict).toBe('exa');
    const lines = describeRealtime(late, 'thenewsapi');
    expect(lines).toContain('À faire : passer "primary": "exa" dans pipeline/config/collect.json.');
    const empty = await checkRealtime({ token: TOKEN, fetch: fakeHttp({ [`${THENEWSAPI_BASE}/top`]: top({ fr: 5, en: 5, es: null }) }).fetch, now: NOW });
    expect(empty.verdict).toBe('exa');
    expect(describeRealtime(empty, 'exa')[2]).toBe('ES : aucun article daté (0 renvoyés)');
    expect(describeRealtime(empty, 'exa')).not.toContain('À faire : passer "primary": "exa" dans pipeline/config/collect.json.');
  });

  it('clé refusée : arrêt au premier appel, verdict inconnu, aucun secret', async () => {
    const { fetch, calls } = fakeHttp({ [`${THENEWSAPI_BASE}/top`]: { status: 401, json: { error: { code: 'invalid_api_token' } } } });
    const r = await checkRealtime({ token: TOKEN, fetch, now: NOW });
    expect(calls).toHaveLength(1);
    expect(r.verdict).toBe('unknown');
    expect(r.perLang.fr.error).toBe('HTTP 401 (https://api.thenewsapi.com/v1/news/top?api_token=***&language=fr&limit=3)');
    expect(r.perLang.es.error).toBe('non vérifié (HTTP 401)');
    expect(JSON.stringify(r) + describeRealtime(r, 'thenewsapi').join('\n')).not.toContain(TOKEN);
    expect(describeRealtime(r, 'thenewsapi')).toContain('Verdict : vérification impossible, configuration inchangée. Relance plus tard.');
  });

  it('ne reste pas bloquée : délai dépassé, puis arrêt', async () => {
    const { fetch, calls } = fakeHttp({ [`${THENEWSAPI_BASE}/top`]: { hang: true } });
    const r = await checkRealtime({ token: TOKEN, fetch, now: NOW, timeoutMs: 20 });
    expect(calls).toHaveLength(1);
    expect(r.verdict).toBe('unknown');
    expect(r.perLang.en.error).toBe('non vérifié (délai dépassé)');
  });

  it('une erreur réseau qui cite le jeton est masquée ; une langue en retard l’emporte sur une erreur', async () => {
    let n = 0;
    const route = (url: string): Reply => (++n === 1 ? { error: new Error(`ECONNRESET ${url}`) } : top({ en: 500, es: 1 })(url));
    const r = await checkRealtime({ token: TOKEN, fetch: fakeHttp({ [`${THENEWSAPI_BASE}/top`]: route }).fetch, now: NOW });
    expect(r.perLang.fr.error).not.toContain(TOKEN);
    expect(r.perLang.fr.error).toContain('api_token=***');
    expect(r.requests).toBe(3);
    expect(r.verdict).toBe('exa');
  });
});

describe('vérification §16 : dates, millisecondes et registre', () => {
  const at = (ms: number) => new Date(NOW.getTime() + ms).toISOString();
  const withDates = (dates: (string | null)[]) => (url: string): Reply => ({
    json: { meta: { found: 1, returned: 1, limit: 3, page: 1 }, data: dates.filter(Boolean).map((d, i) => ({ uuid: `u${i}-${url.length}`, title: 'T', url: `https://ex.com/${i}${url.length}`, language: 'fr', published_at: d, source: 'ex.com' })) },
  });

  it('ignore une date de plus de 5 min dans le futur, garde celle de moins de 5 min (âge 0)', async () => {
    const r = await checkRealtime({ token: TOKEN, fetch: fakeHttp({ [`${THENEWSAPI_BASE}/top`]: withDates([at(-3_600_000), at(60 * 60_000)]) }).fetch, now: NOW });
    expect(r.perLang.fr.newest).toBe(at(-3_600_000));
    const near = await checkRealtime({ token: TOKEN, fetch: fakeHttp({ [`${THENEWSAPI_BASE}/top`]: withDates([at(-3_600_000), at(4 * 60_000)]) }).fetch, now: NOW });
    expect(near.perLang.fr.ageMinutes).toBe(0);
  });

  it('120 min 54 s est en retard (comparaison en millisecondes)', async () => {
    const r = await checkRealtime({ token: TOKEN, fetch: fakeHttp({ [`${THENEWSAPI_BASE}/top`]: withDates([at(-(120 * 60_000 + 54_000))]) }).fetch, now: NOW });
    expect(r.perLang.fr.ageMinutes).toBe(120);
    expect(r.verdict).toBe('exa');
  });

  it('inscrit ses requêtes au registre quotidien et refuse au-delà de 100', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'rt-'));
    const ledgerPath = join(dir, 'thenewsapi-usage.json');
    writeFileSync(ledgerPath, JSON.stringify({ day: '2026-11-06', used: 40 }));
    const ok = fakeHttp({ [`${THENEWSAPI_BASE}/top`]: top({ fr: 1, en: 1, es: 1 }) });
    const r = await checkRealtime({ token: TOKEN, fetch: ok.fetch, now: NOW, ledgerPath });
    expect(r.verdict).toBe('thenewsapi');
    expect(JSON.parse(readFileSync(ledgerPath, 'utf8'))).toEqual({ day: '2026-11-06', used: 43 });
    writeFileSync(ledgerPath, JSON.stringify({ day: '2026-11-06', used: 98 }));
    const refused = fakeHttp({ [`${THENEWSAPI_BASE}/top`]: top({ fr: 1, en: 1, es: 1 }) });
    const r2 = await checkRealtime({ token: TOKEN, fetch: refused.fetch, now: NOW, ledgerPath });
    expect(refused.calls).toHaveLength(0);
    expect(r2).toMatchObject({ verdict: 'unknown', requests: 0 });
    expect(describeRealtime(r2, 'thenewsapi').join('\n')).toContain('marge quotidienne');
    expect(JSON.parse(readFileSync(ledgerPath, 'utf8')).used).toBe(98);
  });
  it('un registre impossible à écrire : aucune requête envoyée ni comptée', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'rt-'));
    const ledgerPath = join(dir, 'thenewsapi-usage.json');
    mkdirSync(`${ledgerPath}.tmp`);
    const net = fakeHttp({ [`${THENEWSAPI_BASE}/top`]: top({ fr: 1, en: 1, es: 1 }) });
    const r = await checkRealtime({ token: TOKEN, fetch: net.fetch, now: NOW, ledgerPath });
    expect(net.calls).toHaveLength(0);
    expect(r).toMatchObject({ requests: 0, verdict: 'unknown' });
    expect(r.perLang.fr.error).toContain('registre d’usage non écrit');
    expect(r.perLang.es.error).toContain('registre d’usage non écrit');
  });

  it('un registre illisible du jour : le refus le dit, au lieu d’un compte inventé', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'rt-'));
    const ledgerPath = join(dir, 'thenewsapi-usage.json');
    writeFileSync(ledgerPath, '{tronqué');
    const r = await checkRealtime({ token: TOKEN, fetch: fakeHttp({}).fetch, now: NOW, ledgerPath });
    expect(r.verdict).toBe('unknown');
    expect(r.refused).toMatch(/^registre illisible : /);
    expect(r.refused).not.toContain('déjà utilisées');
  });
});

describe('CLI check:thenewsapi', () => {
  it('sans clé : code 2, aucun appel réseau', () => {
    const r = runCli('pipeline/collect/check-thenewsapi.ts', []);
    expect(r.status).toBe(2);
    expect(r.stdout).toBe('check:thenewsapi (découverte principale actuelle : thenewsapi)\nTHENEWSAPI_KEY absente (environnement ou .env) : vérification impossible.\n');
  }, 30_000);

  it('--out : le registre est celui de brief:collect (out/thenewsapi-usage.json) et reçoit les 3 requêtes', () => {
    const r = runCli('pipeline/collect/check-thenewsapi.ts', ['--out', 'sortie'], { THENEWSAPI_KEY: 'tna-SECRET-123' }, { preload: 'pipeline/test/fake-fetch-preload.ts' });
    expect(r.status, r.stdout + r.stderr).toBe(1);
    expect(JSON.parse(readFileSync(join(r.cwd, 'sortie', 'thenewsapi-usage.json'), 'utf8')).used).toBe(3);
    expect(r.stdout).not.toContain('tna-SECRET-123');
  }, 30_000);
});
