import { expect, test } from '@playwright/test';
import { collectErrors, expectNoHorizontalOverflow, open, VISITOR_PORT } from './helpers';

/**
 * Visiteur sans session (serveur FIXTURE_VISITOR=1) : le brief se lit en entier, sans actions
 * personnelles ; seule la page Santé renvoie vers /login.
 */
test.use({ baseURL: `http://127.0.0.1:${VISITOR_PORT}` });

const PAGES = ['/', '/?ed=en', '/?ed=es', '/edition/2026-11-06', '/threads', '/vocab', '/archive?m=2026-11', '/login'];

for (const path of PAGES) {
  test(`visiteur : ${path} s’affiche sans connexion, sans erreur ni débordement`, async ({ page }) => {
    const errors = collectErrors(page);
    await open(page, path);
    expect(new URL(page.url()).pathname).toBe(path.split('?')[0]);
    await expectNoHorizontalOverflow(page);
    expect(errors).toEqual([]);
  });
}

test('visiteur : le Vocab du jour se lit sans cases, sans « Tout cocher » ni « Ajouter à Anki »', async ({ page }) => {
  await open(page, '/?ed=en');
  await expect(page.locator('.vocab.ro .vrow')).toHaveCount(6);
  await expect(page.locator('input[type="checkbox"]')).toHaveCount(0);
  await expect(page.getByRole('button', { name: /Tout cocher|Ajouter/ })).toHaveCount(0);
  await expect(page.locator('.player')).toHaveCount(1);
});

test('visiteur : la page Vocab n’a ni cases ni filtre « Coché »', async ({ page }) => {
  await open(page, '/vocab');
  await expect(page.locator('.vrow').first()).toBeVisible();
  await expect(page.locator('input[type="checkbox"]')).toHaveCount(0);
  await expect(page.getByRole('navigation', { name: 'Coché' })).toHaveCount(0);
});

test('visiteur : la frise d’un Thread se lit, sans « Suivre ce thread »', async ({ page }) => {
  await open(page, '/threads');
  await page.getByRole('link', { name: /Épisodes méditerranéens 2026/ }).click();
  await page.waitForURL(/\/threads\/[0-9a-f-]{36}$/);
  await expect(page.locator('.timeline li')).toHaveCount(2);
  await expect(page.locator('.follow')).toHaveCount(0);
});

test('visiteur : l’audio se lit sans connexion', async ({ request }) => {
  const r = await request.get('/audio/2026-11-06/fr');
  expect(r.status()).toBe(200);
  expect(r.headers()['content-type']).toBe('audio/mpeg');
});

test('visiteur : /sante renvoie vers /login, et « Se connecter » de l’Archive y mène aussi', async ({ page }) => {
  await page.goto('/sante');
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Connexion');
  await open(page, '/archive?m=2026-11');
  await expect(page.getByRole('link', { name: 'Santé →' })).toHaveCount(0);
  await page.getByRole('link', { name: 'Se connecter' }).click();
  await expect(page).toHaveURL(/\/login$/);
  await page.getByRole('link', { name: '← Retour au brief' }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.locator('.topbar')).toBeVisible();
});

test('visiteur : « Se connecter » est dans le menu du compte de l’en-tête (téléphone)', async ({ page }) => {
  await open(page, '/?ed=fr');
  await expect(page.getByRole('link', { name: 'Se connecter' })).toBeHidden();
  await page.getByLabel('Compte : se connecter').click();
  await page.getByRole('link', { name: 'Se connecter' }).click();
  await expect(page).toHaveURL(/\/login$/);
});

test('visiteur : « Se connecter » est dans la barre latérale (grand écran)', async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 1024 });
  await open(page, '/threads');
  const side = page.locator('.side');
  await expect(side.getByRole('link', { name: 'Se connecter' })).toBeVisible();
  await expect(side.getByText('Santé →')).toHaveCount(0);
});

const SHOTS: { name: string; path: string; selector: string }[] = [
  { name: 'visiteur-vocab-en', path: '/?ed=en', selector: '.vocab' },
  { name: 'visiteur-archive-entete', path: '/archive?m=2026-11', selector: '.page-head' },
  { name: 'visiteur-login', path: '/login', selector: '.login' },
];

for (const shot of SHOTS) {
  test(`capture ${shot.name}`, async ({ page }) => {
    await open(page, shot.path);
    await page.addStyleTag({ content: '.topbar,.tabbar{position:static!important}' });
    await expect(page.locator(shot.selector)).toHaveScreenshot(`${shot.name}.png`);
  });
}
