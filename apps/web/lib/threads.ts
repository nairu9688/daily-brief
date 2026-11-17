import type { ThreadSummary } from '@/lib/data/types';

const rank = (t: ThreadSummary) => (t.followed ? 0 : t.status === 'open' ? 1 : 2);

/**
 * Ordre de la liste des Threads : suivis d'abord, puis ouverts, puis fermés ; dans chaque groupe, du plus
 * récent au plus ancien (sans date en dernier). Comparateur cohérent : deux Threads égaux restent dans
 * leur ordre d'arrivée.
 */
export function sortThreads<T extends ThreadSummary>(list: T[]): T[] {
  return [...list].sort((a, b) => rank(a) - rank(b) || (b.lastDate ?? '').localeCompare(a.lastDate ?? ''));
}
