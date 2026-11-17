// @vitest-environment node
import { beforeEach, describe, expect, it } from 'vitest';
import type { Lang } from '@daily-brief/schema';
import { FixtureDataSource, resetFixtureState } from '@/lib/data/fixture';
import { SupabaseDataSource } from '@/lib/data/supabase';
import type { DataSource } from '@/lib/data/types';
import { fakeSupabase } from './fake-supabase';

beforeEach(() => resetFixtureState());

/**
 * Entrées invalides à la frontière de la base : la source Supabase doit répondre comme la fixture
 * (null ou 0) sans envoyer de requête, au lieu d'une erreur 22P02 de Postgres (DataError, puis 500).
 */
const bad = async (ds: DataSource) => ({
  thread: await ds.thread('abc'),
  followed: await ds.setFollowed('x', true),
  selected: await ds.setSelected(['x'], true),
  anki: await ds.queueAnki(['x']),
  pdf: await ds.pdf('2026-13-99'),
  audioDate: await ds.audio('2026-13-99', 'fr'),
  audioLang: await ds.audio('2026-11-06', 'de' as Lang),
  edition: await ds.edition('2026-02-30', 'fr'),
  editionLang: await ds.edition('2026-11-06', 'de' as Lang),
  latest: await ds.latestDate('fr', 'demain'),
  days: await ds.days('x', '2026-11-30'),
  vocab: await ds.vocab({ date: '2026-13-01' }),
});

describe('entrées invalides : même réponse pour les deux sources', () => {
  it('null ou 0, sans aucune requête vers Supabase', async () => {
    const f = fakeSupabase(() => ({ data: null, error: { message: 'invalid input syntax for type uuid' } }));
    const supa = await bad(new SupabaseDataSource(f.client, () => '2026-11-06'));
    const fixture = await bad(new FixtureDataSource({ today: '2026-11-06' }));
    const expected = { thread: null, followed: 0, selected: 0, anki: 0, pdf: null, audioDate: null, audioLang: null, edition: null, editionLang: null, latest: null, days: [], vocab: [] };
    expect(fixture).toEqual(expected);
    expect(supa).toEqual(expected);
    expect(f.calls).toEqual([]);
    expect(f.signed).toEqual([]);
  });

  it('n’écrit que les identifiants valides d’une liste mêlée', async () => {
    const ID = '6f1e1c2a-3b4d-4e5f-8a9b-0c1d2e3f4a5b';
    const f = fakeSupabase(() => ({ data: [{ id: ID }], error: null }));
    const ds = new SupabaseDataSource(f.client, () => '2026-11-06');
    expect(await ds.setSelected([ID, 'x'], true)).toBe(1);
    expect(f.calls[0].ops.find((o) => o[0] === 'in')).toEqual(['in', 'id', [ID]]);
  });
});
