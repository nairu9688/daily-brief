import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Edition, Lang } from '@daily-brief/schema';
import { fixtureEdition } from '../helpers';

export const DAY = '2026-11-06';
export const RENDERED_AT = '2026-11-06T04:40:00.000Z';
export const PDF_BYTES = Buffer.from('%PDF-1.7\nfaux PDF de test\n%%EOF\n');
/** Fausse trame MP3 : étiquette ID3 suivie d'octets quelconques. */
export const MP3_BYTES = Buffer.concat([Buffer.from('ID3'), Buffer.from([4, 0, 0, 0, 0, 0, 10, 1, 2, 3, 4, 5])]);

export type DayOptions = {
  date?: string;
  langs?: Lang[];
  /** Langues annoncées par le rendu (par défaut : `langs`). */
  finals?: string[];
  pdf?: Buffer | null;
  /** Nom du PDF annoncé par le rendu (par défaut : le nom attendu, ou null sans PDF). */
  pdfName?: string | null;
  audio?: Lang[];
  edit?: (edition: Edition) => void;
  /** Autres fichiers du dossier du jour (rapports des étapes précédentes, par exemple). */
  extra?: Record<string, string>;
};

/** Édition de la fixture, redatée. */
export function editionFor(lang: Lang, date: string = DAY, edit?: (e: Edition) => void): Edition {
  const edition = fixtureEdition(lang);
  edition.date = date;
  edit?.(edition);
  return edition;
}

/** Dossier `out/<date>` tel que `brief:render` le laisse : éditions finales, PDF, rapport de rendu. */
export function makeDay(opts: DayOptions = {}): { outDir: string; dayDir: string } {
  const date = opts.date ?? DAY;
  const langs = opts.langs ?? (['fr', 'en', 'es'] as Lang[]);
  const outDir = mkdtempSync(join(tmpdir(), 'publish-'));
  const dayDir = join(outDir, date);
  mkdirSync(dayDir, { recursive: true });
  for (const lang of langs) writeFileSync(join(dayDir, `${lang}.final.json`), JSON.stringify(editionFor(lang, date, opts.edit), null, 2) + '\n');
  const pdf = opts.pdf === undefined ? PDF_BYTES : opts.pdf;
  const pdfName = `Daily Brief ${date}.pdf`;
  if (pdf) writeFileSync(join(dayDir, pdfName), pdf);
  for (const lang of opts.audio ?? []) writeFileSync(join(dayDir, `Daily Brief ${date} ${lang.toUpperCase()}.mp3`), MP3_BYTES);
  const report = { date, generatedAt: RENDERED_AT, exitCode: pdf ? 0 : 2, pdf: opts.pdfName === undefined ? (pdf ? pdfName : null) : opts.pdfName, langs: pdf ? langs : [], finals: opts.finals ?? langs, issues: [] };
  writeFileSync(join(dayDir, 'render-report.json'), JSON.stringify(report, null, 2) + '\n');
  for (const [name, text] of Object.entries(opts.extra ?? {})) writeFileSync(join(dayDir, name), text);
  return { outDir, dayDir };
}
