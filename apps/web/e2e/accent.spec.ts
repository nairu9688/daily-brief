import { expect, test, type Page } from '@playwright/test';
import { open } from './helpers';

/**
 * Accent de l'édition (design/app.css : FR bleu, EN vert, ES or). Garde-fou du bogue où l'accent restait
 * celui du premier chargement : la mise en page (app)/layout.tsx n'est pas re-rendue lors d'une navigation
 * côté client, son `data-ed` restait figé. On change d'onglet SANS recharger, puis on lit les styles calculés.
 */
const ACCENT = {
  clair: { fr: [62, 107, 255], en: [14, 159, 110], es: [200, 142, 0] },
  sombre: { fr: [123, 151, 255], en: [52, 211, 153], es: [255, 194, 51] },
} as const;

type Lang = 'fr' | 'en' | 'es';
const rgb = (c: readonly number[]) => `rgb(${c.join(', ')})`;

async function accents(page: Page) {
  return page.evaluate(() => {
    const color = (sel: string, prop: 'color' | 'backgroundImage' | 'borderTopColor' = 'color') => {
      const el = document.querySelector(sel);
      return el ? getComputedStyle(el)[prop] : null;
    };
    return {
      app: document.querySelector('.app')?.getAttribute('data-ed'),
      kicker: color('.mb .kicker .acc'),
      point: color('.points .n'),
      logo: color('.topbar .logo', 'backgroundImage'),
      tab: color('.topbar .editions a[aria-current="page"]', 'borderTopColor'),
    };
  });
}

for (const [from, to] of [
  ['fr', 'en'],
  ['en', 'es'],
  ['es', 'fr'],
  ['fr', 'es'],
] as [Lang, Lang][]) {
  test(`l’accent suit l’onglet : ${from} → ${to}, sans rechargement`, async ({ page }, info) => {
    const palette = ACCENT[info.project.name as 'clair' | 'sombre'];
    await open(page, `/?ed=${from}`);
    expect((await accents(page)).kicker).toBe(rgb(palette[from]));
    await page.locator(`.topbar .editions a[data-ed="${to}"]`).click();
    await expect(page.locator(`.edition[data-for="${to}"]`)).toBeVisible();
    // Bordure de l'onglet : transition de 0,2 s.
    await expect.poll(async () => (await accents(page)).tab).toBe(rgb(palette[to]));
    const a = await accents(page);
    expect(a.app).toBe(to);
    expect(a.kicker).toBe(rgb(palette[to]));
    expect(a.point).toBe(rgb(palette[to]));
    expect(a.logo).toContain(rgb(palette[to]));
    // Le choix survit au rechargement (cookie `ed` posé au clic ; les préchargements ne l'ont pas changé).
    await open(page, '/');
    expect((await accents(page)).kicker).toBe(rgb(palette[to]));
    await open(page, '/?ed=fr');
  });
}

test('l’accent de la barre latérale suit l’édition affichée (grand écran)', async ({ page }, info) => {
  const palette = ACCENT[info.project.name as 'clair' | 'sombre'];
  await page.setViewportSize({ width: 1366, height: 1024 });
  await open(page, '/?ed=fr');
  await page.locator('.side .editions a[data-ed="es"]').click();
  await expect(page.locator('.edition[data-for="es"]')).toBeVisible();
  const side = await page.evaluate(() => getComputedStyle(document.querySelector('.side .logo')!).backgroundImage);
  expect(side).toContain(rgb(palette.es));
  await expect(page.locator('.side .editions a[aria-current="page"]')).toHaveAttribute('data-ed', 'es');
  await open(page, '/?ed=fr');
});
