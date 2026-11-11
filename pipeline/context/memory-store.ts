import type { Lang, OpenThread } from '@daily-brief/schema';
import { addDays, parisToday } from '../lib/date';
import { isStale, STALE_DAYS } from './stale';
import type { ContextStore, Topic } from './store';

/** Thread tel que stocké : statut et dates (AAAA-MM-JJ) de ses événements. */
export type StoredThread = OpenThread & { status: 'open' | 'closed'; events: string[] };
export type StoredTopic = { date: string; lang: Lang; title: string };

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

  async openThreads(): Promise<OpenThread[]> {
    return this.threads.filter((t) => t.status === 'open').map(({ id, slug, title, lang, updatedAt }) => ({ id, slug, title, lang, updatedAt }));
  }

  async yesterdayTopics(date: string): Promise<Topic[]> {
    const yesterday = addDays(date, -1);
    return this.topics.filter((t) => t.date === yesterday).map(({ lang, title }) => ({ lang, title }));
  }

  async closeStaleThreads(date: string, days: number = STALE_DAYS): Promise<string[]> {
    const closed: string[] = [];
    for (const t of this.threads) {
      if (t.status === 'open' && isStale(lastEventDate(t), date, days)) {
        t.status = 'closed';
        closed.push(t.id);
      }
    }
    return closed.sort();
  }
}
