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
});
