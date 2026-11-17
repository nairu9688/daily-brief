import { addDays } from './dates';

/** « 2026-11 » valide (mois 01 à 12), sinon null. */
export function parseMonth(v: string | undefined): string | null {
  return v && /^\d{4}-(0[1-9]|1[0-2])$/.test(v) ? v : null;
}

export const shiftMonth = (month: string, delta: number): string => {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return d.toISOString().slice(0, 7);
};

export const monthBounds = (month: string) => ({ first: `${month}-01`, last: addDays(`${shiftMonth(month, 1)}-01`, -1) });

/** Cases du calendrier d'un mois, semaines du lundi au dimanche ; null pour une case vide. */
export function monthGrid(month: string): (string | null)[] {
  const { first, last } = monthBounds(month);
  const lead = (new Date(`${first}T12:00:00Z`).getUTCDay() + 6) % 7;
  const cells: (string | null)[] = Array.from({ length: lead }, () => null);
  for (let d = first; d <= last; d = addDays(d, 1)) cells.push(d);
  while (cells.length % 7) cells.push(null);
  return cells;
}
