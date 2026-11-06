import { readFileSync } from 'node:fs';
import { chromium } from 'playwright';
import type { Brief, Edition } from '@daily-brief/schema';
import { describe, expect, it } from 'vitest';
import { renderPdfHtml } from '../src/html';

const brief: Brief = JSON.parse(readFileSync(new URL('../../../fixtures/brief-2026-11-06.json', import.meta.url), 'utf8'));
const ed = (lang: string): Edition => structuredClone(brief.editions.find((e) => e.lang === lang)!);
const count = (s: string, re: RegExp) => (s.match(re) ?? []).length;

describe('renderPdfHtml', () => {
  it('rend les trois éditions dans l’ordre FR, EN, ES avec leur couverture', async () => {
    const html = await renderPdfHtml({ date: brief.date, issue: '001', editions: [ed('es'), ed('fr'), ed('en')] });
    const order = ['ed-fr', 'ed-en', 'ed-es'].map((id) => html.indexOf(`id="${id}"`));
    expect(order.every((i, k) => i > 0 && (k === 0 || i > order[k - 1]))).toBe(true);
    expect(html).toContain('Vendredi 6 novembre 2026 · N° 001');
    expect(html).toContain('La rue pousse Lecornu à négocier, le Sud-Est sous l’eau');
    expect(count(html, /<svg class="map"/g)).toBe(7);
    expect(count(html, /<article class="story">/g)).toBe(10);
    expect(count(html, /<svg class="qr"/g)).toBe(10);
    expect(count(html, /<table class="voc">/g)).toBe(2);
    expect(html).toContain('@font-face{font-family:"Geist";src:url(data:font/woff2;base64,d09G');
  });

  it('montre les chiffres du jour, les divergences, le lien prépa et la traduction', async () => {
    const html = await renderPdfHtml({ date: brief.date, issue: '001', editions: [ed('fr')] });
    expect(html).toContain('<h3 class="mono">Les chiffres du jour</h3>');
    expect(html).toContain('<b class="mono">Les sources divergent</b>');
    expect(html).toContain('<b>Lien prépa · Éco-droit</b>');
    expect(html).toMatch(/<p class="tr"><span class="mono">Traduction<\/span>Ils jouent au Far West/);
  });

  it('grise les éditions absentes et n’ajoute l’encart audio que si la durée est connue', async () => {
    const html = await renderPdfHtml({ date: brief.date, issue: '001', editions: [ed('fr')] }, { audio: { fr: { duration: '3:24' } } });
    expect(html).toContain('<a href="#ed-fr"');
    expect(html).toContain('<span>EN</span><span>ES</span>');
    expect(html).toContain('3:24 · voix Chirp HD');
    const en = ed('en');
    const st = en.sections[0].stories[0];
    st.quote = { text: 'We had a tough night, no question about it', speaker: 'John Thune', translation: null, sourceUrl: st.sources[0].url };
    const silent = await renderPdfHtml({ date: brief.date, issue: '001', editions: [en] });
    expect(silent).not.toContain('Version audio');
    expect(silent).toContain('<p>“We had a tough night, no question about it”</p>');
  });

  it('intègre une photo Pexels avec son crédit, et omet une photo non téléchargée', async () => {
    const fr = ed('fr');
    const story = fr.sections.find((s) => s.key === 'eco')!.stories[0];
    story.visual = {
      type: 'photo',
      query: 'car factory',
      pexels: { id: 1, src: 'https://images.pexels.com/1.jpeg', width: 6, height: 4, photographer: 'Jo Rails', photographerUrl: 'https://www.pexels.com/@jo', pexelsUrl: 'https://www.pexels.com/photo/1/' },
    };
    const withImg = await renderPdfHtml({ date: brief.date, issue: '001', editions: [fr] }, { images: { 'https://images.pexels.com/1.jpeg': 'data:image/jpeg;base64,AA' } });
    expect(withImg).toContain('<img src="data:image/jpeg;base64,AA" alt="car factory">');
    expect(withImg).toContain('Photo : <a href="https://www.pexels.com/@jo">Jo Rails</a>');
    const without = await renderPdfHtml({ date: brief.date, issue: '001', editions: [fr] });
    expect(without).not.toContain('<img');
  });

  it('échappe le texte venu du JSON', async () => {
    const fr = ed('fr');
    fr.headline = '<script>alert(1)</script> & co';
    const html = await renderPdfHtml({ date: brief.date, issue: '001', editions: [fr] });
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt; &amp; co');
    expect(html).not.toContain('<script>');
  });

  it('refuse un rendu sans édition', async () => {
    await expect(renderPdfHtml({ date: brief.date, issue: '001', editions: [] })).rejects.toThrow(/aucune édition/);
  });

  it('rejette une data URI d’image malveillante (injection) et omet la photo', async () => {
    const fr = ed('fr');
    const story = fr.sections.find((s) => s.key === 'eco')!.stories[0];
    const src = 'https://images.pexels.com/1.jpeg';
    story.visual = {
      type: 'photo',
      query: 'x',
      pexels: { id: 1, src, width: 6, height: 4, photographer: 'J', photographerUrl: 'https://www.pexels.com/@j', pexelsUrl: 'https://www.pexels.com/photo/1/' },
    };
    const evil = 'data:image/jpeg"><script>document.body.innerHTML="PWNED"</script><x a=";base64,AA';
    const html = await renderPdfHtml({ date: brief.date, issue: '001', editions: [fr] }, { images: { [src]: evil } });
    expect(html).not.toContain('<img');
    expect(html).not.toContain('<script');
  });

  it('met un lien par source (dédoublonné par URL), la source principale en premier', async () => {
    const fr = ed('fr');
    const st = fr.sections[0].stories[0];
    const base = st.sources[0];
    st.sources = [
      { ...base, outlet: 'Sud Radio', url: 'https://a.example/1', readFull: false },
      { ...base, outlet: 'AFP', url: 'https://a.example/2', readFull: true },
    ] as typeof st.sources;
    const html = await renderPdfHtml({ date: brief.date, issue: '001', editions: [fr] });
    const i1 = html.indexOf('<a href="https://a.example/1">');
    const i2 = html.indexOf('<a href="https://a.example/2">');
    expect(i1).toBeGreaterThan(0);
    expect(i2).toBeGreaterThan(0);
    expect(i2).toBeLessThan(i1);
  });

  it('n’émet pas de saut de page pour une édition sans sections ni vocabulaire', async () => {
    const fr = ed('fr');
    fr.sections = [];
    fr.vocab = null;
    const html = await renderPdfHtml({ date: brief.date, issue: '001', editions: [fr] });
    expect(html).not.toContain('class="pb"');
    expect(html).toContain('<section class="ed" id="ed-fr" lang="fr"');
  });

  it('garde la couverture lisible avec des chaînes très longues', { timeout: 60_000 }, async () => {
    const fr = structuredClone(brief.editions.find((e) => e.lang === 'fr')!);
    fr.headline = 'A'.repeat(200);
    fr.sections[0].title = 'Rubrique ' + 'z'.repeat(150);
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
        return { asideRight: aside.right, asideW: aside.width, audioW: audio.width, body: document.body.getBoundingClientRect().right, scroll: document.documentElement.scrollWidth, overflowing: [...document.querySelectorAll('#ed-fr .rubh h2, #ed-fr .aside .row')].filter((e) => e.getBoundingClientRect().right > document.body.getBoundingClientRect().right + 1).map((e) => e.className || e.tagName) };
      })()`)) as { asideRight: number; asideW: number; audioW: number; body: number; scroll: number; overflowing: string[] };
      expect(m.asideW).toBeGreaterThan(100);
      expect(m.audioW).toBeGreaterThan(50);
      expect(m.asideRight).toBeLessThanOrEqual(m.body + 1);
      expect(m.scroll).toBeLessThanOrEqual(800);
      expect(m.overflowing).toEqual([]);
    } finally {
      await browser.close();
    }
  });
});
