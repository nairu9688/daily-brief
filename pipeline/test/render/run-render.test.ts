import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseEdition } from '@daily-brief/schema';
import type { PexelsPhoto } from '@daily-brief/schema';
import type { FooterInfo } from '@daily-brief/render-pdf';
import { PexelsHttpError } from '../../render/pexels';
import { runRender } from '../../render/run-render';
import { fixtureBrief, repoPath } from '../helpers';
import { fakeFetch } from './fake-fetch';

const search = JSON.parse(readFileSync(repoPath('fixtures/api/pexels-search.json'), 'utf8'));

const photo = (id: number): PexelsPhoto => ({
  id,
  src: `https://images.pexels.com/photos/${id}/p.jpeg`,
  width: 6000,
  height: 4000,
  photographer: 'P',
  photographerUrl: 'https://www.pexels.com/@p',
  pexelsUrl: `https://www.pexels.com/photo/${id}/`,
});

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

  it('après un 429, Pexels n’est plus appelé et un seul avertissement est émis, le PDF est produit', async () => {
    const { outDir } = day();
    const n = fakeFetch({ 'https://api.pexels.com/v1/search': { status: 429, json: {} } });
    const { print, printed } = printer();
    const r = await runRender({ outDir, date: '2026-11-06', pexelsApiKey: 'k', fetch: n.fetch, print });
    expect(r.exitCode).toBe(0);
    expect(printed).toHaveLength(1);
    expect(n.calls).toHaveLength(1);
    const msgs = r.issues.map((i) => i.message).filter((m) => /Pexels/.test(m));
    expect(msgs).toEqual(['Pexels indisponible (429) : photos omises']);
  });

  it('une image non téléchargée donne un avertissement et le PDF est quand même produit', async () => {
    const { outDir } = day(['fr']);
    const n = fakeFetch({
      'https://api.pexels.com/v1/search': { json: search },
      'https://images.pexels.com/': { status: 500 },
    });
    const r = await runRender({ outDir, date: '2026-11-06', pexelsApiKey: 'k', fetch: n.fetch, print: printer().print });
    expect(r.exitCode).toBe(0);
    expect(r.issues).toContainEqual(expect.objectContaining({ level: 'warning', message: expect.stringMatching(/image Pexels non téléchargée/) }));
  });

  it('supprime un fr.final.json périmé quand fr.verified.json est absent', async () => {
    const { outDir, dayDir } = day(['en']);
    writeFileSync(join(dayDir, 'fr.final.json'), '{"vieux":true}');
    await runRender({ outDir, date: '2026-11-06', fetch: net().fetch, print: printer().print });
    expect(existsSync(join(dayDir, 'fr.final.json'))).toBe(false);
  });

  it('le rapport liste les finals et le nom du PDF, sans chemin ni clé API', async () => {
    const { outDir, dayDir } = day(['fr', 'es']);
    const r = await runRender({ outDir, date: '2026-11-06', pexelsApiKey: 'SECRETKEY', fetch: net().fetch, print: printer().print });
    expect(r.finals).toEqual(['fr', 'es']);
    const raw = readFileSync(join(dayDir, 'render-report.json'), 'utf8');
    expect(JSON.parse(raw)).toMatchObject({ finals: ['fr', 'es'], pdf: 'Daily Brief 2026-11-06.pdf' });
    expect(raw).not.toContain('SECRETKEY');
    for (const l of ['fr', 'es']) expect(readFileSync(join(dayDir, `${l}.final.json`), 'utf8')).not.toContain('SECRETKEY');
  });

  it('PDF impossible : finals listés dans le rapport, pdf null, code 2', async () => {
    const { outDir, dayDir } = day(['fr']);
    const print = async () => {
      throw new Error('boom');
    };
    const r = await runRender({ outDir, date: '2026-11-06', fetch: net().fetch, print });
    expect(r.exitCode).toBe(2);
    expect(JSON.parse(readFileSync(join(dayDir, 'render-report.json'), 'utf8'))).toMatchObject({ finals: ['fr'], pdf: null, exitCode: 2 });
  });

  it('ignore une édition dont la langue ou la date ne correspond pas à son fichier', async () => {
    const { outDir, dayDir } = day(['fr', 'en']);
    const en = JSON.parse(readFileSync(join(dayDir, 'en.verified.json'), 'utf8'));
    writeFileSync(join(dayDir, 'fr.verified.json'), JSON.stringify(en));
    writeFileSync(join(dayDir, 'en.verified.json'), JSON.stringify({ ...en, date: '2026-11-05' }));
    const r = await runRender({ outDir, date: '2026-11-06', fetch: net().fetch, print: printer().print });
    expect(r.exitCode).toBe(2);
    expect(r.finals).toEqual([]);
    expect(r.issues).toContainEqual(expect.objectContaining({ lang: 'fr', level: 'error', message: expect.stringMatching(/fr\.verified\.json contient l’édition en du 2026-11-06/) }));
    expect(r.issues).toContainEqual(expect.objectContaining({ lang: 'en', level: 'error', message: expect.stringMatching(/contient l’édition en du 2026-11-05/) }));
    expect(existsSync(join(dayDir, 'fr.final.json'))).toBe(false);
  });

  it('un 401 coupe Pexels dès le premier appel et le PDF est produit', async () => {
    const { outDir } = day();
    const n = fakeFetch({ 'https://api.pexels.com/v1/search': { status: 401, json: {} } });
    const r = await runRender({ outDir, date: '2026-11-06', pexelsApiKey: 'k', fetch: n.fetch, print: printer().print });
    expect(r.exitCode).toBe(0);
    expect(n.calls).toHaveLength(1);
    expect(r.issues.filter((i) => /Pexels/.test(i.message)).map((i) => i.message)).toEqual(['Pexels indisponible (401) : photos omises']);
  });

  it('un délai dépassé coupe Pexels : un seul appel, un seul avertissement', async () => {
    const { outDir } = day();
    const n = fakeFetch({ 'https://api.pexels.com/v1/search': { hang: true } });
    const r = await runRender({ outDir, date: '2026-11-06', pexelsApiKey: 'k', fetch: n.fetch, print: printer().print, pexelsTimeoutMs: 20 });
    expect(r.exitCode).toBe(0);
    expect(n.calls).toHaveLength(1);
    expect(r.issues.filter((i) => /Pexels/.test(i.message)).map((i) => i.message)).toEqual(['Pexels indisponible (délai dépassé) : photos omises']);
  });

  it('une requête en 500 laisse seulement ce sujet sans photo, les autres gardent la leur', async () => {
    const { outDir, dayDir } = day(['fr']);
    const find = async (q: string) => {
      if (q === 'car factory') throw new PexelsHttpError(500, q);
      return photo(7);
    };
    const r = await runRender({ outDir, date: '2026-11-06', pexelsApiKey: 'k', fetch: net().fetch, print: printer().print, findPhoto: find });
    expect(r.exitCode).toBe(0);
    const fr = JSON.parse(readFileSync(join(dayDir, 'fr.final.json'), 'utf8'));
    const photos = fr.sections.flatMap((s: any) => s.stories).filter((st: any) => st.visual.type === 'photo');
    expect(photos.map((st: any) => [st.visual.query, !!st.visual.pexels])).toEqual([['car factory', false], ['high-speed train', true]]);
    expect(r.issues.filter((i) => /Pexels/.test(i.message))).toHaveLength(1);
  });

  it('mémoïse les recherches entre langues : un appel par requête distincte', async () => {
    const { outDir } = day();
    const n = net();
    await runRender({ outDir, date: '2026-11-06', pexelsApiKey: 'k', fetch: n.fetch, print: printer().print });
    const queries = new Set(
      fixtureBrief().editions.flatMap((e) => e.sections.flatMap((s) => s.stories.flatMap((st) => (st.visual.type === 'photo' ? [st.visual.query] : [])))),
    );
    expect(n.calls.filter((c) => c.url.startsWith('https://api.pexels.com/v1/search'))).toHaveLength(queries.size);
  });

  it('repli sur l’édition vérifiée, sans photo, si la photo rend l’édition invalide', async () => {
    const { outDir, dayDir } = day(['fr']);
    const find = async () => ({ ...photo(9), photographer: '' });
    const r = await runRender({ outDir, date: '2026-11-06', pexelsApiKey: 'k', fetch: net().fetch, print: printer().print, findPhoto: find });
    const fr = JSON.parse(readFileSync(join(dayDir, 'fr.final.json'), 'utf8'));
    expect(parseEdition(fr).success).toBe(true);
    expect(JSON.stringify(fr)).not.toContain('"pexels"');
    expect(r.issues).toContainEqual(expect.objectContaining({ level: 'error', lang: 'fr', message: expect.stringMatching(/édition finale invalide/) }));
  });

  it('écrit le rapport même sur une exception inattendue', async () => {
    const { outDir, dayDir } = day(['fr']);
    mkdirSync(join(dayDir, 'fr.final.json', 'x'), { recursive: true });
    const r = await runRender({ outDir, date: '2026-11-06', fetch: net().fetch, print: printer().print });
    expect(r.exitCode).toBe(2);
    const report = JSON.parse(readFileSync(join(dayDir, 'render-report.json'), 'utf8'));
    expect(report.exitCode).toBe(2);
    expect(JSON.stringify(report.issues)).toMatch(/erreur inattendue/);
  });

  it('langs du rapport = langues du PDF : vide sans PDF', async () => {
    const { outDir, dayDir } = day(['fr']);
    const print = async () => {
      throw new Error('boom');
    };
    const r = await runRender({ outDir, date: '2026-11-06', fetch: net().fetch, print });
    expect(r.langs).toEqual([]);
    expect(JSON.parse(readFileSync(join(dayDir, 'render-report.json'), 'utf8'))).toMatchObject({ langs: [], finals: ['fr'] });
  });

  it('ignore les clés inconnues d’audio.json', async () => {
    const { outDir, dayDir } = day(['fr']);
    writeFileSync(join(dayDir, 'audio.json'), JSON.stringify({ fr: { duration: '3:24' }, generatedAt: 'x' }));
    const { print, printed } = printer();
    const r = await runRender({ outDir, date: '2026-11-06', fetch: net().fetch, print });
    expect(r.issues.some((i) => /audio\.json/.test(i.message))).toBe(false);
    expect(printed[0].html).toContain('3:24 · voix Chirp HD');
  });
});
