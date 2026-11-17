import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import { IsoDateSchema, LANGS, LangSchema, parseEdition, type Edition, type Lang } from '@daily-brief/schema';
import { messageOf } from '../collect/http';
import { pdfFileName } from '../render/issue';
import { looksLike, mp3File, pdfFile, type DayFile } from './files';

export type PublishIssue = { level: 'error' | 'warning'; lang?: Lang; message: string };

/** Fichier local prêt à déposer, avec son contenu. */
export type LocalFile = DayFile & { bytes: Buffer; lang?: Lang };

export type PublishInputs = {
  editions: Edition[];
  pdf: LocalFile | null;
  /** MP3 présents (le lot 5 les produit) : au plus un par édition publiable. */
  audio: LocalFile[];
  /** Horodatage du rendu, ou null si render-report.json est inutilisable. */
  renderedAt: string | null;
  issues: PublishIssue[];
};

const RenderReport = z.object({
  date: IsoDateSchema,
  generatedAt: z.iso.datetime({ offset: true }),
  pdf: z.string().nullable(),
  finals: z.array(LangSchema),
});

/** Taille maximale d'un PDF (octets) : sous la limite de Storage et de l'envoi à Apps Script. */
export const MAX_PDF_BYTES = 30 * 1024 * 1024;
export const MAX_MP3_BYTES = 15 * 1024 * 1024;
/** Taille maximale de render-report.json et d'une édition finale (octets). */
export const MAX_JSON_BYTES = 5 * 1024 * 1024;

/** Lit un fichier JSON de taille bornée (la taille est contrôlée avant et après la lecture). */
function readJson(path: string): unknown {
  const size = statSync(path).size;
  if (size > MAX_JSON_BYTES) throw new Error(`fichier trop lourd (${size} octets, ${MAX_JSON_BYTES} au plus)`);
  const text = readFileSync(path, 'utf8');
  if (Buffer.byteLength(text) > MAX_JSON_BYTES) throw new Error(`fichier trop lourd (plus de ${MAX_JSON_BYTES} octets)`);
  return JSON.parse(text);
}

function readChecked(dayDir: string, file: DayFile, max: number): Buffer {
  const path = join(dayDir, file.name);
  const size = statSync(path).size;
  if (size === 0) throw new Error('fichier vide');
  if (size > max) throw new Error(`fichier trop lourd (${size} octets, ${max} au plus)`);
  const bytes = readFileSync(path);
  // Le fichier a pu grossir entre la mesure et la lecture.
  if (bytes.length === 0) throw new Error('fichier vide');
  if (bytes.length > max) throw new Error(`fichier trop lourd (${bytes.length} octets, ${max} au plus)`);
  if (!looksLike(file, bytes)) throw new Error(file.bucket === 'pdf' ? 'ce n’est pas un PDF' : 'ce n’est pas un MP3');
  return bytes;
}

/**
 * Lit ce que `brief:render` a produit pour `date` : les `{lang}.final.json` listés dans `finals` de
 * render-report.json, le PDF et, s'ils existent, les MP3. Chaque fichier est contrôlé contre son
 * nom et sa date ; un fichier absent, illisible ou incohérent devient un problème, jamais une
 * exception, et n'est pas publié.
 */
export function loadPublishInputs(dayDir: string, date: string): PublishInputs {
  const out: PublishInputs = { editions: [], pdf: null, audio: [], renderedAt: null, issues: [] };
  const issue = (level: PublishIssue['level'], message: string, lang?: Lang) => out.issues.push({ level, ...(lang ? { lang } : {}), message });

  const reportPath = join(dayDir, 'render-report.json');
  if (!existsSync(reportPath)) {
    issue('error', 'render-report.json absent : rien à publier (lancer brief:render)');
    return out;
  }
  let report: z.infer<typeof RenderReport>;
  try {
    report = RenderReport.parse(readJson(reportPath));
  } catch (e) {
    issue('error', `render-report.json illisible : ${e instanceof z.ZodError ? `${e.issues.length} champs invalides` : messageOf(e)}`);
    return out;
  }
  if (report.date !== date) {
    issue('error', `render-report.json est celui du ${report.date} (attendu : ${date}) : rien à publier`);
    return out;
  }
  out.renderedAt = report.generatedAt;

  for (const lang of LANGS.filter((l) => report.finals.includes(l))) {
    const name = `${lang}.final.json`;
    const path = join(dayDir, name);
    if (!existsSync(path)) {
      issue('error', `${name} absent alors que le rendu l’annonce : édition non publiée`, lang);
      continue;
    }
    let parsed: ReturnType<typeof parseEdition>;
    try {
      parsed = parseEdition(readJson(path));
    } catch (e) {
      issue('error', `${name} illisible : ${messageOf(e)}`, lang);
      continue;
    }
    if (!parsed.success) {
      issue('error', `${name} invalide (${parsed.errors.length} erreur${parsed.errors.length > 1 ? 's' : ''}) : ${parsed.errors.slice(0, 3).join(' ; ')}`, lang);
      continue;
    }
    if (parsed.data.lang !== lang || parsed.data.date !== date) {
      issue('error', `${name} contient l’édition ${parsed.data.lang} du ${parsed.data.date} (attendu : ${lang}, ${date}) : édition non publiée`, lang);
      continue;
    }
    out.editions.push(parsed.data);
  }
  if (report.finals.length === 0) issue('error', 'le rendu n’annonce aucune édition (finals vide) : rien à publier');

  if (report.pdf === null) issue('warning', 'le rendu n’a pas produit de PDF : éditions publiées sans PDF');
  else if (report.pdf !== pdfFileName(date)) issue('error', `PDF inattendu « ${report.pdf} » (attendu : ${pdfFileName(date)}) : non publié`);
  else {
    const file = pdfFile(date);
    try {
      out.pdf = { ...file, bytes: readChecked(dayDir, file, MAX_PDF_BYTES) };
    } catch (e) {
      issue('error', `${file.name} : ${(e as NodeJS.ErrnoException).code === 'ENOENT' ? 'absent alors que le rendu l’annonce' : messageOf(e)} — non publié`);
    }
  }

  // MP3 : facultatifs (lot 5). Seuls ceux des éditions publiables sont pris.
  for (const ed of out.editions) {
    const file = mp3File(date, ed.lang);
    if (!existsSync(join(dayDir, file.name))) continue;
    try {
      out.audio.push({ ...file, lang: ed.lang, bytes: readChecked(dayDir, file, MAX_MP3_BYTES) });
    } catch (e) {
      issue('warning', `${file.name} : ${messageOf(e)} — édition publiée sans lecteur`, ed.lang);
    }
  }
  return out;
}
