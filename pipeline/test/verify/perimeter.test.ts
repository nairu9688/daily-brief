import { describe, expect, it } from 'vitest';
import { loadWhitelist } from '../../lib/whitelist';
import { checkPerimeter } from '../../verify/perimeter';
import { WHITELIST_PATH } from '../helpers';

const wl = loadWhitelist(WHITELIST_PATH);
const src = (url: string, lang: string) => ({ outlet: 'X', title: 't', url, lang, readFull: false });

describe('checkPerimeter (R2)', () => {
  it('laisse tout passer en FR', () => {
    expect(checkPerimeter('fr', src('https://www.cbsnews.com/x', 'en'), wl)).toBeNull();
  });

  it('exige la langue de l’édition en EN et ES', () => {
    expect(checkPerimeter('en', src('https://fr.euronews.com/x', 'fr'), wl)).toHaveProperty('remove');
    expect(checkPerimeter('es', src('https://fr.euronews.com/x', 'fr'), wl)).toHaveProperty('remove');
    expect(checkPerimeter('en', src('https://www.cbsnews.com/x', 'en'), wl)).toBeNull();
  });

  it('retire un média non espagnol de l’édition ES', () => {
    expect(checkPerimeter('es', src('https://www.infobae.com/x', 'es'), wl)).toHaveProperty('remove');
    expect(checkPerimeter('es', src('https://www.eldiario.es/x', 'es'), wl)).toBeNull();
    expect(checkPerimeter('es', src('https://www.exteriores.gob.es/x', 'es'), wl)).toBeNull();
  });

  it('retire un média au pays inconnu', () => {
    expect(checkPerimeter('es', src('https://nouveau-media.com/x', 'es'), wl)).toHaveProperty('remove');
  });

  it('déduit le pays du domaine national quand la liste blanche l’ignore', () => {
    expect(checkPerimeter('es', src('https://elcomercio.pe/x', 'es'), wl)).toHaveProperty('remove');
    expect(checkPerimeter('es', src('https://www.elpais.com.co/x', 'es'), wl)).toHaveProperty('remove');
    expect(checkPerimeter('es', src('https://nouveau-media.es/x', 'es'), wl)).toBeNull();
  });

  it('retire une URL illisible', () => {
    expect(checkPerimeter('es', src('pas une url', 'es'), wl)).toEqual({ remove: expect.stringContaining('URL illisible') });
  });
});
