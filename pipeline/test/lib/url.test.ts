import { describe, expect, it } from 'vitest';
import { parisToday } from '../../lib/date';
import { hostOf, normalizeUrl, outletKey, tryNormalizeUrl } from '../../lib/url';

describe('normalizeUrl', () => {
  it('retire www, fragment, paramètres de suivi et / final', () => {
    expect(normalizeUrl('https://WWW.Example.com/a/b/?utm_source=x&id=3#top')).toBe('https://example.com/a/b?id=3');
    expect(normalizeUrl('https://www.cbsnews.com/news/x/')).toBe('https://cbsnews.com/news/x');
  });

  it('trie la requête et ignore les variantes d’encodage et de suivi', () => {
    expect(normalizeUrl('https://x.com/a/?q=a%20b&utm_source=x')).toBe(normalizeUrl('https://x.com/a?q=a+b'));
    expect(normalizeUrl('https://x.com/a?b=2&a=1&XTOR=z&at_medium=m&ocid=1&cmpid=2')).toBe('https://x.com/a?a=1&b=2');
  });

  it('rejette les schémas autres que http(s)', () => {
    expect(() => normalizeUrl('javascript:alert(1)')).toThrow();
    expect(() => normalizeUrl('ftp://x.com/a')).toThrow();
  });
});

describe('tryNormalizeUrl', () => {
  it('renvoie null pour une URL illisible ou non http(s)', () => {
    expect(tryNormalizeUrl('')).toBeNull();
    expect(tryNormalizeUrl('htp:/x')).toBeNull();
    expect(tryNormalizeUrl('http://exa mple.com')).toBeNull();
    expect(tryNormalizeUrl('https://www.a.com/x/')).toBe('https://a.com/x');
  });
});

describe('outletKey', () => {
  it('ramène les sous-domaines au domaine enregistrable', () => {
    expect(outletKey('https://fr.euronews.com/2026/x')).toBe('euronews.com');
    expect(outletKey('https://www.euronews.com/x')).toBe('euronews.com');
    expect(outletKey('https://news.bbc.co.uk/x')).toBe('bbc.co.uk');
    expect(outletKey('https://www.exteriores.gob.es/x')).toBe('exteriores.gob.es');
    expect(outletKey('https://www.interieur.gouv.fr/x')).toBe('interieur.gouv.fr');
    expect(hostOf('https://www.npr.org/x')).toBe('npr.org');
  });
});

describe('parisToday', () => {
  it('donne la date de Paris, pas celle d’UTC', () => {
    expect(parisToday(new Date('2026-11-05T23:30:00Z'))).toBe('2026-11-06');
    expect(parisToday(new Date('2026-11-06T04:13:00Z'))).toBe('2026-11-06');
  });
});
