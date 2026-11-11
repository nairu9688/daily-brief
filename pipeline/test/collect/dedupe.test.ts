import { describe, expect, it } from 'vitest';
import type { RawArticle } from '@daily-brief/schema';
import { articleId } from '../../collect/article';
import { dedupe, jaccard, trigrams } from '../../collect/dedupe';
import type { Candidate } from '../../collect/types';
import { loadWhitelist } from '../../lib/whitelist';
import { WHITELIST_PATH } from '../helpers';

const wl = loadWhitelist(WHITELIST_PATH);

const art = (url: string, title: string, extra: Partial<RawArticle> = {}): Candidate => ({
  article: { id: articleId(url), url, outlet: new URL(url).hostname, title, description: null, lang: 'fr', publishedAt: null, origin: 'thenewsapi', text: null, ...extra },
});

describe('similarité des titres', () => {
  it('Jaccard sur trigrammes, insensible aux accents, à la casse et à la ponctuation', () => {
    const sim = (a: string, b: string) => jaccard(trigrams(a), trigrams(b));
    expect(sim('Budget 2027 : le Sénat adopte la première partie du texte', 'Le Sénat adopte la première partie du budget 2027')).toBeCloseTo(0.873, 3);
    expect(sim('Budget 2027 : le Sénat adopte la première partie du texte', 'Budget 2027 : l’Assemblée rejette la seconde partie du texte')).toBeCloseTo(0.405, 3);
    expect(sim('ÉTÉ, été !', 'ete ete')).toBe(1);
  });
});

describe('dedupe', () => {
  it('fusionne une même URL vue par plusieurs sources : métadonnées RSS, chapô présent, date la plus ancienne', () => {
    const out = dedupe(
      [
        art('https://www.lemonde.fr/a?utm_source=x', 'Titre agrégateur', { publishedAt: '2026-11-06T05:00:00.000Z', origin: 'thenewsapi' }),
        art('https://lemonde.fr/a', 'Titre éditeur', { outlet: 'Le Monde', origin: 'rss', publishedAt: '2026-11-06T04:00:00.000Z' }),
        art('https://lemonde.fr/a#comments', 'Titre Exa', { description: 'Chapô', origin: 'exa' }),
      ],
      wl,
    );
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      id: articleId('https://lemonde.fr/a'),
      url: 'https://lemonde.fr/a',
      outlet: 'Le Monde',
      title: 'Titre éditeur',
      description: 'Chapô',
      publishedAt: '2026-11-06T04:00:00.000Z',
      origin: 'rss',
    });
  });

  it('R1 : ne garde un texte fusionné que pour un domaine full', () => {
    const out = dedupe(
      [
        art('https://lemonde.fr/b', 'Article Le Monde assez long pour le test', { text: 'texte qui n’aurait jamais dû arriver ici' }),
        art('https://sudradio.fr/c', 'Article Sud Radio assez long pour le test', { origin: 'rss' }),
        art('https://sudradio.fr/c', 'Article Sud Radio assez long pour le test', { origin: 'exa', text: 'Texte intégral légitime.' }),
      ],
      wl,
    );
    expect(out.find((a) => a.url.includes('lemonde'))!.text).toBeNull();
    expect(out.find((a) => a.url.includes('sudradio'))!.text).toBe('Texte intégral légitime.');
  });

  it('regroupe par titre (≥ 0,6) et par /similar, pas les titres courts ni les sujets voisins', () => {
    const seed = art('https://fr.euronews.com/retraites', 'Réforme des retraites : les syndicats appellent à une nouvelle journée de mobilisation');
    const out = dedupe(
      [
        art('https://lemonde.fr/budget', 'Budget 2027 : le Sénat adopte la première partie du texte'),
        art('https://lefigaro.fr/budget', 'Le Sénat adopte la première partie du budget 2027'),
        art('https://liberation.fr/budget-an', 'Budget 2027 : l’Assemblée rejette la seconde partie du texte'),
        seed,
        { ...art('https://lefigaro.fr/retraites', 'Retraites : une nouvelle journée de mobilisation fin novembre'), seed: seed.article.id },
        art('https://a.fr/direct', 'En direct'),
        art('https://b.fr/direct', 'En direct'),
      ],
      wl,
    );
    const group = (host: string) => out.find((a) => a.url.includes(host))!.groupId;
    expect(group('lemonde.fr/budget')).toBe(group('lefigaro.fr/budget'));
    expect(group('liberation.fr')).not.toBe(group('lemonde.fr/budget'));
    expect(group('lefigaro.fr/retraites')).toBe(group('euronews.com/retraites'));
    expect(group('a.fr/direct')).not.toBe(group('b.fr/direct'));
    expect(out.every((a) => /^g-[0-9a-f]{16}$/.test(a.groupId!))).toBe(true);
  });

  it('est déterministe : l’ordre d’entrée ne change pas la sortie', () => {
    const input = [
      art('https://lemonde.fr/budget', 'Budget 2027 : le Sénat adopte la première partie du texte'),
      art('https://bbc.co.uk/x', 'Budget vote in France: Senate adopts first part', { lang: 'en' }),
      art('https://lefigaro.fr/budget', 'Le Sénat adopte la première partie du budget 2027'),
      art('https://elpais.com/x', 'El Senado francés aprueba la primera parte del presupuesto', { lang: 'es' }),
      art('https://liberation.fr/autre', 'Un tout autre sujet sans aucun rapport avec le budget'),
    ];
    const a = dedupe(input, wl);
    const b = dedupe([...input].reverse(), wl);
    expect(b).toEqual(a);
    expect(a.map((x) => x.lang)).toEqual(['fr', 'fr', 'fr', 'en', 'es']);
    expect(a[0].groupId).toBe(a[1].groupId);
  });

  it('ignore une URL illisible sans lever', () => {
    expect(dedupe([art('https://lemonde.fr/ok', 'Titre valide pour le test'), { article: { ...art('https://x.fr', 'T').article, url: 'mailto:x@y.fr' } }], wl)).toHaveLength(1);
  });
});
