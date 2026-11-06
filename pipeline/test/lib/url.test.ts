import { describe, expect, it } from 'vitest';
import { parisToday } from '../../lib/date';
import { hostOf, normalizeUrl, outletKey } from '../../lib/url';

describe('normalizeUrl', () => {
  it('retire www, fragment, paramètres de suivi et / final', () => {
    expect(normalizeUrl('https://WWW.Example.com/a/b/?utm_source=x&id=3#top')).toBe('https://example.com/a/b/?id=3');
    expect(normalizeUrl('https://www.cbsnews.com/news/x/')).toBe('https://cbsnews.com/news/x');
  });
});

describe('outletKey', () => {
  it('ramène les sous-domaines au domaine enregistrable', () => {
    expect(outletKey('https://fr.euronews.com/2026/x')).toBe('euronews.com');
    expect(outletKey('https://www.euronews.com/x')).toBe('euronews.com');
    expect(outletKey('https://news.bbc.co.uk/x')).toBe('bbc.co.uk');
    expect(outletKey('https://www.exteriores.gob.es/x')).toBe('exteriores.gob.es');
    expect(hostOf('https://www.npr.org/x')).toBe('npr.org');
  });
});

describe('parisToday', () => {
  it('donne la date de Paris, pas celle d’UTC', () => {
    expect(parisToday(new Date('2026-11-05T23:30:00Z'))).toBe('2026-11-06');
    expect(parisToday(new Date('2026-11-06T04:13:00Z'))).toBe('2026-11-06');
  });
});
