import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import { IsoDateSchema, LANGS, parseEdition, type Edition, type Lang } from '@daily-brief/schema';
import { printPdf, renderPdfHtml, type FooterInfo } from '@daily-brief/render-pdf';
import type { FetchLike } from './http';
import { fetchAsDataUri } from './images';
import { issueNumber, pdfFileName } from './issue';
import { findPhoto } from './pexels';
import { fillPhotos } from './photos';

export type RenderIssue = { level: 'error' | 'warning'; lang?: Lang; message: string };

export type RunRenderOptions = {
  outDir: string;
  date: string;
  /** Clé Pexels ; sans clé, les sujets illustrés par une photo sont rendus sans image. */
  pexelsApiKey?: string;
  fetch: FetchLike;
  /** Imprimante PDF, remplaçable dans les tests. */
  print?: (html: string, outPath: string, footer: FooterInfo) => Promise<void>;
};

export type RunRenderResult = { issues: RenderIssue[]; exitCode: 0 | 2; pdfPath: string | null; langs: Lang[] };

/** `audio.json` (écrit par le lot 5) : durée par édition, toutes facultatives. */
const AudioSchema = z.partialRecord(z.enum(['fr', 'en', 'es']), z.object({ duration: z.string().min(1) }));

/**
 * Lit `out/<date>/{lang}.verified.json`, complète les photos Pexels, écrit `{lang}.final.json`
 * puis `Daily Brief <date>.pdf` et `render-report.json`. Une édition absente ou invalide est
 * simplement omise ; sans aucune édition, pas de PDF et code 2.
 */
export async function runRender(opts: RunRenderOptions): Promise<RunRenderResult> {
  const issues: RenderIssue[] = [];
  if (!IsoDateSchema.safeParse(opts.date).success) {
    return { issues: [{ level: 'error', message: `date incorrecte : « ${opts.date} »` }], exitCode: 2, pdfPath: null, langs: [] };
  }
  let issue: string;
  try {
    issue = issueNumber(opts.date);
  } catch (e) {
    return { issues: [{ level: 'error', message: (e as Error).message }], exitCode: 2, pdfPath: null, langs: [] };
  }
  const dayDir = join(opts.outDir, opts.date);
  mkdirSync(dayDir, { recursive: true });
  const pdfPath = join(dayDir, pdfFileName(opts.date));
  rmSync(pdfPath, { force: true });
  rmSync(join(dayDir, 'render-report.json'), { force: true });

  const editions: Edition[] = [];
  for (const lang of LANGS) {
    const path = join(dayDir, `${lang}.verified.json`);
    rmSync(join(dayDir, `${lang}.final.json`), { force: true });
    if (!existsSync(path)) {
      issues.push({ level: 'warning', lang, message: `${lang}.verified.json absent : édition omise` });
      continue;
    }
    let parsed: ReturnType<typeof parseEdition>;
    try {
      parsed = parseEdition(JSON.parse(readFileSync(path, 'utf8')));
    } catch (e) {
      issues.push({ level: 'error', lang, message: `${lang}.verified.json illisible : ${(e as Error).message}` });
      continue;
    }
    if (!parsed.success) {
      issues.push({ level: 'error', lang, message: `${lang}.verified.json invalide : ${parsed.errors.join(' ; ')}` });
      continue;
    }
    let ed = parsed.data;
    if (opts.pexelsApiKey) {
      const apiKey = opts.pexelsApiKey;
      const r = await fillPhotos(ed, (q) => findPhoto(q, { apiKey, fetch: opts.fetch }));
      ed = r.edition;
      for (const message of r.problems) issues.push({ level: 'warning', lang, message });
    } else if (ed.sections.some((s) => s.stories.some((st) => st.visual.type === 'photo' && !st.visual.pexels))) {
      issues.push({ level: 'warning', lang, message: 'PEXELS_API_KEY absente : sujets illustrés rendus sans photo' });
    }
    const check = parseEdition(ed);
    if (!check.success) {
      issues.push({ level: 'error', lang, message: `édition finale invalide, photos omises : ${check.errors.join(' ; ')}` });
      ed = parsed.data;
    }
    writeFileSync(join(dayDir, `${lang}.final.json`), JSON.stringify(ed, null, 2) + '\n');
    editions.push(ed);
  }

  if (editions.length === 0) {
    issues.push({ level: 'error', message: 'aucune édition à rendre : pas de PDF' });
    return finish(dayDir, opts.date, issues, null, []);
  }

  const images: Record<string, string> = {};
  for (const src of new Set(editions.flatMap((e) => e.sections.flatMap((s) => s.stories.flatMap((st) => (st.visual.type === 'photo' && st.visual.pexels ? [st.visual.pexels.src] : [])))))) {
    const data = await fetchAsDataUri(src, opts.fetch);
    if (data) images[src] = data;
    else issues.push({ level: 'warning', message: `image Pexels non téléchargée : ${src}` });
  }

  let audio: z.infer<typeof AudioSchema> | undefined;
  const audioPath = join(dayDir, 'audio.json');
  if (existsSync(audioPath)) {
    try {
      audio = AudioSchema.parse(JSON.parse(readFileSync(audioPath, 'utf8')));
    } catch (e) {
      issues.push({ level: 'warning', message: `audio.json illisible, PDF sans encart audio : ${(e as Error).message}` });
    }
  }

  const langs = editions.map((e) => e.lang);
  try {
    const html = await renderPdfHtml({ date: opts.date, issue, editions }, { images, audio });
    await (opts.print ?? printPdf)(html, pdfPath, { date: opts.date, langs });
  } catch (e) {
    rmSync(pdfPath, { force: true });
    issues.push({ level: 'error', message: `impression PDF impossible : ${(e as Error).message}` });
    return finish(dayDir, opts.date, issues, null, langs);
  }
  return finish(dayDir, opts.date, issues, pdfPath, langs);
}

function finish(dayDir: string, date: string, issues: RenderIssue[], pdfPath: string | null, langs: Lang[]): RunRenderResult {
  const exitCode = pdfPath ? 0 : 2;
  writeFileSync(
    join(dayDir, 'render-report.json'),
    JSON.stringify({ date, generatedAt: new Date().toISOString(), exitCode, pdf: pdfPath, langs, issues }, null, 2) + '\n',
  );
  return { issues, exitCode, pdfPath, langs };
}
