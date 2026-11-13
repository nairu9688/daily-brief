import type { Lang, OpenThread } from '@daily-brief/schema';
import { addDays, daysBetween, parisToday } from '../lib/date';
import { isStale, STALE_DAYS } from './stale';
import type { ContextStore, StoreAnomaly, Topic } from './store';

/**
 * Thread tel que stocké : statut et dates de ses événements. Ces dates sont des dates calendaires
 * (AAAA-MM-JJ), pas des horodatages : au lot 4, `thread_events.date` doit être de type `date`
 * (et non `timestamptz`, dont le fuseau décalerait la fermeture R12).
 */
export type StoredThread = OpenThread & { status: 'open' | 'closed'; events: string[] };
export type StoredTopic = { date: string; lang: Lang; title: string };

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new DOMException('appel annulé', 'AbortError');
}

/** Un événement daté de plus de ce nombre de jours dans le futur est signalé. */
export const FUTURE_EVENT_DAYS = 7;

/** Date du dernier événement ; à défaut, date de Paris de la dernière mise à jour. */
export function lastEventDate(t: StoredThread): string {
  return [...t.events].sort().at(-1) ?? parisToday(new Date(t.updatedAt));
}

/** Store en mémoire : référence de comportement pour le store Supabase (lot 4) et support des tests. */
export class MemoryContextStore implements ContextStore {
  readonly name = 'mémoire';
  readonly threads: StoredThread[];
  readonly topics: StoredTopic[];

  constructor(data: { threads?: StoredThread[]; topics?: StoredTopic[] } = {}) {
    this.threads = structuredClone(data.threads ?? []);
    this.topics = structuredClone(data.topics ?? []);
  }

  async openThreads(signal?: AbortSignal): Promise<OpenThread[]> {
    throwIfAborted(signal);
    return this.threads.filter((t) => t.status === 'open').map(({ id, slug, title, lang, updatedAt }) => ({ id, slug, title, lang, updatedAt }));
  }

  async yesterdayTopics(date: string, signal?: AbortSignal): Promise<Topic[]> {
    throwIfAborted(signal);
    const yesterday = addDays(date, -1);
    return this.topics.filter((t) => t.date === yesterday).map(({ lang, title }) => ({ lang, title }));
  }

  async closeStaleThreads(date: string, days: number = STALE_DAYS, signal?: AbortSignal): Promise<string[]> {
    const stale = this.threads.filter((t) => t.status === 'open' && isStale(lastEventDate(t), date, days));
    throwIfAborted(signal); // jamais d'écriture après annulation
    for (const t of stale) t.status = 'closed';
    return stale.map((t) => t.id).sort();
  }

  async anomalies(date: string, signal?: AbortSignal): Promise<StoreAnomaly[]> {
    throwIfAborted(signal);
    const out: StoreAnomaly[] = [];
    for (const t of this.threads) {
      if (t.status !== 'open') continue;
      const far = t.events.filter((e) => daysBetween(date, e) > FUTURE_EVENT_DAYS).sort();
      if (far.length) out.push({ threadId: t.id, kind: 'future-event', detail: `événement daté du ${far.at(-1)}, à plus de ${FUTURE_EVENT_DAYS} jours dans le futur` });
    }
    return out;
  }
}
