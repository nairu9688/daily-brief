import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { z } from 'zod';
import { IsoDateSchema, LANGS, parseEdition, stripInvalidPhotos, type Edition, type Lang, type Photo } from '@daily-brief/schema';
import { printPdf, renderPdfHtml, shrinkImages, type FooterInfo } from '@daily-brief/render-pdf';
import { Breaker, describeError } from '../collect/breaker';
import { HttpError } from '../collect/http';
import { findCommonsPhoto } from './commons';
import type { FetchLike } from './http';
import { fetchAsDataUri } from './images';
import { issueNumber, pdfFileName } from './issue';
import { fillPhotos, type PhotoFinder } from './photos';

export type RenderIssue = { level: 'error' | 'warning'; lang?: Lang; message: string };

export type RunRenderOptions = {
  outDir: string;
  date: string;
  fetch: FetchLike;
  /**
   * Recherche des photos sur Wikimedia Commons (vrai par défaut, aucune clé n'est nécessaire).
   * Faux en répétition (`brief:finish --dry-run`) : aucun appel, sujets illustrés rendus sans photo.
   */
  photoLookup?: boolean;
  /** Imprimante PDF, remplaçable dans les tests. */
  print?: (html: string, outPath: string, footer: FooterInfo) => Promise<void>;
  /** Recherche Commons, remplaçable dans les tests. */
  findPhoto?: typeof findCommonsPhoto;
  /** Délai d'une requête Commons (10 s par défaut). */
  photoTimeoutMs?: number;
  /** Réduction des photos avant insertion dans le PDF (Chromium), remplaçable dans les tests. */
  shrink?: typeof shrinkImages;
};

export type RunRenderResult = { issues: RenderIssue[]; exitCode: 0 | 2; pdfPath: string | null; langs: Lang[]; finals: Lang[] };

const COMMONS_DOWN = 'Wikimedia Commons indisponible';

const photoSrcs = (editions: Edition[]): Set<string> =>
  new Set(editions.flatMap((e) => e.sections.flatMap((s) => s.stories.flatMap((st) => (st.visual.type === 'photo' && st.visual.photo ? [st.visual.photo.src] : [])))));

/** Message court d'un échec de recherche : statut HTTP sans l'URL, jamais de fragment de corps. */
const searchError = (e: unknown): string => (e instanceof HttpError ? `Wikimedia Commons : HTTP ${e.status}` : describeError(e));

/** `audio.json` (écrit par le lot 5) : durée par édition, toutes facultatives. */
const AudioEntry = z.object({ duration: z.string().min(1) });
const AudioSchema = z.object({ fr: AudioEntry, en: AudioEntry, es: AudioEntry }).partial();

/**
 * Lit `out/<date>/{lang}.verified.json`, complète les photos (Wikimedia Commons), écrit `{lang}.final.json`
 * puis `Daily Brief <date>.pdf` et `render-report.json`. Une édition absente ou invalide est
 * simplement omise ; sans aucune édition, pas de PDF et code 2.
 */
