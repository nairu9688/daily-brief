import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildSourceTexts, loadSourceTexts } from '../../verify/sources';

describe('textes sources', () => {
  it('indexe les articles par URL normalisée et ignore ceux sans texte', () => {
    const t = buildSourceTexts(
      [
        { url: 'https://www.pbs.org/a/?utm_source=x', text: 'texte PBS' },
        { url: 'https://www.npr.org/b', text: null },
      ],
      [],
    );
    expect(t.textFor('https://pbs.org/a')).toBe('texte PBS');
    expect(t.textFor('https://www.npr.org/b')).toBeUndefined();
  });

  it('compte comme lue une URL citée dans une newsletter', () => {
    const t = buildSourceTexts([], ['Lire : https://www.lemonde.fr/politique/article/x.html. Fin.']);
    expect(t.inNewsletter('https://lemonde.fr/politique/article/x.html')).toBe(true);
    expect(t.textFor('https://www.lemonde.fr/politique/article/x.html')).toMatch(/Lire/);
    expect(t.inNewsletter('https://www.lemonde.fr/autre')).toBe(false);
  });

  it('charge raw.json et newsletters/*.md, et tolère leur absence', () => {
    const day = mkdtempSync(join(tmpdir(), 'day-'));
    expect(loadSourceTexts(day).textFor('https://x.fr/a')).toBeUndefined();
    mkdirSync(join(day, 'newsletters'));
    writeFileSync(join(day, 'newsletters', 'matin.md'), 'Voir https://x.fr/a');
    writeFileSync(
      join(day, 'raw.json'),
      JSON.stringify({
        date: '2026-11-06',
        collectedAt: '2026-11-06T04:20:00Z',
        errors: [],
        articles: [{ id: '1', url: 'https://y.fr/b', outlet: 'Y', title: 'T', description: null, lang: 'fr', publishedAt: null, origin: 'rss', text: 'texte Y' }],
      }),
    );
    const t = loadSourceTexts(day);
    expect(t.inNewsletter('https://x.fr/a')).toBe(true);
    expect(t.textFor('https://y.fr/b')).toBe('texte Y');
  });
});
