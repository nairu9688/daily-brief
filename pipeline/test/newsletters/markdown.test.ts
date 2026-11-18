import { describe, expect, it } from 'vitest';
import { cleanLink, htmlToMarkdown, plainLine, textToMarkdown, tidy } from '../../newsletters/markdown';

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

describe('chaîne de confiance (revue du lot 7)', () => {
  it.each([
    'display:none',
    'visibility: hidden',
    'font-size:0',
    'font-size: 0px',
    'mso-hide:all',
    'max-height:0',
    'opacity:0',
  ])('retire le sous-arbre d’un élément masqué par « %s »', (style) => {
    const html = `<p>Visible</p><div style="color:red; ${style}"><p>Caché <a href="https://evil.example/x">Lire</a></p></div>`;
    expect(htmlToMarkdown(html)).toBe('Visible');
  });

  it('garde un élément dont l’opacité ou la taille n’est pas nulle', () => {
    expect(htmlToMarkdown('<p style="opacity:0.8;font-size:14px;max-height:200px">Visible</p>')).toBe('Visible');
  });

  it('retire l’attribut hidden et tout son sous-arbre', () => {
    expect(htmlToMarkdown('<p>Visible</p><div hidden><a href="https://evil.example/x">Lire</a></div>')).toBe('Visible');
  });

  it('une URL nue dans le texte n’est jamais un lien : elle est retirée', () => {
    expect(htmlToMarkdown('<p>Voir https://evil.example/x ici, ou www.evil.example.</p>')).toBe('Voir ici, ou www.evil.example.');
  });

  it('un lien dont le texte est une URL prend pour texte le nom d’hôte de sa destination', () => {
    expect(htmlToMarkdown('<a href="https://www.pbs.org/a">https://evil.example/x</a>')).toBe('[www.pbs.org](https://www.pbs.org/a)');
  });

  it('retire les liens de désinscription où que soit le mot dans un texte court', () => {
    const html = '<p><a href="https://l.fr/a">Click here to unsubscribe</a></p><p><a href="https://l.fr/b">Pour vous désinscrire, cliquez ici</a></p><p><a href="https://l.fr/c">Update your email preferences</a></p><p>Fin</p>';
    expect(htmlToMarkdown(html)).toBe('Fin');
  });

  it('encode les parenthèses des URL et les retire du texte des liens', () => {
    expect(htmlToMarkdown('<a href="https://fr.wikipedia.org/wiki/Foo_(bar)">Foo (bar)</a>')).toBe('[Foo bar](https://fr.wikipedia.org/wiki/Foo_%28bar%29)');
  });
});

describe('cleanLink : déballage limité', () => {
  it('ne déballe que les clés de redirection connues', () => {
    expect(cleanLink('https://click.lettre.fr/r?next=https%3A%2F%2Fwww.pbs.org%2Fa')).toBe('https://click.lettre.fr/r?next=https%3A%2F%2Fwww.pbs.org%2Fa');
    for (const k of ['u', 'url', 'q', 'redirect', 'target', 'dest']) expect(cleanLink(`https://click.lettre.fr/r?${k}=https%3A%2F%2Fwww.pbs.org%2Fa`), k).toBe('https://www.pbs.org/a');
  });

  it('ne déballe jamais vers un autre domaine quand l’hôte extérieur est un hôte d’articles', () => {
    const articleHost = (h: string) => h === 'lemonde.fr' || h.endsWith('.lemonde.fr');
    expect(cleanLink('https://www.lemonde.fr/a.html?ref=https://evil.example/x', { articleHost })).toBe('https://www.lemonde.fr/a.html?ref=https://evil.example/x');
    expect(cleanLink('https://www.lemonde.fr/a.html?url=https://evil.example/x', { articleHost })).toBe('https://www.lemonde.fr/a.html?url=https://evil.example/x');
    expect(cleanLink('https://click.lemonde.fr/r?u=https%3A%2F%2Fwww.lemonde.fr%2Fb.html', { articleHost })).toBe('https://www.lemonde.fr/b.html');
  });
});

describe('textToMarkdown (corps en texte brut)', () => {
  it('déballe les liens de suivi, écrit [url](url), retire les liens de désinscription', () => {
    const text = 'Lire https://click.x.fr/r?u=https%3A%2F%2Fwww.eldiario.es%2Fa_1.html.\r\n\r\nSe désabonner : https://x.fr/unsubscribe?id=1\nfin';
    expect(textToMarkdown(text)).toBe('Lire [https://www.eldiario.es/a_1.html](https://www.eldiario.es/a_1.html).\n\nSe désabonner :\nfin');
  });

  it('encode les parenthèses', () => {
    expect(textToMarkdown('Voir https://fr.wikipedia.org/wiki/Foo_(bar)')).toBe('Voir [https://fr.wikipedia.org/wiki/Foo_%28bar%29](https://fr.wikipedia.org/wiki/Foo_%28bar%29)');
  });
});

describe('plainLine (objet du message)', () => {
  it('une seule ligne, sans URL', () => {
    expect(plainLine('Al día\n# https://evil.example/x  presupuestos\r\n')).toBe('Al día # presupuestos');
  });
});
