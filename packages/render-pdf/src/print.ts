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

/** Imprime le HTML en PDF A4 avec Chromium (Playwright), polices et couleurs comprises. JavaScript désactivé. */
export async function printPdf(html: string, outPath: string, footer: FooterInfo, opts: { timeoutMs?: number } = {}): Promise<void> {
  const timeoutMs = opts.timeoutMs ?? 120_000;
  const browser = await chromium.launch({ timeout: Math.max(timeoutMs, 30_000) });
  let timer: NodeJS.Timeout | undefined;
  try {
    const work = (async () => {
      const page = await browser.newPage({ javaScriptEnabled: false });
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
    })();
    work.catch(() => {}); // évite un rejet non géré si le délai l'emporte puis que le navigateur se ferme
    const deadline = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error('impression PDF : délai dépassé')), timeoutMs);
    });
    await Promise.race([work, deadline]);
  } finally {
    clearTimeout(timer);
    // Une fermeture bloquée ne doit pas bloquer la routine : on abandonne après 5 s.
    let closeTimer: NodeJS.Timeout | undefined;
    await Promise.race([
      browser.close().catch(() => {}),
      new Promise<void>((resolve) => {
        closeTimer = setTimeout(resolve, 5_000);
      }),
    ]);
    clearTimeout(closeTimer);
  }
}
