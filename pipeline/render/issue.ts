/** Date de la première édition (spec §13 : lancement le 06/11/2026, N° 001). */
export const LAUNCH_DATE = '2026-11-06';

/** Numéro du jour sur 3 chiffres : 2026-11-06 → « 001 », 2026-11-07 → « 002 ». */
export function issueNumber(date: string, launch = LAUNCH_DATE): string {
  const days = Math.round((Date.parse(`${date}T00:00:00Z`) - Date.parse(`${launch}T00:00:00Z`)) / 86_400_000);
  if (!Number.isFinite(days) || days < 0) throw new Error(`date antérieure au lancement : ${date}`);
  return String(days + 1).padStart(3, '0');
}

export const pdfFileName = (date: string) => `Daily Brief ${date}.pdf`;
