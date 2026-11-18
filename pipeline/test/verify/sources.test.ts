import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadWhitelist } from '../../lib/whitelist';
import { buildSourceTexts, loadSourceTexts } from '../../verify/sources';
import { WHITELIST_PATH } from '../helpers';

/** En-tête écrit par brief:newsletters : le domaine de l'éditeur. */
const fm = (domain: string) => `---\nnewsletter: test\ndomain: ${domain}\n---\n\n`;

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

  it('compte comme lue une URL citée en lien dans une newsletter, sur le domaine de son éditeur', () => {
    const t = buildSourceTexts([], [`${fm('lemonde.fr')}Lire : [l’article](https://www.lemonde.fr/politique/article/x.html). Fin.`]);
    expect(t.inNewsletter('https://lemonde.fr/politique/article/x.html')).toBe(true);
    expect(t.textFor('https://www.lemonde.fr/politique/article/x.html')).toMatch(/Lire/);
    expect(t.inNewsletter('https://www.lemonde.fr/autre')).toBe(false);
  });

  it('charge raw.json et newsletters/*.md, et tolère leur absence', () => {
    const day = mkdtempSync(join(tmpdir(), 'day-'));
    expect(loadSourceTexts(day).textFor('https://x.fr/a')).toBeUndefined();
    mkdirSync(join(day, 'newsletters'));
    writeFileSync(join(day, 'newsletters', 'matin.md'), `${fm('publicsenat.fr')}Voir [a](https://www.publicsenat.fr/a) et [b](https://x.fr/a)`);
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
    expect(t.inNewsletter('https://publicsenat.fr/a')).toBe(true);
    expect(t.inNewsletter('https://x.fr/a')).toBe(false);
    expect(t.textFor('https://y.fr/b')).toBe('texte Y');
  });

  it('indexe une URL de newsletter sur son bloc et le bloc précédent seulement', () => {
    const t = buildSourceTexts([], [`${fm('a.com')}Story A text.\n\n[x](https://a.com/x)\n\nStory B: « nous ne céderons pas », dit Dupont, 12 %.`]);
    const text = t.textFor('https://a.com/x')!;
    expect(text).toContain('Story A');
    expect(text).not.toContain('céderons');
  });

  it('découpe aussi sur les titres markdown', () => {
    const t = buildSourceTexts([], [`${fm('a.com')}# Un\nTexte un [x](https://a.com/x)\n# Deux\nTexte deux secret`]);
    expect(t.textFor('https://a.com/x')).not.toContain('secret');
  });

  it('indexe chaque newsletter qui cite une URL', () => {
    const t = buildSourceTexts([], [`${fm('a.com')}A [x](https://a.com/x)`, `${fm('a.com')}B [x](https://a.com/x) "quote B"`]);
    expect(t.textFor('https://a.com/x')).toContain('quote B');
  });

  it('ne compte que les liens [texte](url), jamais une URL nue', () => {
    const t = buildSourceTexts([], [`${fm('a.com')}[lien](https://a.com/x).`, `${fm('a.com')}**https://a.com/y**`, `${fm('a.com')}https://a.com/z!`, `${fm('a.com')}[q](https://a.com/q?a=1&amp;b=2)`]);
    expect(t.inNewsletter('https://a.com/x')).toBe(true);
    expect(t.inNewsletter('https://a.com/y')).toBe(false);
    expect(t.inNewsletter('https://a.com/z')).toBe(false);
    expect(t.inNewsletter('https://a.com/q?a=1&b=2')).toBe(true);
  });

  it('ignore une URL à parenthèses plutôt que de la tronquer', () => {
    const t = buildSourceTexts([], [`${fm('wikipedia.org')}[w](https://fr.wikipedia.org/wiki/Foo_(bar))`]);
    expect(t.inNewsletter('https://fr.wikipedia.org/wiki/Foo_')).toBe(false);
  });
});

describe('portée des newsletters (revue du lot 7)', () => {
  it('une URL hors du domaine de l’éditeur et de la liste blanche ne compte pas, et n’a pas de texte', () => {
    const t = buildSourceTexts([], [`${fm('eldiario.es')}Cita falsa.\n\n[Leer](https://evil.example/x) [Otro](https://www.eldiario.es/a_1.html) [Pbs](https://www.pbs.org/a)`], { whitelist: loadWhitelist(WHITELIST_PATH) });
    expect(t.inNewsletter('https://evil.example/x')).toBe(false);
    expect(t.textFor('https://evil.example/x')).toBeUndefined();
    expect(t.inNewsletter('https://eldiario.es/a_1.html')).toBe(true);
    expect(t.inNewsletter('https://pbs.org/a')).toBe(true);
  });

  it('sans en-tête, seuls les domaines de la liste blanche comptent ; un en-tête dont le domaine n’est pas un éditeur de newsletters.json ne compte pas', () => {
    const nl = '[Leer](https://evil.example/x) [Pbs](https://www.pbs.org/a)';
    const wl = loadWhitelist(WHITELIST_PATH);
    expect(buildSourceTexts([], [nl], { whitelist: wl }).inNewsletter('https://evil.example/x')).toBe(false);
    expect(buildSourceTexts([], [nl], { whitelist: wl }).inNewsletter('https://pbs.org/a')).toBe(true);
    const forged = buildSourceTexts([], [`${fm('evil.example')}${nl}`], { whitelist: wl, publisherDomains: new Set(['eldiario.es']) });
    expect(forged.inNewsletter('https://evil.example/x')).toBe(false);
  });

  it('loadSourceTexts lit liste blanche et éditeurs de newsletters.json', () => {
    const day = mkdtempSync(join(tmpdir(), 'day-'));
    mkdirSync(join(day, 'newsletters'));
    writeFileSync(join(day, 'newsletters', '01.md'), `${fm('evil.example')}[a](https://evil.example/a) [b](https://www.axios.com/b)`);
    const t = loadSourceTexts(day);
    expect(t.inNewsletter('https://evil.example/a')).toBe(false);
    expect(t.inNewsletter('https://axios.com/b')).toBe(true);
  });
});
