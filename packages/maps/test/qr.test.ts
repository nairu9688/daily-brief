import { describe, expect, it } from 'vitest';
import { qrSvg } from '../src/qr';

describe('qrSvg', () => {
  it('produit un SVG avec la classe qr', async () => {
    const svg = await qrSvg('https://www.sudradio.fr/societe/x');
    expect(svg.startsWith('<svg class="qr"')).toBe(true);
    expect(svg).toContain('<path');
  });
});
