import { describe, expect, it } from 'vitest';
import { cleanLink, htmlToMarkdown, tidy } from '../../newsletters/markdown';

describe('cleanLink', () => {
  it('garde un lien http(s), remplace un lien de suivi par sa destination, refuse les autres schémas', () => {
    expect(cleanLink('https://www.euronews.com/2026/11/06/a')).toBe('https://www.euronews.com/2026/11/06/a');
    expect(cleanLink('https://click.lettre.fr/r?u=https%3A%2F%2Fwww.eldiario.es%2Fpolitica%2Fx_1_2.html&t=9')).toBe('https://www.eldiario.es/politica/x_1_2.html');
    expect(cleanLink('https://www.google.com/url?q=https://www.pbs.org/newshour/a&sa=D')).toBe('https://www.pbs.org/newshour/a');
    expect(cleanLink('https://t.lettre.fr/c/eJx0k8Fu')).toBe('https://t.lettre.fr/c/eJx0k8Fu');
    expect(cleanLink('mailto:redaction@exemple.fr')).toBeNull();
    expect(cleanLink('javascript:alert(1)')).toBeNull();
    expect(cleanLink('pas une url')).toBeNull();
  });

  it('écarte les liens de désinscription et de préférences, même enveloppés', () => {
    expect(cleanLink('https://lettre.fr/unsubscribe?id=42')).toBeNull();
    expect(cleanLink('https://click.lettre.fr/r?u=https%3A%2F%2Flettre.fr%2Fpreferences%3Fid%3D42')).toBeNull();
  });
});

describe('htmlToMarkdown', () => {
  it('blocs séparés par une ligne vide, liens [texte](url), titres #, textes mot pour mot', () => {
    const html = `<html><head><title>T</title><style>p{color:red}</style></head><body>
      <h1>L’essentiel du jour</h1>
      <table><tr><td><p>« Nous ne céderons pas », a déclaré la ministre devant les députés.</p>
      <p>Lire : <a href="https://click.lettre.fr/r?u=https%3A%2F%2Ffr.euronews.com%2F2026%2F11%2F06%2Fbudget">le budget en&nbsp;débat</a></p></td></tr></table>
      <script>alert(1)</script><img src="https://pixel.lettre.fr/o.gif">
      <div style="display: none">Texte d’aperçu caché</div>
      <p>Ligne 1<br>Ligne 2</p></body></html>`;
    expect(htmlToMarkdown(html)).toBe(
      '# L’essentiel du jour\n\n« Nous ne céderons pas », a déclaré la ministre devant les députés.\n\nLire : [le budget en débat](https://fr.euronews.com/2026/11/06/budget)\n\nLigne 1\nLigne 2',
    );
  });

  it('retire les liens de désinscription et les liens sans texte (logos, pixels)', () => {
    const html = '<p><a href="https://lettre.fr/go"><img src="logo.png"></a> Bonjour</p><p><a href="https://lettre.fr/x">Se désabonner</a></p><p><a href="https://lettre.fr/manage">Gérer mes préférences</a></p>';
    expect(htmlToMarkdown(html)).toBe('Bonjour');
  });

  it('accepte un fragment sans <html> et retire les crochets du texte d’un lien', () => {
    expect(htmlToMarkdown('<a href="https://pbs.org/a">[Vidéo] Le débat</a>')).toBe('[Vidéo Le débat](https://pbs.org/a)');
  });
});

describe('tidy', () => {
  it('unifie les fins de ligne et réduit les lignes vides', () => {
    expect(tidy('a  \r\n\r\n\r\n\tb c ')).toBe('a\n\nb c');
  });
});
