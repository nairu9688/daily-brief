import { expect, test } from '@playwright/test';
import { collectErrors, expectNoHorizontalOverflow, open } from './helpers';

/** Jetons de design/app.css attendus pour chaque thème. */
const TOKENS = {
  light: { bg: '#F4F4F1', ink: '#0E0E10', fr: '#3E6BFF', body: 'rgb(244, 244, 241)' },
  dark: { bg: '#0B0B0C', ink: '#F3F3F1', fr: '#7B97FF', body: 'rgb(11, 11, 12)' },
};

const PAGES = ['/', '/?ed=en', '/?ed=es', '/edition/2026-11-06', '/threads', '/vocab', '/archive?m=2026-11', '/sante', '/login'];

for (const path of PAGES) {
  test(`${path} s’affiche sans erreur ni débordement`, async ({ page }, info) => {
    const errors = collectErrors(page);
    await open(page, path);
    await expectNoHorizontalOverflow(page);
    const theme = info.project.name === 'sombre' ? TOKENS.dark : TOKENS.light;
    const css = await page.evaluate(() => {
      const s = getComputedStyle(document.documentElement);
      return { bg: s.getPropertyValue('--bg').trim(), ink: s.getPropertyValue('--ink').trim(), fr: s.getPropertyValue('--fr').trim(), body: getComputedStyle(document.body).backgroundColor };
    });
    expect(css.bg.toUpperCase()).toBe(theme.bg);
    expect(css.ink.toUpperCase()).toBe(theme.ink);
    expect(css.body).toBe(theme.body);
    expect(errors).toEqual([]);
  });
}

test('la CSP porte un nonce et n’autorise que Wikimedia pour les images', async ({ page }) => {
  const r = await page.goto('/');
  const csp = r?.headers()['content-security-policy'] ?? '';
  expect(csp).toMatch(/script-src 'self' 'nonce-[A-Za-z0-9+/=]+' 'strict-dynamic'/);
  expect(csp).toContain("img-src 'self' data: https://upload.wikimedia.org https://thumb.wikimedia.org");
  expect(csp).toContain("frame-ancestors 'none'");
  expect(r?.headers()['x-content-type-options']).toBe('nosniff');
});

test('le Brief FR suit la maquette : onglets, cartes, puces, lecteur', async ({ page }) => {
  await open(page, '/?ed=fr');
  await expect(page.locator('.editions a')).toHaveCount(3);
  await expect(page.locator('.editions a[aria-current="page"]')).toHaveAttribute('data-ed', 'fr');
  await expect(page.locator('.card')).toHaveCount(7);
  await expect(page.locator('.card svg.map')).toHaveCount(5);
  await expect(page.locator('.ptime')).toContainText('0:03');
  await page.getByRole('button', { name: 'Culture' }).click();
  await expect(page.locator('.empty')).toBeVisible();
  await expect(page.locator('.rub:visible')).toHaveCount(0);
  await page.getByRole('button', { name: 'Sport' }).click();
  await expect(page.locator('.rub:visible')).toHaveCount(1);
});

test('le flou de l’en-tête, de la barre d’onglets et des légendes est bien appliqué', async ({ page }) => {
  await open(page, '/?ed=fr');
  const blur = await page.evaluate(() => ['.topbar', '.tabbar', '.media .cap'].map((sel) => getComputedStyle(document.querySelector(sel)!).backdropFilter));
  expect(blur).toEqual(['blur(14px)', 'blur(14px)', 'blur(6px)']);
});

test('l’onglet choisi est retenu', async ({ page }) => {
  await open(page, '/?ed=es');
  await open(page, '/');
  await expect(page.locator('.editions a[aria-current="page"]')).toHaveAttribute('data-ed', 'es');
  await expect(page.locator('.player')).toHaveCount(0);
  await open(page, '/?ed=fr');
});

test('cocher un mot et le mettre en file Anki survit au rechargement', async ({ page }, info) => {
  test.skip(info.project.name === 'sombre', 'état partagé du serveur : un seul projet écrit');
  await open(page, '/vocab?langue=es');
  const first = page.locator('.vrow').first();
  await first.locator('.box').click();
  await page.getByRole('button', { name: 'Ajouter 1 mot à Anki' }).click();
  await expect(page.getByRole('status')).toHaveText('1 mot en file pour Anki ✓');
  await open(page, '/vocab?langue=es&coche=oui');
  await expect(page.locator('.vrow')).toHaveCount(1);
  await expect(page.locator('.vrow input').first()).toBeChecked();
});

test('un Thread se suit depuis sa frise', async ({ page }, info) => {
  test.skip(info.project.name === 'sombre', 'état partagé du serveur : un seul projet écrit');
  await open(page, '/threads');
  await page.getByRole('link', { name: /Crisis ferroviaria 2026/ }).click();
  await expect(page.locator('.timeline li')).toHaveCount(3);
  await page.getByRole('button', { name: 'Seguir este hilo' }).click();
  await expect(page.getByRole('button', { name: 'Hilo seguido' })).toHaveAttribute('aria-pressed', 'true');
  await page.reload();
  await expect(page.getByRole('button', { name: 'Hilo seguido' })).toBeVisible();
});

test('la page Santé signale le passage interrompu', async ({ page }) => {
  await open(page, '/sante');
  await expect(page.locator('.run')).toHaveCount(3);
  await expect(page.locator('.run[data-status="interrupted"] .st')).toHaveText('interrompu');
});

test('le manifeste et les icônes sont servis sans session', async ({ request }) => {
  const m = await request.get('/manifest.webmanifest');
  expect(m.status()).toBe(200);
  const manifest = await m.json();
  expect(manifest.display).toBe('standalone');
  for (const icon of manifest.icons) expect((await request.get(icon.src)).headers()['content-type']).toBe('image/png');
});
