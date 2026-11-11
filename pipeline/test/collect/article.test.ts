import { describe, expect, it } from 'vitest';
import { articleId, makeArticle, plainText, toIso } from '../../collect/article';
import { loadWhitelist } from '../../lib/whitelist';
import { WHITELIST_PATH } from '../helpers';

const wl = loadWhitelist(WHITELIST_PATH);

describe('makeArticle', () => {
  it('normalise URL, titre, langue et date', () => {
    const { article } = makeArticle(
      {
        url: 'https://www.lemonde.fr/politique/article/x.html?utm_source=tw#haut',
        title: ' Budget&nbsp;: le <b>Sénat</b> vote ',
        lang: 'fr-FR',
        publishedAt: '2026-11-06T05:00:00+01:00',
        description: '<p>Chapô &amp; suite</p>',
        origin: 'thenewsapi',
      },
      wl,
    );
    expect(article).toEqual({
      id: articleId('https://lemonde.fr/politique/article/x.html'),
      url: 'https://lemonde.fr/politique/article/x.html',
      outlet: 'lemonde.fr',
      title: 'Budget : le Sénat vote',
      description: 'Chapô & suite',
      lang: 'fr',
      publishedAt: '2026-11-06T04:00:00.000Z',
      origin: 'thenewsapi',
      text: null,
    });
  });

  it('R1 : écarte le texte d’un domaine qui n’est pas full et le signale', () => {
    const meta = makeArticle({ url: 'https://lemonde.fr/a', title: 'T', lang: 'fr', origin: 'webz', text: 'Texte intégral.' }, wl);
    expect(meta.article?.text).toBeNull();
    expect(meta.discardedText).toBe(true);
    const feed = makeArticle({ url: 'https://npr.org/a', title: 'T', lang: 'en', origin: 'webz', text: 'Full text.' }, wl);
    expect(feed.article?.text).toBeNull();
    const unknown = makeArticle({ url: 'https://inconnu.example/a', title: 'T', lang: 'en', origin: 'exa', text: 'x' }, wl);
    expect(unknown.article?.text).toBeNull();
    const full = makeArticle({ url: 'https://fr.euronews.com/a', title: 'T', lang: 'fr', origin: 'exa', text: 'Para 1\r\n\r\n\r\n\r\nPara 2' }, wl);
    expect(full.article?.text).toBe('Para 1\n\nPara 2');
    expect(full.discardedText).toBe(false);
  });

  it('refuse une URL non http(s), un titre vide ou une langue absente, sans lever', () => {
    expect(makeArticle({ url: 'javascript:alert(1)', title: 'T', lang: 'fr', origin: 'rss' }, wl).article).toBeNull();
    expect(makeArticle({ url: 'pas une url', title: 'T', lang: 'fr', origin: 'rss' }, wl).article).toBeNull();
    expect(makeArticle({ url: 'https://a.fr/x', title: '  <br> ', lang: 'fr', origin: 'rss' }, wl).article).toBeNull();
    expect(makeArticle({ url: 'https://a.fr/x', title: 'T', lang: null, origin: 'rss' }, wl).article).toBeNull();
    expect(makeArticle({ url: 'https://a.fr/x', title: 'T', lang: 'french', origin: 'rss' }, wl).article).toBeNull();
  });

  it('nomme le média par son domaine si la source ne le donne pas, borne la description', () => {
    const { article } = makeArticle({ url: 'https://news.sky.com/story/x', title: 'T', lang: 'en', origin: 'exa', description: 'x'.repeat(2000) }, wl);
    expect(article?.outlet).toBe('sky.com');
    expect(article?.description).toHaveLength(600);
  });
});

describe('utilitaires', () => {
  it('plainText décode les entités numériques et toIso refuse une date illisible', () => {
    expect(plainText('L&#8217;&#xE9;t&eacute;')).toBe('L’ét&eacute;');
    expect(toIso('hier')).toBeNull();
    expect(toIso('Thu, 06 Nov 2026 05:00:00 GMT')).toBe('2026-11-06T05:00:00.000Z');
  });
});
