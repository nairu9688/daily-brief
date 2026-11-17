// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MAX_IDS, SupabaseDataSource, SIGNED_URL_SECONDS, STORY_COLUMNS } from '@/lib/data/supabase';
import { createTestDb, type TestDb } from '../../../../pipeline/test/supabase/pg';
import { fakeSupabase, op, type Call } from './fake-supabase';
import { asUserJson, editionRows, publishFixture } from './pg-rows';

let db: TestDb;
beforeAll(async () => {
  db = await createTestDb();
  await publishFixture(db, { audio: ['fr'] });
}, 60_000);
afterAll(async () => db.close());

const today = () => '2026-11-06';

describe('source de données Supabase', () => {
  it('lit une édition par date et langue, avec ses sujets, sources et mots', async () => {
    const rows = await editionRows(db, '2026-11-06', 'en');
    const { client, calls } = fakeSupabase((c: Call) => ({ data: c.table === 'editions' ? rows.edition : c.table === 'stories' ? rows.stories : c.table === 'sources' ? rows.sources : rows.vocab, error: null }));
    const ed = await new SupabaseDataSource(client, today).edition('2026-11-06', 'en');
    expect(ed?.headline).toBe('A blue wave sweeps Congress');
    expect(ed?.vocab?.words).toHaveLength(6);
    expect(op(calls[0], 'eq')).toEqual([
      ['date', '2026-11-06'],
      ['lang', 'en'],
    ]);
    expect(op(calls.find((c) => c.table === 'stories')!, 'select')).toEqual([[STORY_COLUMNS]]);
  });

  it('renvoie null pour une édition absente et lève sur une erreur', async () => {
    const none = fakeSupabase(() => ({ data: null, error: null }));
    expect(await new SupabaseDataSource(none.client, today).edition('2026-11-07', 'fr')).toBeNull();
    const ko = fakeSupabase(() => ({ data: null, error: { message: 'JWT expired' } }));
    await expect(new SupabaseDataSource(ko.client, today).edition('2026-11-07', 'fr')).rejects.toThrow(/édition : JWT expired/);
  });

  it('regroupe l’archive par jour', async () => {
    const rows = await asUserJson(db, `select jsonb_build_object('date', date, 'lang', lang, 'status', status) as j from public.editions order by date`);
    const { client } = fakeSupabase(() => ({ data: rows, error: null }));
    expect(await new SupabaseDataSource(client, today).days('2026-11-01', '2026-11-30')).toEqual([{ date: '2026-11-06', langs: ['fr', 'en', 'es'], light: [] }]);
  });

  it('écarte une ligne d’archive illisible au lieu de l’afficher', async () => {
    const rows = [
      { date: '2026-11-06', lang: 'fr', status: 'light' },
      { date: 'pas-une-date', lang: 'fr', status: 'published' },
      { date: '2026-11-07', lang: 'de', status: 'published' },
      { date: '2026-11-08', lang: 'en' },
      null,
    ];
    const { client } = fakeSupabase(() => ({ data: rows, error: null }));
    expect(await new SupabaseDataSource(client, today).days('2026-11-01', '2026-11-30')).toEqual([{ date: '2026-11-06', langs: ['fr'], light: ['fr'] }]);
  });

  it('lit les Threads et leur frise sous RLS', async () => {
    const rows = await asUserJson(
      db,
      `select jsonb_build_object('id', t.id, 'title', t.title, 'lang', t.lang, 'status', t.status, 'followed', t.followed,
         'thread_events', coalesce((select jsonb_agg(jsonb_build_object('date', e.date, 'title', e.title, 'text', e.text,
           'story', (select jsonb_build_object('rubric', s.rubric, 'visual', s.visual, 'sources',
             (select jsonb_agg(jsonb_build_object('outlet', x.outlet, 'url', x.url, 'position', x.position)) from public.sources x where x.story_id = s.id))
             from public.stories s where s.id = e.story_id))) from public.thread_events e where e.thread_id = t.id), '[]'::jsonb)) as j
       from public.threads t`,
    );
    const { client } = fakeSupabase(() => ({ data: rows, error: null }));
    const list = await new SupabaseDataSource(client, today).threads();
    expect(list.map((t) => t.title)).toContain('Crisis ferroviaria 2026');
    const detail = await new SupabaseDataSource(client, today).thread(list[0].id);
    expect(detail?.events[0].source?.url).toMatch(/^https:/);
  });

  it('n’écrit que les colonnes ouvertes par la RLS', async () => {
    const A = '6f1e1c2a-3b4d-4e5f-8a9b-0c1d2e3f4a5b';
    const { client, calls } = fakeSupabase(() => ({ data: [{ id: A }], error: null }));
    const ds = new SupabaseDataSource(client, today);
    expect(await ds.setSelected([A], true)).toBe(1);
    expect(await ds.queueAnki([A])).toBe(1);
    expect(await ds.setFollowed(A, true)).toBe(1);
    expect(calls.map((c) => [c.table, op(c, 'update')[0][0]])).toEqual([
      ['vocab_items', { selected: true }],
      ['vocab_items', { anki_status: 'queued', selected: true }],
      ['threads', { followed: true }],
    ]);
    expect(op(calls[1], 'eq')).toEqual([['anki_status', 'none']]);
    expect(await ds.setSelected([], true)).toBe(0);
    expect(await ds.setSelected(Array(MAX_IDS + 1).fill(A), true)).toBe(0);
    expect(MAX_IDS).toBe(500);
  });

  it('écrit par lots de 100 identifiants au plus et additionne les comptes', async () => {
    const ids = Array.from({ length: 250 }, (_, i) => `6f1e1c2a-3b4d-4e5f-8a9b-${String(i).padStart(12, '0')}`);
    const echo = () => fakeSupabase((c: Call) => ({ data: ((op(c, 'in')[0]?.[1] as string[] | undefined) ?? []).map((id) => ({ id })), error: null }));
    const sel = echo();
    expect(await new SupabaseDataSource(sel.client, today).setSelected(ids, true)).toBe(250);
    expect(sel.calls.map((c) => (op(c, 'in')[0][1] as string[]).length)).toEqual([100, 100, 50]);
    expect(sel.calls.flatMap((c) => op(c, 'in')[0][1] as string[])).toEqual(ids);
    const anki = echo();
    expect(await new SupabaseDataSource(anki.client, today).queueAnki(ids)).toBe(250);
    expect(anki.calls).toHaveLength(3);
    expect(anki.calls.every((c) => (op(c, 'in')[0][1] as string[]).length <= 100 && op(c, 'eq')[0][1] === 'none')).toBe(true);
  });

  it('signe l’audio pour 10 minutes et refuse un chemin inattendu', async () => {
    const ok = fakeSupabase(() => ({ data: { audio_path: '2026-11-06/fr.mp3' }, error: null }));
    expect(await new SupabaseDataSource(ok.client, today).audio('2026-11-06', 'fr')).toEqual({ kind: 'redirect', url: 'https://ref.supabase.co/storage/v1/object/sign/audio/2026-11-06/fr.mp3?token=t' });
    expect(ok.signed).toEqual([{ bucket: 'audio', path: '2026-11-06/fr.mp3', expiresIn: SIGNED_URL_SECONDS, options: undefined }]);
    const none = fakeSupabase(() => ({ data: { audio_path: null }, error: null }));
    expect(await new SupabaseDataSource(none.client, today).audio('2026-11-06', 'es')).toBeNull();
    const odd = fakeSupabase(() => ({ data: { audio_path: '../pdf/x.pdf' }, error: null }));
    expect(await new SupabaseDataSource(odd.client, today).audio('2026-11-06', 'fr')).toBeNull();
    expect(odd.signed).toEqual([]);
  });

  it('signe le PDF du jour en téléchargement', async () => {
    const f = fakeSupabase(() => ({ data: [{ pdf_path: '2026-11-06/daily-brief-2026-11-06.pdf' }], error: null }));
    expect((await new SupabaseDataSource(f.client, today).pdf('2026-11-06'))?.kind).toBe('redirect');
    expect(f.signed[0]).toMatchObject({ bucket: 'pdf', options: { download: 'Daily Brief 2026-11-06.pdf' } });
  });
});
