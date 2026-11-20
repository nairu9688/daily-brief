import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ALLOWED_EMAIL, asRole, createTestDb, rows, type Role, type TestDb } from './pg';

const CONTENT_TABLES = ['editions', 'stories', 'sources', 'threads', 'thread_events', 'vocab_items'];
const PRIVATE = ['runs', 'drive_pending'];
const TABLES = [...CONTENT_TABLES, ...PRIVATE];
const USER: Role = { email: ALLOWED_EMAIL };
const STRANGER: Role = { email: 'intrus@exemple.fr' };

let db: TestDb;
let edition: string;
let thread: string;
let vocab: string;

beforeAll(async () => {
  db = await createTestDb();
  edition = (await db.query<{ id: string }>(`insert into public.editions (date, lang, region, headline, morning_brief, generated_at) values ('2026-11-06', 'en', 'r', 'Titre', '[]', now()) returning id`)).rows[0].id;
  thread = (await db.query<{ id: string }>(`insert into public.threads (slug, title, lang) values ('en-midterms-2026', 'Midterms 2026', 'en') returning id`)).rows[0].id;
  const story = (
    await db.query<{ id: string }>(
      `insert into public.stories (edition_id, key, rubric, position, kicker, date_label, title, summary, visual, thread_id) values ($1, 'en-1', 'pol', 1, 'k', 'd', 't', 's', '{}', $2) returning id`,
      [edition, thread],
    )
  ).rows[0].id;
  await db.query(`insert into public.sources (edition_id, story_id, rubric, position, outlet, title, url, lang, read_full) values ($1, $2, 'pol', 1, 'PBS', 't', 'https://www.pbs.org/a', 'en', true)`, [edition, story]);
  await db.query(`insert into public.thread_events (thread_id, date, title, story_id) values ($1, '2026-11-06', 't', $2)`, [thread, story]);
  vocab = (await db.query<{ id: string }>(`insert into public.vocab_items (edition_id, lang, position, term, pos, translation, example) values ($1, 'en', 1, 'landslide', 'n.', 'raz-de-marée', 'A landslide.') returning id`, [edition])).rows[0].id;
  await db.query(`insert into public.runs (date, status) values ('2026-11-06', 'ok')`);
  await db.query(`insert into public.drive_pending (date, files) values ('2026-11-05', '[]')`);
  await db.query(`insert into storage.objects (bucket_id, name) values ('pdf', '2026-11-06/daily-brief-2026-11-06.pdf'), ('audio', '2026-11-06/en.mp3')`);
}, 60_000);
afterAll(async () => {
  await db.close();
});

const counts = (role: Role) =>
  asRole(db, role, async (tx) => {
    const out: Record<string, number> = {};
    for (const t of TABLES) {
      if (role === 'anon' && PRIVATE.includes(t)) continue;
      out[t] = (await tx.query<{ n: number }>(`select count(*)::int as n from public.${t}`)).rows[0].n;
    }
    return out;
  });
const ALL = { editions: 1, stories: 1, sources: 1, threads: 1, thread_events: 1, vocab_items: 1, runs: 1, drive_pending: 1 };
/** Ce que voit tout le monde (0005_public_read.sql) : le contenu, sans runs ni drive_pending. */
const CONTENT = { ...ALL, runs: 0, drive_pending: 0 };
const ANON = Object.fromEntries(CONTENT_TABLES.map((t) => [t, 1]));
const run = (role: Role, sql: string, params: unknown[] = []) => asRole(db, role, (tx) => tx.query(sql, params));

