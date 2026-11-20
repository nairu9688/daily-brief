import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { applyMigrations, createTestDb, migrationFiles, MIGRATIONS_DIR, rows, type TestDb } from './pg';

let db: TestDb;
beforeAll(async () => {
  db = await createTestDb();
}, 60_000);
afterAll(async () => {
  await db.close();
});

const insertEdition = (date: string, lang: string) =>
  db.query<{ id: string }>(`insert into public.editions (date, lang, region, headline, morning_brief, generated_at) values ($1, $2, 'r', 'h', '[]', now()) returning id`, [date, lang]);

const count = async (table: string) => (await rows<{ n: number }>(db, `select count(*)::int as n from public.${table}`))[0].n;

describe('migrations Supabase', () => {
  it('crée les huit tables du §6.2, toutes sous RLS', async () => {
    const t = await rows<{ relname: string; relrowsecurity: boolean }>(
      db,
      `select c.relname, c.relrowsecurity from pg_class c join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and c.relkind = 'r' order by 1`,
    );
    expect(t.map((r) => r.relname)).toEqual(['drive_pending', 'editions', 'runs', 'sources', 'stories', 'thread_events', 'threads', 'vocab_items']);
    expect(t.every((r) => r.relrowsecurity)).toBe(true);
  });

  it('crée les buckets privés audio et pdf', async () => {
    expect(await rows(db, 'select id, public, file_size_limit::int as file_size_limit, allowed_mime_types from storage.buckets order by id')).toEqual([
      { id: 'audio', public: false, file_size_limit: 20971520, allowed_mime_types: ['audio/mpeg'] },
      { id: 'pdf', public: false, file_size_limit: 52428800, allowed_mime_types: ['application/pdf'] },
    ]);
  });

  it('sont rejouables sans erreur et sans toucher à l’email autorisé', async () => {
    await db.exec(`update private.app_settings set value = 'autre@exemple.fr' where key = 'allowed_email'`);
    await applyMigrations(db);
    expect(await rows(db, 'select value from private.app_settings')).toEqual([{ value: 'autre@exemple.fr' }]);
    await db.exec(`update private.app_settings set value = 'nanigeek@gmail.com' where key = 'allowed_email'`);
  });

  it('ne dépendent pas de pg_cron', () => {
    expect(migrationFiles()[0]).toBe('0001_init.sql');
    for (const f of migrationFiles()) {
      const sql = readFileSync(join(MIGRATIONS_DIR, f), 'utf8');
      expect(sql).not.toMatch(/create extension/i);
      expect(sql).not.toMatch(/cron\.schedule/i);
    }
  });

  it('aucun droit par défaut : anon ne lit que les six tables de contenu, n’écrit nulle part, et aucune fonction de public n’est exécutable par anon ou authenticated', async () => {
    const tables = await rows<{ relname: string; anon_read: boolean; anon_write: boolean; authenticated_write: boolean }>(
      db,
      `select c.relname, has_table_privilege('anon', c.oid, 'select') as anon_read,
              has_table_privilege('anon', c.oid, 'insert, update, delete, truncate, references, trigger') as anon_write,
              has_table_privilege('authenticated', c.oid, 'insert, delete, truncate') as authenticated_write
       from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind in ('r', 'v', 'm', 'S') order by 1`,
    );
    expect(tables.length).toBeGreaterThanOrEqual(8);
    // Lecture publique (0005_public_read.sql) : le contenu du brief, jamais runs ni drive_pending.
    expect(tables.filter((t) => t.anon_read).map((t) => t.relname)).toEqual(['editions', 'sources', 'stories', 'thread_events', 'threads', 'vocab_items']);
    expect(tables.filter((t) => t.anon_write || t.authenticated_write)).toEqual([]);
    // Aucun droit de colonne en écriture pour anon (les droits de 0001 sont pour authenticated seulement).
    expect(
      await rows(db, `select table_name, column_name from information_schema.column_privileges where table_schema = 'public' and grantee = 'anon' and privilege_type <> 'SELECT'`),
    ).toEqual([]);
    // Fonctions de public volontairement exécutables par anon ou authenticated : aucune (clé service seulement).
    const INTENDED: string[] = [];
    const fns = await rows<{ proname: string }>(
      db,
      `select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('authenticated', p.oid, 'execute')) order by 1`,
    );
    expect(fns.map((f) => f.proname).filter((f) => !INTENDED.includes(f))).toEqual([]);
  });

  it('une fonction ajoutée plus tard dans public n’est exécutable par personne par défaut', async () => {
    await db.exec(`create function public.zz_tmp() returns int language sql as 'select 1'; create table public.zz_tmp_t (a int);`);
    try {
      expect(await rows(db, `select has_function_privilege('anon', 'public.zz_tmp()', 'execute') as a, has_function_privilege('authenticated', 'public.zz_tmp()', 'execute') as b, has_table_privilege('anon', 'public.zz_tmp_t', 'select') as c`)).toEqual([{ a: false, b: false, c: false }]);
    } finally {
      await db.exec('drop function public.zz_tmp(); drop table public.zz_tmp_t');
    }
  });

  it('impose l’unicité (date, lang) des éditions et les langues connues', async () => {
    await insertEdition('2026-01-01', 'fr');
    await expect(insertEdition('2026-01-01', 'fr')).rejects.toThrow(/editions_date_lang_key/);
    await expect(insertEdition('2026-01-01', 'de')).rejects.toThrow(/editions_lang_check/);
    await insertEdition('2026-01-01', 'en');
  });

  it('refuse un statut, une rubrique ou un état Anki inconnus', async () => {
    const id = (await insertEdition('2026-01-02', 'en')).rows[0].id;
    await expect(db.query(`insert into public.threads (slug, title, lang, status) values ('s', 't', 'fr', 'paused')`)).rejects.toThrow(/threads_status_check/);
    await expect(
      db.query(`insert into public.stories (edition_id, key, rubric, position, kicker, date_label, title, summary, visual) values ($1, 'k', 'xxx', 1, 'k', 'd', 't', 's', '{}')`, [id]),
    ).rejects.toThrow(/stories_rubric_check/);
    await expect(
      db.query(`insert into public.vocab_items (edition_id, lang, position, term, pos, translation, example, anki_status) values ($1, 'en', 1, 't', 'n', 't', 'e', 'done')`, [id]),
    ).rejects.toThrow(/vocab_items_anki_status_check/);
    await expect(db.query(`insert into public.runs (date, status) values ('2026-01-02', 'bof')`)).rejects.toThrow(/runs_status_check/);
  });

  it('thread_events.date est de type date', async () => {
    expect(
      await rows(db, `select data_type from information_schema.columns where table_schema = 'public' and table_name = 'thread_events' and column_name = 'date'`),
    ).toEqual([{ data_type: 'date' }]);
  });

  it('supprimer une édition emporte ses sujets, sources, mots et événements, pas les Threads', async () => {
    const id = (await insertEdition('2026-01-03', 'fr')).rows[0].id;
    const thread = (await db.query<{ id: string }>(`insert into public.threads (slug, title, lang) values ('fr-x', 'X', 'fr') returning id`)).rows[0].id;
    const story = (
      await db.query<{ id: string }>(
        `insert into public.stories (edition_id, key, rubric, position, kicker, date_label, title, summary, visual, thread_id) values ($1, 'k', 'pol', 1, 'k', 'd', 't', 's', '{}', $2) returning id`,
        [id, thread],
      )
    ).rows[0].id;
    await db.query(`insert into public.sources (edition_id, story_id, rubric, position, outlet, title, url, lang, read_full) values ($1, $2, 'pol', 1, 'o', 't', 'https://x', 'fr', true)`, [id, story]);
    await db.query(`insert into public.sources (edition_id, rubric, position, outlet, title, url, lang, read_full) values ($1, 'pol', 1, 'o', 't', 'https://y', 'fr', false)`, [id]);
    await db.query(`insert into public.thread_events (thread_id, date, title, story_id) values ($1, '2026-01-03', 't', $2)`, [thread, story]);
    await db.query(`insert into public.vocab_items (edition_id, lang, position, term, pos, translation, example) values ($1, 'fr', 1, 't', 'n', 't', 'e')`, [id]);
    const before = [await count('stories'), await count('sources'), await count('vocab_items'), await count('thread_events')];
    await db.query('delete from public.editions where id = $1', [id]);
    const after = [await count('stories'), await count('sources'), await count('vocab_items'), await count('thread_events')];
    expect(before.map((n, i) => n - after[i])).toEqual([1, 2, 1, 1]);
    expect(await count('threads')).toBe(1);
  });
});
