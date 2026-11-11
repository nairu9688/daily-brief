import { addDays, daysBetween } from '../lib/date';

/** R12 : un Thread sans événement depuis 21 jours est fermé. */
export const STALE_DAYS = 21;

/** Dernière date d'événement (AAAA-MM-JJ) qui rend un Thread périmé à la date `date` (pour une requête SQL au lot 4). */
export function staleCutoff(date: string, days: number = STALE_DAYS): string {
  return addDays(date, -days);
}

/** Vrai si le dernier événement date d'au moins `days` jours avant `date` (un événement futur ne l'est jamais). */
export function isStale(lastEventDate: string, date: string, days: number = STALE_DAYS): boolean {
  return daysBetween(lastEventDate, date) >= days;
}
