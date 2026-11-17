import { beforeEach, describe, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => ({
  user: { email: 'nanigeek@gmail.com' } as { email: string } | null,
  ds: { setSelected: vi.fn(async (ids: string[]) => ids.length), queueAnki: vi.fn(async (ids: string[]) => ids.length), setFollowed: vi.fn(async () => 1) },
}));
vi.mock('@/lib/auth', () => ({ currentUser: async () => m.user }));
vi.mock('@/lib/data', () => ({ getDataSource: async () => m.ds }));
const cache = vi.hoisted(() => ({ revalidatePath: vi.fn() }));
vi.mock('next/cache', () => cache);

import { queueAnki, setThreadFollowed, setVocabSelected } from '@/app/actions';

const ID = '3f2a1b4c-5d6e-4f70-8a9b-0c1d2e3f4a5b';

beforeEach(() => {
  m.user = { email: 'nanigeek@gmail.com' };
  vi.clearAllMocks();
});

describe('actions serveur', () => {
  it('écrit selected, anki_status et followed après validation', async () => {
    expect(await setVocabSelected({ ids: [ID], selected: true })).toEqual({ ok: true, count: 1 });
    expect(m.ds.setSelected).toHaveBeenCalledWith([ID], true);
    expect(await queueAnki({ ids: [ID, ID] })).toEqual({ ok: true, count: 2 });
    expect(await setThreadFollowed({ id: ID, followed: false })).toEqual({ ok: true, count: 1 });
    expect(m.ds.setFollowed).toHaveBeenCalledWith(ID, false);
  });

  it('accepte autant d’identifiants que /vocab en affiche (500), pas un de plus', async () => {
    const ids = Array.from({ length: 120 }, (_, i) => `3f2a1b4c-5d6e-4f70-8a9b-${String(i).padStart(12, '0')}`);
    expect(await setVocabSelected({ ids, selected: true })).toEqual({ ok: true, count: 120 });
    expect(await queueAnki({ ids: Array(500).fill(ID) })).toEqual({ ok: true, count: 500 });
    expect(await queueAnki({ ids: Array(501).fill(ID) })).toEqual({ ok: false, error: 'Demande invalide.' });
  });

  it('revalide les pages concernées après une écriture réussie, et seulement alors', async () => {
    // Cocher ne revalide pas /vocab : sur « Non cochés », le mot coché resterait sinon à disparaître de la liste.
    await setVocabSelected({ ids: [ID], selected: true });
    expect(cache.revalidatePath.mock.calls.map((c) => c[0])).toEqual(['/', '/edition/[date]']);
    cache.revalidatePath.mockClear();
    await queueAnki({ ids: [ID] });
    expect(cache.revalidatePath.mock.calls.map((c) => c[0])).toEqual(['/', '/edition/[date]', '/vocab']);
    cache.revalidatePath.mockClear();
    await setThreadFollowed({ id: ID, followed: true });
    expect(cache.revalidatePath.mock.calls.map((c) => c[0])).toEqual(['/threads', '/threads/[id]']);
    cache.revalidatePath.mockClear();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    m.ds.setFollowed.mockRejectedValueOnce(new Error('x'));
    await setThreadFollowed({ id: ID, followed: true });
    await setThreadFollowed({ id: 'pas-un-uuid', followed: true });
    expect(cache.revalidatePath).not.toHaveBeenCalled();
  });

  it('refuse toute entrée mal formée ou d’autres colonnes, sans écrire', async () => {
    for (const bad of [null, { ids: ['pas-un-uuid'], selected: true }, { ids: [], selected: true }, { ids: [ID], selected: 'oui' }, { ids: [ID], selected: true, term: 'x' }, { ids: Array(501).fill(ID), selected: true }]) {
      expect(await setVocabSelected(bad)).toEqual({ ok: false, error: 'Demande invalide.' });
    }
    expect(await queueAnki({ ids: [ID], anki_status: 'sent' })).toEqual({ ok: false, error: 'Demande invalide.' });
    expect(await setThreadFollowed({ id: ID, followed: true, title: 'x' })).toEqual({ ok: false, error: 'Demande invalide.' });
    expect(m.ds.setSelected).not.toHaveBeenCalled();
  });

  it('refuse sans utilisateur autorisé, pour chaque action, avant même de lire l’entrée', async () => {
    m.user = null;
    const SESSION = { ok: false, error: 'Session expirée : reconnecte-toi.' };
    expect(await setVocabSelected({ ids: [ID], selected: true })).toEqual(SESSION);
    expect(await queueAnki({ ids: [ID] })).toEqual(SESSION);
    expect(await setThreadFollowed({ id: ID, followed: true })).toEqual(SESSION);
    expect(await setVocabSelected({ ids: ['pas-un-uuid'], selected: 'oui' })).toEqual(SESSION);
    expect(m.ds.setSelected).not.toHaveBeenCalled();
    expect(m.ds.queueAnki).not.toHaveBeenCalled();
    expect(m.ds.setFollowed).not.toHaveBeenCalled();
  });

  it('rend une erreur sobre quand la base refuse', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    m.ds.setFollowed.mockRejectedValueOnce(new Error('permission denied for table threads'));
    expect(await setThreadFollowed({ id: ID, followed: true })).toEqual({ ok: false, error: 'Enregistrement impossible, réessaie.' });
  });
});
