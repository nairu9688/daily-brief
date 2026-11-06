import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { FooterInfo } from '@daily-brief/render-pdf';
import { runRender } from '../../render/run-render';
import { fixtureBrief, repoPath } from '../helpers';
import { fakeFetch } from './fake-fetch';

const search = JSON.parse(readFileSync(repoPath('fixtures/api/pexels-search.json'), 'utf8'));

function day(langs = ['fr', 'en', 'es']) {
  const outDir = mkdtempSync(join(tmpdir(), 'render-'));
  const dayDir = join(outDir, '2026-11-06');
  mkdirSync(dayDir, { recursive: true });
  for (const e of fixtureBrief().editions) if (langs.includes(e.lang)) writeFileSync(join(dayDir, `${e.lang}.verified.json`), JSON.stringify(e));
  return { outDir, dayDir };
}

function printer() {
  const printed: { html: string; outPath: string; footer: FooterInfo }[] = [];
  const print = async (html: string, outPath: string, footer: FooterInfo) => {
    printed.push({ html, outPath, footer });
    writeFileSync(outPath, '%PDF-fake');
  };
  return { print, printed };
}

const net = () =>
  fakeFetch({
    'https://api.pexels.com/v1/search': { json: search },
    'https://images.pexels.com/': { body: new Uint8Array([255, 216, 255]), type: 'image/jpeg' },
  });

describe('runRender', () => {
  it('complète les photos, écrit les éditions finales, le PDF et le rapport', async () => {
    const { outDir, dayDir } = day();
    const { print, printed } = printer();
    const r = await runRender({ outDir, date: '2026-11-06', pexelsApiKey: 'k', fetch: net().fetch, print });
    expect(r.exitCode).toBe(0);
    expect(r.pdfPath).toBe(join(dayDir, 'Daily Brief 2026-11-06.pdf'));
    expect(existsSync(r.pdfPath!)).toBe(true);
    expect(printed[0].footer).toEqual({ date: '2026-11-06', langs: ['fr', 'en', 'es'] });
    expect(printed[0].html).toContain('src="data:image/jpeg;base64,/9j/"');
    expect(printed[0].html).toContain('N° 001');
    const fr = JSON.parse(readFileSync(join(dayDir, 'fr.final.json'), 'utf8'));
    const photo = fr.sections.flatMap((s: { stories: { visual: { type: string; pexels?: { id: number } } }[] }) => s.stories).find((st: { visual: { type: string } }) => st.visual.type === 'photo');
    expect(photo.visual.pexels.id).toBe(2002);
    const report = JSON.parse(readFileSync(join(dayDir, 'render-report.json'), 'utf8'));
    expect(report).toMatchObject({ exitCode: 0, langs: ['fr', 'en', 'es'] });
  });

  it('rend les éditions présentes et ajoute l’encart audio si audio.json existe', async () => {
    const { outDir, dayDir } = day(['fr']);
    writeFileSync(join(dayDir, 'audio.json'), JSON.stringify({ fr: { duration: '3:24' } }));
    const { print, printed } = printer();
    const r = await runRender({ outDir, date: '2026-11-06', fetch: net().fetch, print });
    expect(r.langs).toEqual(['fr']);
    expect(r.issues).toContainEqual(expect.objectContaining({ lang: 'en', level: 'warning' }));
    expect(r.issues).toContainEqual(expect.objectContaining({ lang: 'fr', message: expect.stringMatching(/PEXELS_API_KEY/) }));
    expect(printed[0].html).toContain('3:24 · voix Chirp HD');
    expect(printed[0].footer.langs).toEqual(['fr']);
  });

  it('ignore un audio.json illisible avec un avertissement', async () => {
    const { outDir, dayDir } = day(['fr']);
    writeFileSync(join(dayDir, 'audio.json'), JSON.stringify({ fr: { duration: '' } }));
    const { print, printed } = printer();
    const r = await runRender({ outDir, date: '2026-11-06', fetch: net().fetch, print });
    expect(r.exitCode).toBe(0);
    expect(r.issues).toContainEqual(expect.objectContaining({ message: expect.stringMatching(/audio\.json illisible/) }));
    expect(printed[0].html).not.toContain('Version audio');
  });

  it('sans édition valide : pas de PDF, code 2', async () => {
    const { outDir, dayDir } = day([]);
    writeFileSync(join(dayDir, 'fr.verified.json'), '{');
    const { print, printed } = printer();
    const r = await runRender({ outDir, date: '2026-11-06', fetch: net().fetch, print });
    expect(r.exitCode).toBe(2);
    expect(printed).toHaveLength(0);
    expect(r.issues).toContainEqual(expect.objectContaining({ lang: 'fr', level: 'error' }));
  });

  it('refuse une date invalide', async () => {
    const r = await runRender({ outDir: tmpdir(), date: '2026-13-45', fetch: net().fetch, print: printer().print });
    expect(r.exitCode).toBe(2);
  });
});
