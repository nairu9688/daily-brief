import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { RawArticle } from '@daily-brief/schema';
import { extractText, fetchFullText, fillFullTexts, fullTextTargets, NotFullError } from '../../collect/fulltext';
import { USER_AGENT } from '../../collect/http';
import type { HttpFetch } from '../../collect/http';
import { loadWhitelist } from '../../lib/whitelist';
import { repoPath, WHITELIST_PATH } from '../helpers';
import { fakeHttp } from './fake-http';

const wl = loadWhitelist(WHITELIST_PATH);
const PAGE = readFileSync(repoPath('fixtures/api/article-euronews.html'), 'utf8');
const URL_FULL = 'https://fr.euronews.com/2026/11/06/cop31';
const base = { whitelist: wl, timeoutMs: 1000, maxBytes: 1_000_000, minChars: 200 };

const art = (url: string, text: string | null = null, lang = 'fr'): RawArticle => ({
  id: url,
  url,
  outlet: 'x',
  title: 't',
  description: null,
  lang,
  publishedAt: null,
  origin: 'rss',
  text,
});

describe('extractText', () => {
  it('garde le corps de l’article, un paragraphe par ligne, sans menu, script ni pied de page', () => {
    const text = extractText(PAGE);
    const paras = text.split('\n\n');
    expect(paras).toContain('« Nous ne repartirons pas sans un chiffre », a déclaré la ministre brésilienne de l\'Environnement, Marina Silva, devant la presse à l\'issue de la séance plénière.');
    expect(paras).toContain('Prochaine séance plénière : vendredi matin.');
    expect(text).not.toMatch(/tracking|Newsletter|Mentions légales|Cookies/);
    expect(text).not.toContain('\n\n\n');
  });

  it('renvoie une chaîne vide pour une page sans contenu', () => {
    expect(extractText('<html><body></body></html>')).toBe('');
  });
});

describe('fetchFullText : garde R1', () => {
  it('n’envoie aucune requête pour un domaine meta, feed, inconnu ou non http(s)', async () => {
    const { fetch, calls } = fakeHttp({ 'https://': { body: PAGE } });
    for (const url of ['https://www.lemonde.fr/a', 'https://www.npr.org/a', 'https://inconnu.example/a', 'ftp://fr.euronews.com/a', 'pas une url']) {
      await expect(fetchFullText(url, { ...base, fetch })).rejects.toBeInstanceOf(NotFullError);
    }
    expect(calls).toEqual([]);
  });

  it('suit une redirection vers un domaine full, refuse celle vers un autre domaine sans la suivre', async () => {
    const { fetch, calls } = fakeHttp({
      'https://fr.euronews.com/court': { status: 301, headers: { location: '/2026/11/06/cop31' }, type: null },
      'https://fr.euronews.com/2026/11/06/cop31': { body: PAGE },
      'https://fr.euronews.com/fuite': { status: 302, headers: { location: 'https://www.lemonde.fr/copie' }, type: null },
    });
    expect(await fetchFullText('https://fr.euronews.com/court', { ...base, fetch })).toContain('Belém');
    await expect(fetchFullText('https://fr.euronews.com/fuite', { ...base, fetch })).rejects.toBeInstanceOf(NotFullError);
    expect(calls.map((c) => c.url)).toEqual(['https://fr.euronews.com/court', URL_FULL, 'https://fr.euronews.com/fuite']);
    expect(calls.every((c) => c.redirect === 'manual')).toBe(true);
  });

  it('refuse un type non HTML, un corps trop lourd, un texte trop court et une boucle de redirections', async () => {
    const { fetch } = fakeHttp({
      'https://fr.euronews.com/pdf': { body: '%PDF', type: 'application/pdf' },
      'https://fr.euronews.com/lourd': { body: PAGE, headers: { 'content-length': '5000000' } },
      'https://fr.euronews.com/court-texte': { body: '<html><body><article><p>Bref.</p></article></body></html>' },
      'https://fr.euronews.com/boucle': { status: 302, headers: { location: '/boucle' }, type: null },
    });
    await expect(fetchFullText('https://fr.euronews.com/pdf', { ...base, fetch })).rejects.toThrow('type application/pdf refusé');
    await expect(fetchFullText('https://fr.euronews.com/lourd', { ...base, fetch })).rejects.toThrow('corps trop lourd');
    await expect(fetchFullText('https://fr.euronews.com/court-texte', { ...base, fetch })).rejects.toThrow('texte trop court');
    await expect(fetchFullText('https://fr.euronews.com/boucle', { ...base, fetch })).rejects.toThrow('trop de redirections');
  });
});

