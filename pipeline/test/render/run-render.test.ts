import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseEdition } from '@daily-brief/schema';
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
    for (const l of ['fr', 'en', 'es']) expect(parseEdition(JSON.parse(readFileSync(join(dayDir, `${l}.final.json`), 'utf8'))).success).toBe(true);
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

  it('réécrit toujours le rapport : une impression en échec ne laisse ni PDF ni rapport périmé', async () => {
    const { outDir, dayDir } = day();
    writeFileSync(join(dayDir, 'render-report.json'), JSON.stringify({ exitCode: 0, pdf: 'old.pdf' }));
    const print = async (_h: string, outPath: string) => {
      writeFileSync(outPath, '%PDF-partiel');
      throw new Error('chromium absent');
    };
    const r = await runRender({ outDir, date: '2026-11-06', fetch: net().fetch, print });
    expect(r.exitCode).toBe(2);
    expect(r.pdfPath).toBeNull();
    expect(existsSync(join(dayDir, 'Daily Brief 2026-11-06.pdf'))).toBe(false);
    const report = JSON.parse(readFileSync(join(dayDir, 'render-report.json'), 'utf8'));
    expect(report.exitCode).toBe(2);
    expect(JSON.stringify(report.issues)).toContain('impression PDF impossible : chromium absent');
  });

  it('refuse une date antérieure au lancement sans rien écrire', async () => {
    const { outDir } = day();
    mkdirSync(join(outDir, '2026-11-05'), { recursive: true });
    for (const e of fixtureBrief().editions) writeFileSync(join(outDir, '2026-11-05', `${e.lang}.verified.json`), JSON.stringify(e));
    const r = await runRender({ outDir, date: '2026-11-05', fetch: net().fetch, print: printer().print });
    expect(r.exitCode).toBe(2);
    expect(existsSync(join(outDir, '2026-11-05', 'fr.final.json'))).toBe(false);
  });

  it('une photo Pexels invalide laisse le sujet sans photo et final.json valide', async () => {
    const { outDir, dayDir } = day(['fr']);
    const bad = structuredClone(search);
    bad.photos = [{ ...bad.photos[1], photographer: '' }];
    const n = fakeFetch({ 'https://api.pexels.com/v1/search': { json: bad } });
    const r = await runRender({ outDir, date: '2026-11-06', pexelsApiKey: 'k', fetch: n.fetch, print: printer().print });
    expect(r.exitCode).toBe(0);
    const fr = JSON.parse(readFileSync(join(dayDir, 'fr.final.json'), 'utf8'));
    expect(parseEdition(fr).success).toBe(true);
    expect(JSON.stringify(fr)).not.toContain('"pexels"');
    expect(r.issues).toContainEqual(expect.objectContaining({ message: expect.stringMatching(/photo Pexels invalide/) }));
  });
});
