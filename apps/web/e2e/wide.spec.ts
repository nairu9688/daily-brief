import { expect, test, type Page } from '@playwright/test';
import { collectErrors, open } from './helpers';

/**
 * Grand écran (≥ 1024 px en paysage) : iPad couché (1366 × 1024) et ordinateur (1440 × 900), en clair et en
 * sombre (projets). Barre latérale visible, barre d'onglets du bas masquée, aucun défilement horizontal,
 * Morning Brief et marchés dans la colonne de droite. Captures de référence dans wide.spec.ts-snapshots/.
 */
const SIZES = [
  { name: 'ipad', width: 1366, height: 1024 },
  { name: 'bureau', width: 1440, height: 900 },
];
const PAGES = ['/?ed=fr', '/?ed=en', '/?ed=es', '/edition/2026-11-06', '/threads', '/vocab', '/archive?m=2026-11', '/sante'];

async function noHorizontalOverflow(page: Page, width: number) {
  const w = await page.evaluate(() => Math.max(document.documentElement.scrollWidth, document.body.scrollWidth));
  expect(w).toBeLessThanOrEqual(width);
}

for (const size of SIZES) {
  test.describe(`${size.name} ${size.width}×${size.height}`, () => {
    test.use({ viewport: { width: size.width, height: size.height } });

    for (const path of PAGES) {
      test(`${path} : barre latérale, pas de barre d’onglets ni de débordement`, async ({ page }) => {
        const errors = collectErrors(page);
        await open(page, path);
        await noHorizontalOverflow(page, size.width);
        await expect(page.locator('.side')).toBeVisible();
        await expect(page.locator('.side .sidenav a')).toHaveCount(4);
        await expect(page.locator('.side .editions a')).toHaveCount(3);
        await expect(page.locator('.tabbar')).toBeHidden();
        expect(errors).toEqual([]);
      });
    }

    test('le Brief : date en tête, sujets au centre, Morning Brief et marchés à droite', async ({ page }) => {
      await open(page, '/?ed=fr');
      await expect(page.locator('.dayhead .dd')).toHaveText('Vendredi 6 novembre 2026');
      await expect(page.locator('.topbar .editions')).toBeHidden();
      const box = async (sel: string) => (await page.locator(sel).first().boundingBox())!;
      const [side, card, mb, mkts] = [await box('.side'), await box('.card'), await box('.rail .mb'), await box('.rail .mkts')];
      expect(card.x).toBeGreaterThan(side.x + side.width);
      expect(mb.x).toBeGreaterThan(card.x + card.width);
      expect(mkts.y).toBeGreaterThan(mb.y);
      expect(mkts.x).toBe(mb.x);
      await expect(page.locator('.rail .mkts li')).toHaveCount(9);
    });

    test('capture du Brief', async ({ page }) => {
      await open(page, '/?ed=fr');
      await expect(page).toHaveScreenshot(`large-${size.name}-brief.png`);
    });
  });
}

test.describe('grand écran : Threads', () => {
  test.use({ viewport: { width: 1366, height: 1024 } });
  test('capture de la liste des Threads', async ({ page }) => {
    await open(page, '/threads');
    await expect(page).toHaveScreenshot('large-ipad-threads.png');
  });
});

test.describe('tablette en portrait (820 px) : la colonne du téléphone', () => {
  test.use({ viewport: { width: 820, height: 1180 } });
  test('pas de barre latérale, barre d’onglets visible', async ({ page }) => {
    await open(page, '/?ed=fr');
    await expect(page.locator('.side')).toBeHidden();
    await expect(page.locator('.tabbar')).toBeVisible();
    await noHorizontalOverflow(page, 820);
  });
});
