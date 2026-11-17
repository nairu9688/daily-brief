// @vitest-environment node
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PNG } from 'pngjs';
import { describe, expect, it } from 'vitest';
import manifest from '@/app/manifest';
import { ICONS } from '../../scripts/make-icons';

const ICON_DIR = join(process.cwd(), 'apps/web/public/icons');

describe('PWA', () => {
  it('le manifeste rend l’appli installable', () => {
    const m = manifest();
    expect(m).toMatchObject({ name: 'Daily Brief', start_url: '/', display: 'standalone', lang: 'fr' });
    expect(m.icons?.map((i) => [i.sizes, i.purpose])).toEqual([
      ['192x192', 'any'],
      ['512x512', 'any'],
      ['512x512', 'maskable'],
    ]);
  });

  it('chaque icône existe à la bonne taille', () => {
    for (const icon of ICONS) {
      const png = PNG.sync.read(readFileSync(join(ICON_DIR, icon.file)));
      expect([png.width, png.height], icon.file).toEqual([icon.size, icon.size]);
    }
    expect(existsSync(join(ICON_DIR, 'icon.svg'))).toBe(true);
    for (const i of manifest().icons ?? []) expect(existsSync(join(ICON_DIR, i.src.replace('/icons/', '')))).toBe(true);
  });
});
