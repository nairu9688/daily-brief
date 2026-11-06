import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import pixelmatch from 'pixelmatch';
import { chromium, type Browser } from 'playwright';
import { PNG } from 'pngjs';
import type { Brief } from '@daily-brief/schema';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { renderPdfHtml } from '../src/html';

/**
 * Test visuel du PDF (spec §13) : capture des zones clés du gabarit en mode impression,
 * comparées pixel à pixel aux références de test/__screens__ (écart toléré : 1 % des pixels).
 * Mettre à jour les références après un changement voulu : UPDATE_VISUAL=1 npx vitest run packages/render-pdf/test/visual.test.ts
 */
const SCREENS = fileURLToPath(new URL('./__screens__/', import.meta.url));
const DIFFS = fileURLToPath(new URL('../../../out/visual/', import.meta.url));
const UPDATE = process.env.UPDATE_VISUAL === '1';
const MAX_DIFF_RATIO = 0.01;

const SHOTS = [
  { name: 'couverture-fr', selector: '#ed-fr > .lead' },
  { name: 'sujet-fr-1', selector: '#ed-fr .story' },
  { name: 'vocab-es', selector: '#ed-es .voc' },
];

const brief: Brief = JSON.parse(readFileSync(new URL('../../../fixtures/brief-2026-11-06.json', import.meta.url), 'utf8'));

describe('rendu visuel du PDF', () => {
  let browser: Browser;
  let html: string;
  beforeAll(async () => {
    browser = await chromium.launch();
    html = await renderPdfHtml(brief, { audio: { fr: { duration: '3:24' } } });
  }, 60_000);
  afterAll(async () => browser?.close());

  for (const shot of SHOTS) {
    it(`${shot.name} correspond à la référence`, { timeout: 60_000 }, async () => {
      const page = await browser.newPage({ viewport: { width: 800, height: 1200 }, deviceScaleFactor: 1 });
      await page.emulateMedia({ media: 'print' });
      await page.setContent(html, { waitUntil: 'load' });
      await page.addStyleTag({ content: 'body{width:182mm;margin:0 auto;background:#fff}' });
      await page.evaluate('document.fonts.ready');
      const actual = PNG.sync.read(await page.locator(shot.selector).first().screenshot({ animations: 'disabled' }));
      await page.close();

      const refPath = `${SCREENS}${shot.name}.png`;
      if (UPDATE || !existsSync(refPath)) {
        if (!UPDATE) throw new Error(`référence absente : ${refPath} (lance UPDATE_VISUAL=1 pour la créer, puis vérifie l’image)`);
        mkdirSync(SCREENS, { recursive: true });
        writeFileSync(refPath, PNG.sync.write(actual));
        return;
      }
      const expected = PNG.sync.read(readFileSync(refPath));
      expect(`${actual.width}×${actual.height}`).toBe(`${expected.width}×${expected.height}`);
      const diff = new PNG({ width: actual.width, height: actual.height });
      const changed = pixelmatch(actual.data, expected.data, diff.data, actual.width, actual.height, { threshold: 0.1 });
      const ratio = changed / (actual.width * actual.height);
      if (ratio > MAX_DIFF_RATIO) {
        mkdirSync(DIFFS, { recursive: true });
        writeFileSync(`${DIFFS}${shot.name}.diff.png`, PNG.sync.write(diff));
        writeFileSync(`${DIFFS}${shot.name}.actual.png`, PNG.sync.write(actual));
      }
      expect(ratio, `${(ratio * 100).toFixed(2)} % de pixels différents, voir out/visual/`).toBeLessThanOrEqual(MAX_DIFF_RATIO);
    });
  }
});
