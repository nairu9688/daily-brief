import { expect, test } from '@playwright/test';
import { open } from './helpers';

/**
 * Changer d'édition donne un retour immédiat (marque sur l'onglet, barre de progression, écran estompé),
 * même quand le serveur tarde : les requêtes RSC (`_rsc`) sont retenues 1,5 s.
 */
test('un clic sur un onglet montre aussitôt le chargement, puis l’édition', async ({ page }) => {
  await open(page, '/?ed=fr');
  await page.route(/[?&]_rsc=/, async (route) => {
    await new Promise((r) => setTimeout(r, 1500));
    await route.continue();
  });
  await page.locator('.topbar .editions a[data-ed="en"]').click();
  await expect(page.locator('.topbar .editions a[data-ed="en"] .pend[data-on]')).toBeAttached({ timeout: 500 });
  await expect(page.locator('.progress')).toBeVisible({ timeout: 500 });
  await expect(page.locator('.edition[data-for="en"]')).toBeVisible();
  await expect(page.locator('.progress')).toHaveCount(0);
});

test('l’onglet d’une autre édition est préchargé au survol', async ({ page }) => {
  await open(page, '/?ed=fr');
  const prefetch = page.waitForRequest((r) => r.url().includes('ed=es') && r.url().includes('_rsc='));
  await page.locator('.topbar .editions a[data-ed="es"]').hover();
  await prefetch;
  // Le préchargement ne change pas l'édition retenue.
  await open(page, '/');
  await expect(page.locator('.topbar .editions a[aria-current="page"]')).toHaveAttribute('data-ed', 'fr');
});

test('marchés : bandeau sous le Morning Brief (fixture), cours différés et heure', async ({ page }) => {
  await open(page, '/?ed=fr');
  const m = page.locator('.mkts');
  await expect(m.locator('.mk-head')).toHaveText(/Marchés\s*Différé · 10:28/);
  await expect(m.locator('li')).toHaveCount(9);
  await expect(m.locator('li[data-symbol="^FCHI"]')).toContainText('CAC 40');
  await expect(m.locator('li[data-symbol="^FCHI"] .mk-c')).toHaveAttribute('data-dir', 'down');
  // Une archive ne montre pas les cours du jour.
  await open(page, '/edition/2026-11-06');
  await expect(page.locator('.mkts')).toHaveCount(0);
});

test('connecté : le menu du compte (téléphone) montre l’adresse, Santé et « Se déconnecter »', async ({ page }) => {
  await open(page, '/?ed=fr');
  await page.locator('.topbar .acct summary').click();
  const pop = page.locator('.topbar .acct-pop');
  await expect(pop.getByText('fixture@localhost')).toBeVisible();
  await expect(pop.getByRole('button', { name: 'Se déconnecter' })).toBeVisible();
  await pop.getByRole('link', { name: 'Santé →' }).click();
  await expect(page).toHaveURL(/\/sante$/);
});
