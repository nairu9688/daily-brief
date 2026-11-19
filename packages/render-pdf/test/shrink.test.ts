import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Brief } from '@daily-brief/schema';
import { chromium } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { renderPdfHtml } from '../src/html';
import { printPdf } from '../src/print';
import { PHOTO_MAX_WIDTH, shrinkImages } from '../src/shrink';

const brief: Brief = JSON.parse(readFileSync(new URL('../../../fixtures/brief-2026-11-06.json', import.meta.url), 'utf8'));

/** Largeur et hauteur d'un JPEG (segment SOF0/SOF2) ou d'un PNG (IHDR). */
function size(dataUri: string): { width: number; height: number; bytes: number } {
  const buf = Buffer.from(dataUri.slice(dataUri.indexOf(',') + 1), 'base64');
  if (buf[0] === 0x89) return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20), bytes: buf.length };
  for (let i = 2; i < buf.length; ) {
    const marker = buf[i + 1];
    if (marker === 0xc0 || marker === 0xc2) return { height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7), bytes: buf.length };
    i += 2 + buf.readUInt16BE(i + 2);
  }
  throw new Error('pas un JPEG');
}

/**
 * Image de type photo, aussi lourde qu'une vignette Commons de 1920 px (≈ 0,5 à 0,8 Mo) :
 * dégradés, formes et grain, encodée par Chromium ; chaque appel donne une image différente (Chromium
 * fusionne les images identiques du PDF). Les tests n’ont ni photo réelle ni réseau.
 */
let heavy: (width: number, height: number, type?: 'jpeg' | 'png') => Promise<string>;
let close: () => Promise<void>;
let calls = 0;
beforeAll(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  heavy = (width, height, type = 'jpeg') =>
    page.evaluate(
      ({ width, height, type, start }) => {
        // Code exécuté dans la page : le projet ne charge pas les types DOM.
        const { document } = globalThis as unknown as { document: { createElement(tag: 'canvas'): any } };
        const c = document.createElement('canvas');
        c.width = width;
        c.height = height;
        const g = c.getContext('2d')!;
        let seed = start;
        const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
        const sky = g.createLinearGradient(0, 0, 0, height);
        sky.addColorStop(0, '#4a78b5');
        sky.addColorStop(1, '#e9c79a');
        g.fillStyle = sky;
        g.fillRect(0, 0, width, height);
        for (let i = 0; i < 400; i++) {
          g.fillStyle = `hsla(${rnd() * 360},${30 + rnd() * 40}%,${30 + rnd() * 40}%,0.5)`;
          g.beginPath();
          g.ellipse(rnd() * width, rnd() * height, 5 + rnd() * 120, 5 + rnd() * 60, rnd() * 3, 0, 7);
          g.fill();
        }
        const img = g.getImageData(0, 0, width, height);
        for (let i = 0; i < img.data.length; i += 4) {
          const n = (rnd() - 0.5) * 40;
          img.data[i] += n;
          img.data[i + 1] += n;
          img.data[i + 2] += n;
        }
        g.putImageData(img, 0, 0);
        return c.toDataURL(`image/${type}`, 0.9);
      },
      { width, height, type, start: ++calls * 7919 },
    );
  close = () => browser.close();
}, 60_000);
afterAll(async () => close?.());

describe('shrinkImages', () => {
  it('réduit une vignette de 1920 px à 1000 px de large au plus, en JPEG plus léger, proportions gardées', { timeout: 60_000 }, async () => {
    const src = await heavy(1920, 1280);
    expect(size(src).bytes).toBeGreaterThan(400_000);
    const { images, stats } = await shrinkImages({ 'https://thumb.wikimedia.org/a.jpg': src });
    const out = images['https://thumb.wikimedia.org/a.jpg'];
    expect(out).toMatch(/^data:image\/jpeg;base64,/);
    const s = size(out);
    expect(s.width).toBe(PHOTO_MAX_WIDTH);
    expect(s.height).toBe(Math.round((1280 * PHOTO_MAX_WIDTH) / 1920));
    expect(s.bytes).toBeLessThan(size(src).bytes / 2);
    expect(stats).toEqual({ images: 1, before: size(src).bytes, after: s.bytes });
  });

  it('ne grossit pas une image étroite et garde l’original quand le réencodage ne gagne rien', { timeout: 60_000 }, async () => {
    const small = await heavy(800, 500);
    const { images } = await shrinkImages({ s: small });
    expect(size(images.s).width).toBe(800);
    expect(size(images.s).bytes).toBeLessThanOrEqual(size(small).bytes);
  });

  it('convertit un PNG en JPEG sur fond blanc', { timeout: 60_000 }, async () => {
    const png = await heavy(1600, 1000, 'png');
    const { images } = await shrinkImages({ p: png });
    expect(images.p).toMatch(/^data:image\/jpeg;base64,/);
    expect(size(images.p).width).toBe(PHOTO_MAX_WIDTH);
  });

  it('garde telle quelle une image illisible ; une table vide ne lance pas Chromium', { timeout: 60_000 }, async () => {
    const broken = 'data:image/jpeg;base64,/9j/AAAA';
    expect((await shrinkImages({ b: broken })).images.b).toBe(broken);
    expect(await shrinkImages({})).toEqual({ images: {}, stats: { images: 0, before: 0, after: 0 } });
  });
});

describe('poids du PDF', () => {
  it('la fixture, chaque sujet illustré d’une vignette lourde, pèse moins de 200 Ko de plus par photo une fois les photos réduites', { timeout: 120_000 }, async () => {
    // Chaque sujet de la fixture reçoit une photo : le pire cas, aucune carte.
    const illustrated: Brief = structuredClone(brief);
    const srcs: string[] = [];
    for (const e of illustrated.editions)
      for (const sec of e.sections)
        for (const st of sec.stories) {
          const src = `https://thumb.wikimedia.org/wikipedia/commons/thumb/a/ab/P${srcs.length}.jpg/1920px-P${srcs.length}.jpg`;
          srcs.push(src);
          st.visual = { type: 'photo', query: 'x', photo: { provider: 'wikimedia', src, width: 1920, height: 1280, author: 'P', license: 'CC BY-SA 4.0', licenseUrl: 'https://creativecommons.org/licenses/by-sa/4.0', pageUrl: 'https://commons.wikimedia.org/wiki/File:P.jpg' } };
        }
    expect(srcs.length).toBeGreaterThanOrEqual(6);
    const raw: Record<string, string> = {};
    for (const src of srcs) raw[src] = await heavy(1920, 1280);
    const dir = mkdtempSync(join(tmpdir(), 'pdf-poids-'));
    const print = async (images: Record<string, string>, name: string) => {
      const out = join(dir, name);
      await printPdf(await renderPdfHtml(illustrated, { images }), out, { date: brief.date, langs: ['fr', 'en', 'es'] });
      return readFileSync(out).length;
    };
    const bare = await print({}, 'sans-photo.pdf');
    const before = await print(raw, 'avant.pdf');
    const after = await print((await shrinkImages(raw)).images, 'apres.pdf');
    // Mesuré : ≈ 1 Mo par photo avant, ≈ 125 Ko après (images de test plus granuleuses que de vraies photos).
    // 15 sujets × 3 éditions ≈ 45 photos : 45 × 200 Ko ≈ 9 Mo au pire.
    expect((after - bare) / srcs.length).toBeLessThan(200_000);
    expect(after).toBeLessThan(before / 4);
  });
});
