import type { Lang } from '@daily-brief/schema';
import { pdfFileName } from '../render/issue';

/** Fichier du jour à déposer : nom lisible (Drive), type, emplacement dans Supabase Storage. */
export type DayFile = { name: string; mimeType: 'application/pdf' | 'audio/mpeg'; bucket: 'pdf' | 'audio'; path: string };

export const PDF_MIME = 'application/pdf' as const;
export const MP3_MIME = 'audio/mpeg' as const;

/** Nom du MP3 d'une édition (spec §9) : « Daily Brief 2026-11-06 FR.mp3 ». */
export const mp3FileName = (date: string, lang: Lang) => `Daily Brief ${date} ${lang.toUpperCase()}.mp3`;

/** Les chemins de stockage sont en ASCII sans espace ; le nom lisible ne sert qu'à Drive. */
export const pdfFile = (date: string): DayFile => ({ name: pdfFileName(date), mimeType: PDF_MIME, bucket: 'pdf', path: `${date}/daily-brief-${date}.pdf` });
export const mp3File = (date: string, lang: Lang): DayFile => ({ name: mp3FileName(date, lang), mimeType: MP3_MIME, bucket: 'audio', path: `${date}/${lang}.mp3` });

const NAME = /^Daily Brief (\d{4}-\d{2}-\d{2})(?: (FR|EN|ES))?\.(pdf|mp3)$/;

/**
 * Vrai si le fichier est bien un fichier du Daily Brief de `date` : nom, type, bucket et chemin
 * cohérents entre eux. Sert à revalider les lignes de `drive_pending` avant de relire un fichier.
 */
export function isDayFile(f: DayFile, date: string): boolean {
  const m = NAME.exec(f.name);
  if (!m || m[1] !== date) return false;
  const expected = m[3] === 'pdf' ? (m[2] ? null : pdfFile(date)) : m[2] ? mp3File(date, m[2].toLowerCase() as Lang) : null;
  return expected !== null && expected.mimeType === f.mimeType && expected.bucket === f.bucket && expected.path === f.path;
}

/** Un PDF commence par « %PDF- ». */
export const looksLikePdf = (b: Uint8Array): boolean => b.length > 5 && b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46 && b[4] === 0x2d;

/** Un MP3 commence par une étiquette ID3 ou par une trame (11 bits de synchronisation à 1). */
export const looksLikeMp3 = (b: Uint8Array): boolean => b.length > 3 && ((b[0] === 0x49 && b[1] === 0x44 && b[2] === 0x33) || (b[0] === 0xff && (b[1] & 0xe0) === 0xe0));

export const looksLike = (f: DayFile, bytes: Uint8Array): boolean => (f.mimeType === PDF_MIME ? looksLikePdf(bytes) : looksLikeMp3(bytes));
