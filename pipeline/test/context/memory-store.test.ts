import { describe, expect, it } from 'vitest';
import { lastEventDate, MemoryContextStore, type StoredThread } from '../../context/memory-store';
import { isStale, STALE_DAYS, staleCutoff } from '../../context/stale';
import { EmptyContextStore } from '../../context/store';

const thread = (id: string, events: string[], extra: Partial<StoredThread> = {}): StoredThread => ({
  id,
  slug: id,
  title: `Thread ${id}`,
  lang: 'fr',
  updatedAt: '2026-10-01T08:00:00+02:00',
  status: 'open',
  events,
  ...extra,
});

describe('R12 : Thread sans événement depuis 21 jours', () => {
  it('périmé à partir de 21 jours pleins, jamais pour un événement futur', () => {
    expect(STALE_DAYS).toBe(21);
    expect(isStale('2026-10-16', '2026-11-06')).toBe(true);
    expect(isStale('2026-10-17', '2026-11-06')).toBe(false);
    expect(isStale('2026-11-10', '2026-11-06')).toBe(false);
    expect(staleCutoff('2026-11-06')).toBe('2026-10-16');
    expect(staleCutoff('2026-03-01', 1)).toBe('2026-02-28');
  });

  it('dernier événement, ou date de Paris de la dernière mise à jour s’il n’y en a pas', () => {
    expect(lastEventDate(thread('a', ['2026-10-20', '2026-11-02', '2026-10-01']))).toBe('2026-11-02');
    expect(lastEventDate(thread('b', [], { updatedAt: '2026-10-15T23:30:00Z' }))).toBe('2026-10-16');
  });

  it('le store en mémoire ferme les seuls Threads périmés, une seule fois', async () => {
    const store = new MemoryContextStore({
      threads: [
        thread('vieux', ['2026-10-01', '2026-10-16']),
        thread('frais', ['2026-10-17']),
        thread('sans-evenement', [], { updatedAt: '2026-10-10T09:00:00Z' }),
        thread('deja-ferme', ['2026-01-01'], { status: 'closed' }),
      ],
    });
    expect(await store.closeStaleThreads('2026-11-06')).toEqual(['sans-evenement', 'vieux']);
    expect((await store.openThreads()).map((t) => t.id)).toEqual(['frais']);
    expect(await store.closeStaleThreads('2026-11-06')).toEqual([]);
    expect(await store.closeStaleThreads('2026-11-07', 21)).toEqual(['frais']);
  });

  it('renvoie les Threads ouverts au format du contexte et les sujets de la veille seulement', async () => {
    const store = new MemoryContextStore({
      threads: [thread('t1', ['2026-11-05'])],
      topics: [
        { date: '2026-11-05', lang: 'fr', title: 'Budget au Sénat' },
        { date: '2026-11-04', lang: 'fr', title: 'Avant-veille' },
        { date: '2026-11-05', lang: 'es', title: 'Presupuestos' },
      ],
    });
    expect(await store.openThreads()).toEqual([{ id: 't1', slug: 't1', title: 'Thread t1', lang: 'fr', updatedAt: '2026-10-01T08:00:00+02:00' }]);
    expect(await store.yesterdayTopics('2026-11-06')).toEqual([
      { lang: 'fr', title: 'Budget au Sénat' },
      { lang: 'es', title: 'Presupuestos' },
    ]);
  });

  it('le store vide ne renvoie rien', async () => {
    const store = new EmptyContextStore();
    expect([await store.openThreads(), await store.yesterdayTopics(), await store.closeStaleThreads()]).toEqual([[], [], []]);
  });
});
