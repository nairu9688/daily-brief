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

  it('indexe une URL de newsletter sur son bloc et le bloc précédent seulement', () => {
    const t = buildSourceTexts([], ['Story A text.\n\nhttps://a.com/x\n\nStory B: « nous ne céderons pas », dit Dupont, 12 %.']);
    const text = t.textFor('https://a.com/x')!;
    expect(text).toContain('Story A');
    expect(text).not.toContain('céderons');
  });

  it('découpe aussi sur les titres markdown', () => {
    const t = buildSourceTexts([], ['# Un\nTexte un https://a.com/x\n# Deux\nTexte deux secret']);
    expect(t.textFor('https://a.com/x')).not.toContain('secret');
  });

  it('indexe chaque newsletter qui cite une URL', () => {
    const t = buildSourceTexts([], ['A https://a.com/x', 'B https://a.com/x "quote B"']);
    expect(t.textFor('https://a.com/x')).toContain('quote B');
  });

  it('nettoie la ponctuation et le markdown autour des URL', () => {
    const t = buildSourceTexts([], ['[lien](https://a.com/x).', '**https://a.com/y**', 'https://a.com/z!', 'https://a.com/q?a=1&amp;b=2']);
    expect(t.inNewsletter('https://a.com/x')).toBe(true);
    expect(t.inNewsletter('https://a.com/y')).toBe(true);
    expect(t.inNewsletter('https://a.com/z')).toBe(true);
    expect(t.inNewsletter('https://a.com/q?a=1&b=2')).toBe(true);
  });

  it('ignore une URL à parenthèses plutôt que de la tronquer', () => {
    const t = buildSourceTexts([], ['[w](https://fr.wikipedia.org/wiki/Foo_(bar))']);
    expect(t.inNewsletter('https://fr.wikipedia.org/wiki/Foo_')).toBe(false);
  });
});