describe('RLS : lecture', () => {
  it('l’utilisateur autorisé lit toutes les tables', async () => {
    expect(await counts(USER)).toEqual(ALL);
  });

  it('l’email est comparé sans casse ni espaces', async () => {
    expect(await counts({ email: '  NaniGeek@Gmail.com ' })).toEqual(ALL);
  });

  it('un autre utilisateur connecté lit le contenu public, pas runs ni drive_pending', async () => {
    expect(await counts(STRANGER)).toEqual(CONTENT);
  });

  it('un jeton sans email lit le contenu public seulement', async () => {
    expect(await counts({ email: null })).toEqual(CONTENT);
  });

  it('le rôle anon (visiteur sans session) lit le contenu, mais jamais runs ni drive_pending', async () => {
    expect(await counts('anon')).toEqual(ANON);
    for (const t of PRIVATE) await expect(run('anon', `select count(*) from public.${t}`)).rejects.toThrow(/permission denied/);
  });

  it('le visiteur lit aussi les colonnes personnelles (cochés, état Anki, suivi) : sans risque, décision de 0005', async () => {
    const r = await run('anon', `select v.selected, v.anki_status, t.followed from public.vocab_items v, public.threads t`);
    expect(r.rows).toEqual([{ selected: false, anki_status: 'none', followed: false }]);
  });

  it('changer l’email autorisé prend effet aussitôt', async () => {
    await db.exec(`update private.app_settings set value = 'intrus@exemple.fr' where key = 'allowed_email'`);
    try {
      expect(await counts(USER)).toEqual(CONTENT);
      expect(await counts(STRANGER)).toEqual(ALL);
    } finally {
      await db.exec(`update private.app_settings set value = '${ALLOWED_EMAIL}' where key = 'allowed_email'`);
    }
  });

  it('sans réglage allowed_email, personne ne lit runs ni drive_pending', async () => {
    await db.exec(`delete from private.app_settings where key = 'allowed_email'`);
    try {
      expect(await counts(USER)).toEqual(CONTENT);
    } finally {
      await db.exec(`insert into private.app_settings (key, value) values ('allowed_email', '${ALLOWED_EMAIL}')`);
    }
  });

  it('un email vide ne correspond jamais, même si le réglage est vide', async () => {
    await db.exec(`update private.app_settings set value = '' where key = 'allowed_email'`);
    try {
      expect(await counts({ email: '' })).toEqual(CONTENT);
      expect(await counts({ email: '   ' })).toEqual(CONTENT);
      expect(await counts({ email: null })).toEqual(CONTENT);
    } finally {
      await db.exec(`update private.app_settings set value = '${ALLOWED_EMAIL}' where key = 'allowed_email'`);
    }
  });

  it('un jeton anonyme portant l’email autorisé ne lit que le contenu public', async () => {
    expect(await counts({ email: ALLOWED_EMAIL, anonymous: true })).toEqual(CONTENT);
  });

  it('le rôle anon portant l’email autorisé dans son jeton ne lit ni runs ni drive_pending', async () => {
    const asAnon = (sql: string) =>
      db.transaction(async (tx) => {
        await tx.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ role: 'anon', email: ALLOWED_EMAIL })]);
        await tx.exec('set local role anon');
        return tx.query(sql);
      });
    for (const t of PRIVATE) await expect(asAnon(`select count(*) from public.${t}`)).rejects.toThrow(/permission denied/);
    for (const t of CONTENT_TABLES) await expect(asAnon(`select count(*)::int as n from public.${t}`)).resolves.toMatchObject({ rows: [{ n: 1 }] });
  });

  it('une session sans aucune revendication de jeton ne lit que le contenu public', async () => {
    const out = await db.transaction(async (tx) => {
      await tx.exec('set local role authenticated');
      const n: Record<string, number> = {};
      for (const t of TABLES) n[t] = Number((await tx.query<{ n: number }>(`select count(*)::int as n from public.${t}`)).rows[0].n);
      return n;
    });
    expect(out).toEqual(CONTENT);
  });

  it('les réglages privés sont illisibles pour l’utilisateur, même autorisé', async () => {
    await expect(run(USER, 'select * from private.app_settings')).rejects.toThrow(/permission denied/);
    await expect(run('anon', 'select private.is_allowed_user()')).rejects.toThrow(/permission denied/);
  });

  it('la clé service lit tout', async () => {
    expect(await counts('service_role')).toEqual(ALL);
  });
});

