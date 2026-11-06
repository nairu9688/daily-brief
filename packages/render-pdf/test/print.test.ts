import { mkdtempSync, readFileSync } from 'node:fs';
import { chromium } from 'playwright';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Brief } from '@daily-brief/schema';
import { describe, expect, it } from 'vitest';
import { renderPdfHtml } from '../src/html';
import { footerTemplate, printPdf } from '../src/print';

const brief: Brief = JSON.parse(readFileSync(new URL('../../../fixtures/brief-2026-11-06.json', import.meta.url), 'utf8'));

describe('printPdf', () => {
  it('compose le pied de page : date, éditions, mention IA et pagination', () => {
    const f = footerTemplate({ date: '2026-11-06', langs: ['fr', 'es'] });
    expect(f).toContain('DAILY BRIEF · 06.11.2026 · FR · ES');
    expect(f).toContain('<span class="pageNumber"></span>/<span class="totalPages"></span>');
  });

  it('imprime la fixture en un PDF A4 d’environ 10 pages', { timeout: 60_000 }, async () => {
    const out = join(mkdtempSync(join(tmpdir(), 'pdf-')), 'Daily Brief 2026-11-06.pdf');
    await printPdf(await renderPdfHtml(brief), out, { date: brief.date, langs: ['fr', 'en', 'es'] });
    const pdf = readFileSync(out);
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
    const pages = (pdf.toString('latin1').match(/\/Type\s*\/Page[^s]/g) ?? []).length;
    expect(pages).toBeGreaterThanOrEqual(8);
    expect(pages).toBeLessThanOrEqual(14);
    expect(pdf.toString('latin1')).toMatch(/\/MediaBox\s*\[0 0 594\.9\d* 841\.9\d*\]/);
  });

  it('n’exécute pas de JavaScript à l’impression', { timeout: 60_000 }, async () => {
    const out = join(mkdtempSync(join(tmpdir(), 'pdf-')), 'x.pdf');
    const html = (await renderPdfHtml(brief)).replace('</body>', `<script>document.body.innerHTML='PWNED'</script></body>`);
    await printPdf(html, out, { date: brief.date, langs: ['fr'] });
    const pdf = readFileSync(out).toString('latin1');
    const pages = (pdf.match(/\/Type\s*\/Page[^s]/g) ?? []).length;
    expect(pages).toBeGreaterThanOrEqual(8);
  });

  it('rejette si l’impression dépasse le délai', async () => {
    const out = join(mkdtempSync(join(tmpdir(), 'pdf-')), 'x.pdf');
    await expect(printPdf('<p>x</p>', out, { date: brief.date, langs: ['fr'] }, { timeoutMs: 1 })).rejects.toThrow('impression PDF : délai dépassé');
  });

  it('garde la couverture lisible avec des chaînes très longues', { timeout: 60_000 }, async () => {
    const fr = structuredClone(brief.editions.find((e) => e.lang === 'fr')!);
    fr.headline = 'A'.repeat(200);
    fr.sections[0].stories[0].title = 'X'.repeat(300);
    fr.sections[0].stories[0].stats[0].value = '1'.repeat(40);
    const html = await renderPdfHtml({ date: brief.date, issue: '001', editions: [fr] }, { audio: { fr: { duration: '3:24' } } });
    const browser = await chromium.launch();
    try {
      const page = await browser.newPage({ viewport: { width: 800, height: 1200 } });
      await page.emulateMedia({ media: 'print' });
      await page.setContent(html, { waitUntil: 'load' });
      await page.addStyleTag({ content: 'body{width:182mm;margin:0 auto}' });
      // Robuste : on mesure la géométrie DOM plutôt que d’extraire du texte du PDF.
      const m = (await page.evaluate(`(() => {
        const r = (s) => document.querySelector(s).getBoundingClientRect();
        const aside = r('#ed-fr .aside'), audio = r('#ed-fr .audio');
        return { asideRight: aside.right, asideW: aside.width, audioW: audio.width, body: document.body.getBoundingClientRect().right, scroll: document.documentElement.scrollWidth };
      })()`)) as { asideRight: number; asideW: number; audioW: number; body: number; scroll: number };
      expect(m.asideW).toBeGreaterThan(100);
      expect(m.audioW).toBeGreaterThan(50);
      expect(m.asideRight).toBeLessThanOrEqual(m.body + 1);
      expect(m.scroll).toBeLessThanOrEqual(800);
    } finally {
      await browser.close();
    }
  });
});
