/** Date du jour à Paris au format AAAA-MM-JJ. */
export function parisToday(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Paris',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

/** Instant UTC de minuit d'une date AAAA-MM-JJ réelle ; lève sinon (« 2026-02-30 » compris). */
function dayStart(date: string): number {
  const t = Date.parse(`${date}T00:00:00Z`);
  if (Number.isNaN(t) || new Date(t).toISOString().slice(0, 10) !== date) throw new Error(`date illisible : « ${date} »`);
  return t;
}

/** Date AAAA-MM-JJ décalée de `days` jours (calendrier, sans fuseau). */
export function addDays(date: string, days: number): string {
  return new Date(dayStart(date) + days * 86_400_000).toISOString().slice(0, 10);
}

/** Nombre de jours de `from` à `to` (dates AAAA-MM-JJ) ; négatif si `to` précède `from`. */
export function daysBetween(from: string, to: string): number {
  return Math.round((dayStart(to) - dayStart(from)) / 86_400_000);
}