describe('RLS : écriture', () => {
  it('l’utilisateur autorisé coche un mot et le met en file Anki', async () => {
    const r = await run(USER, `update public.vocab_items set selected = true, anki_status = 'queued' where id = $1 returning selected, anki_status`, [vocab]);
    expect(r.rows).toEqual([{ selected: true, anki_status: 'queued' }]);
  });

  it('l’utilisateur autorisé suit un Thread', async () => {
    const r = await run(USER, `update public.threads set followed = true where id = $1 returning followed`, [thread]);
    expect(r.rows).toEqual([{ followed: true }]);
  });

  it('l’utilisateur autorisé ne modifie aucune autre colonne', async () => {
    await expect(run(USER, `update public.vocab_items set term = 'x' where id = $1`, [vocab])).rejects.toThrow(/permission denied/);
    await expect(run(USER, `update public.vocab_items set selected = true, translation = 'x' where id = $1`, [vocab])).rejects.toThrow(/permission denied/);
    await expect(run(USER, `update public.threads set status = 'closed' where id = $1`, [thread])).rejects.toThrow(/permission denied/);
    await expect(run(USER, `update public.threads set title = 'x', followed = true where id = $1`, [thread])).rejects.toThrow(/permission denied/);
    await expect(run(USER, `update public.editions set headline = 'x' where id = $1`, [edition])).rejects.toThrow(/permission denied/);
  });

  it('l’utilisateur autorisé n’insère ni ne supprime rien', async () => {
    await expect(run(USER, `insert into public.threads (slug, title, lang) values ('x', 'x', 'fr')`)).rejects.toThrow(/permission denied/);
    await expect(run(USER, `insert into public.vocab_items (edition_id, lang, position, term, pos, translation, example) values ($1, 'en', 2, 't', 'n', 't', 'e')`, [edition])).rejects.toThrow(/permission denied/);
    for (const t of TABLES) await expect(run(USER, `delete from public.${t}`)).rejects.toThrow(/permission denied/);
  });

  it('un autre utilisateur ne modifie rien : aucune ligne touchée', async () => {
    expect((await run(STRANGER, `update public.vocab_items set selected = false where id = $1 returning id`, [vocab])).rows).toEqual([]);
    expect((await run(STRANGER, `update public.threads set followed = false where id = $1 returning id`, [thread])).rows).toEqual([]);
    expect(await rows(db, 'select selected from public.vocab_items')).toEqual([{ selected: true }]);
    expect(await rows(db, 'select followed from public.threads')).toEqual([{ followed: true }]);
  });

  it('un autre utilisateur ne modifie pas non plus les autres colonnes, ni n’insère ni ne supprime', async () => {
    await expect(run(STRANGER, `update public.vocab_items set term = 'x' where id = $1`, [vocab])).rejects.toThrow(/permission denied/);
    await expect(run(STRANGER, `update public.editions set headline = 'x' where id = $1`, [edition])).rejects.toThrow(/permission denied/);
    await expect(run(STRANGER, `insert into public.threads (slug, title, lang) values ('x', 'x', 'fr')`)).rejects.toThrow(/permission denied/);
    for (const t of TABLES) await expect(run(STRANGER, `delete from public.${t}`)).rejects.toThrow(/permission denied/);
  });

  it('le visiteur sans session (anon) ne modifie, n’insère ni ne supprime rien', async () => {
    await expect(run('anon', `update public.vocab_items set selected = false where id = $1`, [vocab])).rejects.toThrow(/permission denied/);
    await expect(run('anon', `update public.vocab_items set anki_status = 'none' where id = $1`, [vocab])).rejects.toThrow(/permission denied/);
    await expect(run('anon', `update public.threads set followed = false where id = $1`, [thread])).rejects.toThrow(/permission denied/);
    await expect(run('anon', `update public.editions set headline = 'x' where id = $1`, [edition])).rejects.toThrow(/permission denied/);
    await expect(run('anon', `update public.runs set status = 'ok'`)).rejects.toThrow(/permission denied/);
    await expect(run('anon', `insert into public.threads (slug, title, lang) values ('x', 'x', 'fr')`)).rejects.toThrow(/permission denied/);
    await expect(run('anon', `insert into public.runs (date, status) values ('2026-11-07', 'ok')`)).rejects.toThrow(/permission denied/);
    for (const t of TABLES) await expect(run('anon', `delete from public.${t}`)).rejects.toThrow(/permission denied/);
    expect(await rows(db, 'select selected, anki_status from public.vocab_items')).toEqual([{ selected: true, anki_status: 'queued' }]);
    expect(await rows(db, 'select followed from public.threads')).toEqual([{ followed: true }]);
  });

  it('une valeur d’état Anki inconnue est refusée', async () => {
    await expect(run(USER, `update public.vocab_items set anki_status = 'done' where id = $1`, [vocab])).rejects.toThrow(/vocab_items_anki_status_check/);
  });

  it('la clé service écrit partout', async () => {
    const r = await run('service_role', `update public.editions set headline = 'Nouveau titre' where id = $1 returning headline`, [edition]);
    expect(r.rows).toEqual([{ headline: 'Nouveau titre' }]);
  });
});

describe('RLS : stockage', () => {
  const files = (role: Role) => asRole(db, role, async (tx) => (await tx.query<{ n: number }>('select count(*)::int as n from storage.objects')).rows[0].n);

  it('tout le monde voit les fichiers des buckets audio et pdf (URL signées avec la clé publique), et eux seuls', async () => {
    await db.exec(`insert into storage.buckets (id, name, public) values ('autre', 'autre', false) on conflict do nothing`);
    await db.exec(`insert into storage.objects (bucket_id, name) values ('autre', 'secret.txt') on conflict do nothing`);
    try {
      expect(await files(USER)).toBe(2);
      expect(await files(STRANGER)).toBe(2);
      expect(await files('anon')).toBe(2);
      expect(await files('service_role')).toBe(3);
    } finally {
      await db.exec(`delete from storage.objects where bucket_id = 'autre'; delete from storage.buckets where id = 'autre'`);
    }
  });

  it('les buckets restent privés (public = false) : les fichiers ne s’ouvrent que par URL signée', async () => {
    expect(await rows(db, `select id, public from storage.buckets where id in ('audio', 'pdf') order by id`)).toEqual([
      { id: 'audio', public: false },
      { id: 'pdf', public: false },
    ]);
  });
});
