import { expect, type Page } from '@playwright/test';

/** Port du second serveur de test, visiteur sans session (FIXTURE_VISITOR=1) : lecture publique. */
export const VISITOR_PORT = 3211;

/** Erreurs de la console et de la page (une violation de CSP apparaît ici). */
export function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  page.on('pageerror', (e) => errors.push(String(e)));
  return errors;
}

/** Page chargée, polices prêtes. */
export async function open(page: Page, path: string): Promise<void> {
  const r = await page.goto(path);
  expect(r?.status(), path).toBe(200);
  await page.evaluate(() => document.fonts.ready);
}

/** Aucun défilement horizontal à 390 px. */
export async function expectNoHorizontalOverflow(page: Page): Promise<void> {
  const width = await page.evaluate(() => Math.max(document.documentElement.scrollWidth, document.body.scrollWidth));
  expect(width).toBeLessThanOrEqual(390);
}