export async function runRender(opts: RunRenderOptions): Promise<RunRenderResult> {
  const issues: RenderIssue[] = [];
  if (!IsoDateSchema.safeParse(opts.date).success) {
    return { issues: [{ level: 'error', message: `date incorrecte : « ${opts.date} »` }], exitCode: 2, pdfPath: null, langs: [], finals: [] };
  }
  let issue: string;
  try {
    issue = issueNumber(opts.date);
  } catch (e) {
    return { issues: [{ level: 'error', message: (e as Error).message }], exitCode: 2, pdfPath: null, langs: [], finals: [] };
  }
  const dayDir = join(opts.outDir, opts.date);
  mkdirSync(dayDir, { recursive: true });
  const pdfPath = join(dayDir, pdfFileName(opts.date));
  const finals: Lang[] = [];
  try {
    rmSync(pdfPath, { force: true });
    rmSync(join(dayDir, 'render-report.json'), { force: true });

    // Un seul chercheur pour toutes les langues : mémoïsé par requête, coupé par le disjoncteur de la
    // collecte (401, 402, 403, 429, délai dépassé, ou trois échecs de suite), avec un seul avertissement.
    const cache = new Map<string, { photo?: Photo | null; error?: Error }>();
    const breaker = new Breaker();
    const search = opts.findPhoto ?? findCommonsPhoto;
    const finder: PhotoFinder = async (q) => {
      if (breaker.open) throw new Error(COMMONS_DOWN);
      const hit = cache.get(q);
      if (hit) {
        if (hit.error) throw hit.error;
        return hit.photo!;
      }
      try {
        const photo = await search(q, { fetch: opts.fetch, timeoutMs: opts.photoTimeoutMs });
        breaker.success();
        cache.set(q, { photo });
        return photo;
      } catch (e) {
        if (breaker.trip(e)) {
          issues.push({ level: 'warning', message: `${COMMONS_DOWN} (${breaker.reason}) : photos omises` });
          throw new Error(COMMONS_DOWN);
        }
        const error = new Error(searchError(e));
        cache.set(q, { error });
        throw error;
      }
    };

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
        const raw: unknown = JSON.parse(readFileSync(path, 'utf8'));
        // Défense en profondeur (leçon SSRF du lot 2) : une photo pré-remplie hors des hôtes Wikimedia,
        // ou invalide, est retirée avant l'analyse ; elle n'est jamais téléchargée.
        for (const id of stripInvalidPhotos(raw)) issues.push({ level: 'warning', lang, message: `${id} : photo pré-remplie invalide retirée` });
        parsed = parseEdition(raw);
      } catch (e) {
        issues.push({ level: 'error', lang, message: `${lang}.verified.json illisible : ${(e as Error).message}` });
        continue;
      }
      if (!parsed.success) {
        issues.push({ level: 'error', lang, message: `${lang}.verified.json invalide : ${parsed.errors.join(' ; ')}` });
        continue;
      }
      if (parsed.data.lang !== lang || parsed.data.date !== opts.date) {
        issues.push({ level: 'error', lang, message: `${lang}.verified.json contient l’édition ${parsed.data.lang} du ${parsed.data.date} (attendu : ${lang}, ${opts.date}) : édition omise` });
        continue;
      }
      let ed = parsed.data;
      if (opts.photoLookup ?? true) {
        const r = await fillPhotos(ed, finder);
        ed = r.edition;
        for (const message of r.problems) if (!message.endsWith(`: ${COMMONS_DOWN}`)) issues.push({ level: 'warning', lang, message });
      } else if (ed.sections.some((s) => s.stories.some((st) => st.visual.type === 'photo' && !st.visual.photo))) {
        issues.push({ level: 'warning', lang, message: 'recherche de photos désactivée : sujets illustrés rendus sans photo' });
      }
      const check = parseEdition(ed);
      if (!check.success) {
        issues.push({ level: 'error', lang, message: `édition finale invalide, photos omises : ${check.errors.join(' ; ')}` });
        ed = parsed.data;
      }
      writeFileSync(join(dayDir, `${lang}.final.json`), JSON.stringify(ed, null, 2) + '\n');
      finals.push(lang);
      editions.push(ed);
    }

    if (editions.length === 0) {
      issues.push({ level: 'error', message: 'aucune édition à rendre : pas de PDF' });
      return finish(dayDir, opts.date, issues, null, [], finals);
    }

    const images: Record<string, string> = {};
    for (const src of photoSrcs(editions)) {
      const data = await fetchAsDataUri(src, opts.fetch);
      if (data) images[src] = data;
      else issues.push({ level: 'warning', message: `image Wikimedia non téléchargée : ${src}` });
    }

    // Les vignettes Commons pèsent 0,5 à 0,8 Mo : réduites à 1000 px en JPEG, le PDF passe de ~23 Mo à quelques Mo.
    const shrunk = await (opts.shrink ?? shrinkImages)(images);
    if (shrunk.error) issues.push({ level: 'warning', message: `photos non réduites (${shrunk.error}) : PDF plus lourd` });

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
      const html = await renderPdfHtml({ date: opts.date, issue, editions }, { images: shrunk.images, audio });
      await (opts.print ?? printPdf)(html, pdfPath, { date: opts.date, langs });
    } catch (e) {
      rmSync(pdfPath, { force: true });
      issues.push({ level: 'error', message: `impression PDF impossible : ${(e as Error).message}` });
      return finish(dayDir, opts.date, issues, null, [], finals);
    }
    return finish(dayDir, opts.date, issues, pdfPath, langs, finals);
  } catch (e) {
    // Quoi qu'il arrive, le rapport est écrit : la routine ne doit jamais lire un état de succès périmé.
    rmSync(pdfPath, { force: true });
    issues.push({ level: 'error', message: `erreur inattendue : ${(e as Error).message}` });
    return finish(dayDir, opts.date, issues, null, [], finals);
  }
}

function finish(dayDir: string, date: string, issues: RenderIssue[], pdfPath: string | null, langs: Lang[], finals: Lang[]): RunRenderResult {
  const exitCode = pdfPath ? 0 : 2;
  writeFileSync(
    join(dayDir, 'render-report.json'),
    JSON.stringify({ date, generatedAt: new Date().toISOString(), exitCode, pdf: pdfPath ? basename(pdfPath) : null, langs, finals, issues }, null, 2) + '\n',
  );
  return { issues, exitCode, pdfPath, langs, finals };
}
