import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseEdition } from '@daily-brief/schema';
import type { FooterInfo } from '@daily-brief/render-pdf';
import { HttpError } from '../../collect/http';
import { COMMONS_API } from '../../render/commons';
import { runRender } from '../../render/run-render';
import { fixtureBrief, repoPath } from '../helpers';
import { fakeFetch } from './fake-fetch';
import { photo } from './photo';

const search = JSON.parse(readFileSync(repoPath('fixtures/api/commons-search.json'), 'utf8'));
const TGV_PAGE = 'https://commons.wikimedia.org/wiki/File:SNCF_TGV_Duplex_Viaduc_de_Cize_-_Bolozon.jpg';

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
    [COMMONS_API]: { json: search },
    'https://thumb.wikimedia.org/': { body: new Uint8Array([255, 216, 255]), type: 'image/jpeg' },
    'https://upload.wikimedia.org/': { body: new Uint8Array([255, 216, 255]), type: 'image/jpeg' },
  });

describe('runRender', () => {
  it('complète les photos, écrit les éditions finales, le PDF et le rapport', async () => {
    const { outDir, dayDir } = day();
    const { print, printed } = printer();
    const r = await runRender({ outDir, date: '2026-11-06', fetch: net().fetch, print });
    expect(r.exitCode).toBe(0);
    expect(r.pdfPath).toBe(join(dayDir, 'Daily Brief 2026-11-06.pdf'));
    expect(existsSync(r.pdfPath!)).toBe(true);
    expect(printed[0].footer).toEqual({ date: '2026-11-06', langs: ['fr', 'en', 'es'] });
    expect(printed[0].html).toContain('src="data:image/jpeg;base64,/9j/"');
    expect(printed[0].html).toContain('N° 001');
    const fr = JSON.parse(readFileSync(join(dayDir, 'fr.final.json'), 'utf8'));
    const story = fr.sections.flatMap((s: { stories: { visual: { type: string; photo?: { pageUrl: string } } }[] }) => s.stories).find((st: { visual: { type: string } }) => st.visual.type === 'photo');
    expect(story.visual.photo.pageUrl).toBe(TGV_PAGE);
    expect(printed[0].html).toContain('· Wikimedia Commons');
    const report = JSON.parse(readFileSync(join(dayDir, 'render-report.json'), 'utf8'));
    expect(report).toMatchObject({ exitCode: 0, langs: ['fr', 'en', 'es'] });
    for (const l of ['fr', 'en', 'es']) expect(parseEdition(JSON.parse(readFileSync(join(dayDir, `${l}.final.json`), 'utf8'))).success).toBe(true);
  });

  it('rend les éditions présentes et ajoute l’encart audio si audio.json existe', async () => {
    const { outDir, dayDir } = day(['fr']);
    writeFileSync(join(dayDir, 'audio.json'), JSON.stringify({ fr: { duration: '3:24' } }));
    const { print, printed } = printer();
    const n = net();
    const r = await runRender({ outDir, date: '2026-11-06', fetch: n.fetch, print, photoLookup: false });
    expect(r.langs).toEqual(['fr']);
    expect(r.issues).toContainEqual(expect.objectContaining({ lang: 'en', level: 'warning' }));
    expect(r.issues).toContainEqual(expect.objectContaining({ lang: 'fr', message: 'recherche de photos désactivée : sujets illustrés rendus sans photo' }));
    expect(n.calls).toEqual([]);
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

  it('sans photo convenable (licence NC, hôte inconnu) : aplat, avertissement, final.json valide', async () => {
    const { outDir, dayDir } = day(['fr']);
    const bad = structuredClone(search);
    for (const p of bad.query.pages) {
      p.imageinfo[0].extmetadata.LicenseShortName = { value: 'CC BY-NC-SA 4.0' };
      p.imageinfo[0].thumburl = 'http://169.254.169.254/x.jpg';
    }
    const n = fakeFetch({ [COMMONS_API]: { json: bad }, http: { body: new Uint8Array([1]), type: 'image/jpeg' } });
    const r = await runRender({ outDir, date: '2026-11-06', fetch: n.fetch, print: printer().print });
    expect(r.exitCode).toBe(0);
    const fr = JSON.parse(readFileSync(join(dayDir, 'fr.final.json'), 'utf8'));
    expect(parseEdition(fr).success).toBe(true);
    expect(JSON.stringify(fr)).not.toContain('"photo":');
    expect(r.issues).toContainEqual(expect.objectContaining({ level: 'warning', lang: 'fr', message: expect.stringMatching(/aucune photo libre sur Wikimedia Commons pour « car factory »/) }));
    expect(n.calls.every((c) => c.url.startsWith(COMMONS_API))).toBe(true);
  });

  it('après un 429, Commons n’est plus appelé et un seul avertissement est émis, le PDF est produit', async () => {
    const { outDir } = day();
    const n = fakeFetch({ [COMMONS_API]: { status: 429, json: {} } });
    const { print, printed } = printer();
    const r = await runRender({ outDir, date: '2026-11-06', fetch: n.fetch, print });
    expect(r.exitCode).toBe(0);
    expect(printed).toHaveLength(1);
    expect(n.calls).toHaveLength(1);
    const msgs = r.issues.map((i) => i.message).filter((m) => /Commons/.test(m));
    expect(msgs).toEqual(['Wikimedia Commons indisponible (HTTP 429) : photos omises']);
  });

  it('réduit les photos avant de les insérer dans le PDF ; un échec de réduction garde les originaux avec un avertissement', async () => {
    const { outDir } = day(['fr']);
    const seen: Record<string, string>[] = [];
    const { print, printed } = printer();
    await runRender({
      outDir,
      date: '2026-11-06',
      fetch: net().fetch,
      print,
      shrink: async (images) => {
        seen.push(images);
        return { images: Object.fromEntries(Object.keys(images).map((k) => [k, 'data:image/jpeg;base64,UkVEVUlU'])), stats: { images: 1, before: 3, after: 2 } };
      },
    });
    expect(Object.values(seen[0])).toEqual(['data:image/jpeg;base64,/9j/']);
    expect(printed[0].html).toContain('src="data:image/jpeg;base64,UkVEVUlU"');
    expect(printed[0].html).not.toContain('base64,/9j/"');

    const second = day(['fr']);
    const p2 = printer();
    const r = await runRender({
      outDir: second.outDir,
      date: '2026-11-06',
      fetch: net().fetch,
      print: p2.print,
      shrink: async (images) => ({ images, stats: { images: 1, before: 3, after: 3 }, error: 'réduction des photos : délai dépassé' }),
    });
    expect(r.exitCode).toBe(0);
    expect(p2.printed[0].html).toContain('src="data:image/jpeg;base64,/9j/"');
    expect(r.issues).toContainEqual({ level: 'warning', message: 'photos non réduites (réduction des photos : délai dépassé) : PDF plus lourd' });
  });

  it('une image non téléchargée donne un avertissement et le PDF est quand même produit', async () => {
    const { outDir } = day(['fr']);
    const n = fakeFetch({
      [COMMONS_API]: { json: search },
      'https://thumb.wikimedia.org/': { status: 500 },
    });
    const r = await runRender({ outDir, date: '2026-11-06', fetch: n.fetch, print: printer().print });
    expect(r.exitCode).toBe(0);
    expect(r.issues).toContainEqual(expect.objectContaining({ level: 'warning', message: expect.stringMatching(/image Wikimedia non téléchargée/) }));
  });

  it('supprime un fr.final.json périmé quand fr.verified.json est absent', async () => {
    const { outDir, dayDir } = day(['en']);
    writeFileSync(join(dayDir, 'fr.final.json'), '{"vieux":true}');
    await runRender({ outDir, date: '2026-11-06', fetch: net().fetch, print: printer().print });
    expect(existsSync(join(dayDir, 'fr.final.json'))).toBe(false);
  });

  it('le rapport liste les finals et le nom du PDF, sans chemin ni clé API', async () => {
    const { outDir, dayDir } = day(['fr', 'es']);
    const r = await runRender({ outDir, date: '2026-11-06', fetch: net().fetch, print: printer().print });
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

  it('un 403 (agent refusé) coupe Commons dès le premier appel et le PDF est produit', async () => {
    const { outDir } = day();
    const n = fakeFetch({ [COMMONS_API]: { status: 403, json: {} } });
    const r = await runRender({ outDir, date: '2026-11-06', fetch: n.fetch, print: printer().print });
    expect(r.exitCode).toBe(0);
    expect(n.calls).toHaveLength(1);
    expect(r.issues.filter((i) => /Commons/.test(i.message)).map((i) => i.message)).toEqual(['Wikimedia Commons indisponible (HTTP 403) : photos omises']);
  });

  it('un délai dépassé coupe Commons : un seul appel, un seul avertissement', async () => {
    const { outDir } = day();
    const n = fakeFetch({ [COMMONS_API]: { hang: true } });
    const r = await runRender({ outDir, date: '2026-11-06', fetch: n.fetch, print: printer().print, photoTimeoutMs: 20 });
    expect(r.exitCode).toBe(0);
    expect(n.calls).toHaveLength(1);
    expect(r.issues.filter((i) => /Commons/.test(i.message)).map((i) => i.message)).toEqual(['Wikimedia Commons indisponible (délai dépassé) : photos omises']);
  });

  it('une requête en 500 laisse seulement ce sujet sans photo, les autres gardent la leur', async () => {
    const { outDir, dayDir } = day(['fr']);
    const find = async (q: string) => {
      if (q === 'car factory') throw new HttpError(500, `${COMMONS_API}?gsrsearch=car`);
      return photo(7);
    };
    const r = await runRender({ outDir, date: '2026-11-06', fetch: net().fetch, print: printer().print, findPhoto: find });
    expect(r.exitCode).toBe(0);
    const fr = JSON.parse(readFileSync(join(dayDir, 'fr.final.json'), 'utf8'));
    const photos = fr.sections.flatMap((s: any) => s.stories).filter((st: any) => st.visual.type === 'photo');
    expect(photos.map((st: any) => [st.visual.query, !!st.visual.photo])).toEqual([['car factory', false], ['high-speed train', true]]);
    expect(r.issues.filter((i) => /Commons/.test(i.message)).map((i) => i.message)).toEqual(['2026-11-06-fr-5 : Wikimedia Commons : HTTP 500']);
  });

  it('mémoïse les recherches entre langues : un appel par requête distincte', async () => {
    const { outDir } = day();
    const n = net();
    await runRender({ outDir, date: '2026-11-06', fetch: n.fetch, print: printer().print });
    const queries = new Set(
      fixtureBrief().editions.flatMap((e) => e.sections.flatMap((s) => s.stories.flatMap((st) => (st.visual.type === 'photo' ? [st.visual.query] : [])))),
    );
    expect(n.calls.filter((c) => c.url.startsWith(COMMONS_API))).toHaveLength(queries.size);
  });

  it('repli sur l’édition vérifiée, sans photo, si la photo rend l’édition invalide', async () => {
    const { outDir, dayDir } = day(['fr']);
    const find = async () => ({ ...photo(9), author: '' });
    const r = await runRender({ outDir, date: '2026-11-06', fetch: net().fetch, print: printer().print, findPhoto: find });
    const fr = JSON.parse(readFileSync(join(dayDir, 'fr.final.json'), 'utf8'));
    expect(parseEdition(fr).success).toBe(true);
    expect(JSON.stringify(fr)).not.toContain('"photo":');
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

  it('retire une photo pré-remplie invalide, avec un avertissement, la recherche puis produit le PDF', async () => {
    const { outDir, dayDir } = day(['fr']);
    const file = join(dayDir, 'fr.verified.json');
    const ed = JSON.parse(readFileSync(file, 'utf8'));
    for (const st of ed.sections.flatMap((s: any) => s.stories)) {
      if (st.visual.type === 'photo') st.visual.photo = { ...photo(5), src: 'http://169.254.169.254/x.jpg', pageUrl: 'https://evil.example/' };
    }
    writeFileSync(file, JSON.stringify(ed));
    const n = net();
    const { print, printed } = printer();
    const r = await runRender({ outDir, date: '2026-11-06', fetch: n.fetch, print });
    expect(r.exitCode).toBe(0);
    expect(printed).toHaveLength(1);
    const final = readFileSync(join(dayDir, 'fr.final.json'), 'utf8');
    expect(final).not.toContain('169.254');
    expect(final).toContain(TGV_PAGE);
    expect(r.issues).toContainEqual(expect.objectContaining({ level: 'warning', lang: 'fr', message: '2026-11-06-fr-5 : photo pré-remplie invalide retirée' }));
    expect(n.calls.some((c) => c.url.includes('169.254'))).toBe(false);
  });

  it('lit une ancienne édition avec `pexels` : champ ignoré, photo cherchée sur Commons', async () => {
    const { outDir, dayDir } = day(['fr']);
    const file = join(dayDir, 'fr.verified.json');
    const ed = JSON.parse(readFileSync(file, 'utf8'));
    for (const st of ed.sections.flatMap((s: any) => s.stories)) {
      if (st.visual.type === 'photo') st.visual.pexels = { id: 1, src: 'https://images.pexels.com/1.jpeg', width: 6, height: 4, photographer: 'P', photographerUrl: 'https://www.pexels.com/@p', pexelsUrl: 'https://www.pexels.com/photo/1/' };
    }
    writeFileSync(file, JSON.stringify(ed));
    const n = net();
    const r = await runRender({ outDir, date: '2026-11-06', fetch: n.fetch, print: printer().print });
    expect(r.exitCode).toBe(0);
    const final = readFileSync(join(dayDir, 'fr.final.json'), 'utf8');
    expect(final).not.toContain('pexels');
    expect(final).toContain(TGV_PAGE);
    expect(n.calls.some((c) => c.url.includes('pexels'))).toBe(false);
  });

  it('trois échecs de suite coupent Commons (disjoncteur de la collecte)', async () => {
    const { outDir } = day();
    const n = fakeFetch({ [COMMONS_API]: { status: 500, json: {} } });
    const r = await runRender({ outDir, date: '2026-11-06', fetch: n.fetch, print: printer().print });
    expect(r.exitCode).toBe(0);
    expect(n.calls).toHaveLength(3);
    expect(r.issues.filter((i) => /indisponible/.test(i.message)).map((i) => i.message)).toEqual(['Wikimedia Commons indisponible (source coupée après 3 échecs consécutifs) : photos omises']);
  });
});
