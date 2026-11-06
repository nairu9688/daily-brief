import { mkdtempSync, readFileSync } from 'node:fs';
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
});
