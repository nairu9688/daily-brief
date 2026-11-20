// @vitest-environment node
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const css = readFileSync(join(process.cwd(), 'apps/web/app/globals.css'), 'utf8');

describe('styles de l’appli', () => {
  it('les cases du vocabulaire montrent le focus clavier', () => {
    expect(css).toContain('.vrow input:focus-visible+.box{outline:2px solid var(--accent)');
  });

  it('le flou de l’en-tête, de la barre d’onglets et des légendes survit à la minification (Lightning CSS)', () => {
    const block = css.slice(css.indexOf('@supports (backdrop-filter: blur(1px))'));
    expect(block).not.toBe(css);
    for (const sel of ['.topbar', '.tabbar', '.media .cap', '.photo .cap']) expect(block, sel).toContain(sel);
  });

  it('chaque édition a son accent, posé par tout élément qui porte data-ed (coquille, écran, onglet)', () => {
    expect(css).toContain('[data-ed="fr"]{--accent:var(--fr)} [data-ed="en"]{--accent:var(--en)} [data-ed="es"]{--accent:var(--es)}');
  });

  it('le grand écran est sous une seule requête, qui masque la barre d’onglets et montre la barre latérale', () => {
    const wide = css.slice(css.indexOf('@media (min-width: 1024px) and (orientation: landscape){'));
    expect(wide).not.toBe(css);
    expect(wide).toContain('.tabbar{display:none}');
    expect(wide).toContain('.side{display:flex;');
    expect(css.slice(0, css.indexOf('@media (min-width: 1024px)'))).toContain('.dayhead,.side{display:none}');
  });
});
