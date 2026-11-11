import { describe, expect, it } from 'vitest';
import { makeArticle } from '../../collect/article';
import { applyEditionPerimeter } from '../../collect/perimeter';
import { loadWhitelist } from '../../lib/whitelist';
import { WHITELIST_PATH } from '../helpers';

const wl = loadWhitelist(WHITELIST_PATH);
const cand = (url: string, lang: string) => ({ article: makeArticle({ url, title: 'Titre', lang, origin: 'rss' }, wl).article! });

describe('R2 à la collecte', () => {
  it('garde en espagnol les médias dont le pays est ES, écarte les autres', () => {
    const list = [
      cand('https://www.eldiario.es/a', 'es'),
      cand('https://es.euronews.com/b', 'es'),
      cand('https://inconnu.example/c', 'es'),
      cand('https://inconnu.es/d', 'es'),
      cand('https://www.lemonde.fr/e', 'fr'),
      cand('https://www.cbsnews.com/f', 'en'),
    ];
    const { kept, dropped } = applyEditionPerimeter(list, wl);
    expect(kept.map((c) => c.article.url)).toEqual(['https://eldiario.es/a', 'https://inconnu.es/d', 'https://lemonde.fr/e', 'https://cbsnews.com/f']);
    expect(dropped).toBe(2);
  });
});
