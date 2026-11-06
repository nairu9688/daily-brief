import { chromium } from 'playwright';
import type { Lang } from '@daily-brief/schema';
import { fontBase64 } from './assets';
import { dottedDate } from './format';

export type FooterInfo = { date: string; langs: Lang[] };

/** Pied de page : « DAILY BRIEF · 06.11.2026 · FR · EN · ES » à gauche, mention IA et pagination à droite. */
export function footerTemplate(info: FooterInfo): string {
  const { mono } = fontBase64();
  const left = ['DAILY BRIEF', dottedDate(info.date), ...info.langs.map((l) => l.toUpperCase())].join(' · ');
  return `<style>@font-face{font-family:"Geist Mono";src:url(data:font/woff2;base64,${mono}) format("woff2")}</style>
<div style="width:100%;margin:0 14mm;display:flex;justify-content:space-between;font:5.6pt 'Geist Mono',monospace;letter-spacing:.06em;color:#8C8D93;text-transform:uppercase">
<span>${left}</span><span>Résumés IA à partir des articles cités · <span class="pageNumber"></span>/<span class="totalPages"></span></span></div>`;
}

/** Imprime le HTML en PDF A4 avec Chromium (Playwright), polices et couleurs comprises. */
export async function printPdf(html: string, outPath: string, footer: FooterInfo): Promise<void> {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'load' });
    await page.evaluate('document.fonts.ready');
    await page.pdf({
      path: outPath,
      format: 'A4',
      printBackground: true,
      preferCSSPageSize: true,
      displayHeaderFooter: true,
      headerTemplate: '<span></span>',
      footerTemplate: footerTemplate(footer),
    });
  } finally {
    await browser.close();
  }
}