describe('fillFullTexts', () => {
  const opts = { ...base, concurrency: 2, maxFetches: 10, deadlineMs: 5000 };

  it('alterne les langues pour partager le plafond entre les éditions', async () => {
    const input = [
      art('https://fr.euronews.com/1'),
      art('https://fr.euronews.com/2'),
      art('https://fr.euronews.com/3'),
      art('https://www.euronews.com/4', null, 'en'),
      art('https://lemonde.fr/5', null, 'en'),
      art('https://es.euronews.com/6', null, 'es'),
      art('https://es.euronews.com/7', null, 'es'),
    ];
    expect(fullTextTargets(input, wl)).toEqual([0, 3, 5, 1, 6, 2]);
    const { fetch, calls } = fakeHttp({ 'https://': { body: PAGE } });
    const { stats } = await fillFullTexts(input, { ...opts, concurrency: 1, maxFetches: 3, fetch });
    expect(calls.map((c) => c.url)).toEqual(['https://fr.euronews.com/1', 'https://www.euronews.com/4', 'https://es.euronews.com/6']);
    expect(calls[0].headers).toMatchObject({ 'user-agent': USER_AGENT });
    expect(stats).toMatchObject({ extracted: 3, skipped: 3 });
  });

  it('ne complète que les articles full sans texte, en gardant l’ordre', async () => {
    const { fetch, calls } = fakeHttp({ 'https://fr.euronews.com/': { body: PAGE }, 'https://sudradio.fr/': { body: PAGE } });
    const input = [art('https://lemonde.fr/a'), art('https://fr.euronews.com/b'), art('https://sudradio.fr/c', 'déjà lu'), art('https://npr.org/d'), art('https://sudradio.fr/e')];
    const { articles, stats } = await fillFullTexts(input, { ...opts, fetch });
    expect(calls.map((c) => c.url)).toEqual(['https://fr.euronews.com/b', 'https://sudradio.fr/e']);
    expect(articles.map((a) => (a.text ? a.text.slice(0, 4) : null))).toEqual([null, 'Les ', 'déjà', null, 'Les ']);
    expect(stats).toMatchObject({ attempted: 2, extracted: 2, failed: 0, skipped: 0 });
    expect(input[1].text).toBeNull();
  });

  it('abandonne un hôte après un 403 et borne le nombre de pages', async () => {
    const { fetch, calls } = fakeHttp({ 'https://fr.euronews.com/': { status: 403, body: '' } });
    const input = ['a', 'b', 'c', 'd', 'e'].map((x) => art(`https://fr.euronews.com/${x}`));
    const { stats } = await fillFullTexts(input, { ...opts, concurrency: 1, maxFetches: 4, fetch });
    expect(calls).toHaveLength(1);
    expect(stats).toMatchObject({ attempted: 1, failed: 1, skipped: 4 });
    expect(stats.errors).toEqual(['https://fr.euronews.com/a : HTTP 403 (https://fr.euronews.com/a)']);
  });

  it('borne la concurrence à 4 et s’arrête à l’échéance globale', async () => {
    let active = 0;
    let peak = 0;
    const inner = fakeHttp({ 'https://fr.euronews.com/': { body: PAGE }, 'https://sudradio.fr/': { hang: true } });
    const fetch: HttpFetch = async (url, init) => {
      active++;
      peak = Math.max(peak, active);
      try {
        await new Promise((r) => setTimeout(r, 5));
        return await inner.fetch(url, init);
      } finally {
        active--;
      }
    };
    const many = Array.from({ length: 12 }, (_, i) => art(`https://fr.euronews.com/${i}`));
    const r = await fillFullTexts(many, { ...opts, maxFetches: 20, concurrency: 4, fetch });
    expect(r.stats.extracted).toBe(12);
    expect(peak).toBe(4);
    const slow = Array.from({ length: 6 }, (_, i) => art(`https://sudradio.fr/${i}`));
    const t0 = Date.now();
    const s = await fillFullTexts(slow, { ...opts, timeoutMs: 10_000, concurrency: 2, deadlineMs: 50, fetch });
    expect(Date.now() - t0).toBeLessThan(2000);
    expect(s.stats.extracted).toBe(0);
    expect(s.stats.attempted + s.stats.skipped).toBe(6);
  });
});
