import { expect, test } from '@playwright/test';
import { open } from './helpers';

/**
 * Captures de référence (spec §13) : zones clés à 390 px, en clair et en sombre, comparées aux images
 * de e2e/visual.spec.ts-snapshots/ (écart toléré : 1 % des pixels). Après un changement voulu :
 * npm run web:e2e -- --update-snapshots, puis regarder les images avant de les commiter.
 */
const SHOTS: { name: string; path: string; selector: string; click?: string }[] = [
  { name: 'brief-fr-entete', path: '/?ed=fr', selector: '.mb' },
  { name: 'brief-fr-carte', path: '/?ed=fr', selector: '.card >> nth=0' },
  { name: 'brief-en-vocab', path: '/?ed=en', selector: '.vocab' },
  { name: 'thread-fr', path: '/threads', click: 'Épisodes méditerranéens 2026', selector: '.th-head' },
  { name: 'archive', path: '/archive?m=2026-11', selector: '.cal' },
  { name: 'sante', path: '/sante', selector: '.run >> nth=0' },
];

for (const shot of SHOTS) {
  test(`capture ${shot.name}`, async ({ page }) => {
    await open(page, shot.path);
    if (shot.click) {
      await page.getByRole('link', { name: shot.click }).click();
      await page.waitForURL(/\/threads\/[0-9a-f-]{36}$/);
    }
    // En-tête collant et barre d'onglets fixe : remis dans le flux, pour ne pas couvrir la zone capturée.
    await page.addStyleTag({ content: '.topbar,.tabbar{position:static!important}' });
    await expect(page.locator(shot.selector)).toHaveScreenshot(`${shot.name}.png`);
  });
}
