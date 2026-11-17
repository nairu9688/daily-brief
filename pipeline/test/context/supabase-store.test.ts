import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ContextSchema, OpenThreadSchema } from '@daily-brief/schema';
import { MemoryContextStore, type StoredThread } from '../../context/memory-store';
import { runContext } from '../../context/run-context';
import { SupabaseContextStore } from '../../context/supabase-store';
import { createSupabaseClient } from '../../supabase/client';
import { FAKE_KEY, FAKE_URL, fakeSupabase, type FakeSupabase } from '../supabase/fake-supabase';
import { asRole, createTestDb, resetData, rows, rpc, type TestDb } from '../supabase/pg';

type Seed = { slug: string; lang?: 'fr' | 'en' | 'es'; updatedAt?: string; status?: 'open' | 'closed'; events?: string[] };

let db: TestDb;
let fake: FakeSupabase;
let store: SupabaseContextStore;

beforeAll(async () => {
  db = await createTestDb();
}, 60_000);
afterAll(async () => {
  await db.close();
});
beforeEach(async () => {
  await resetData(db);
  fake = fakeSupabase(db);
  store = new SupabaseContextStore(createSupabaseClient({ url: FAKE_URL, serviceKey: FAKE_KEY }, fake.fetch));
});

/** Insère des Threads et leurs événements ; renvoie l'id de chaque slug. */
async function seed(threads: Seed[]): Promise<Record<string, string>> {
  const ids: Record<string, string> = {};
  for (const t of threads) {
    const id = (
      await db.query<{ id: string }>(`insert into public.threads (slug, title, lang, status, updated_at) values ($1, $2, $3, $4, $5) returning id`, [
        t.slug,
        `Thread ${t.slug}`,
        t.lang ?? 'fr',
        t.status ?? 'open',
        t.updatedAt ?? '2026-10-01T08:00:00+02:00',
      ])
    ).rows[0].id;
    ids[t.slug] = id;
    for (const date of t.events ?? []) await db.query(`insert into public.thread_events (thread_id, date, title) values ($1, $2, 'événement')`, [id, date]);
  }
  return ids;
}

const slugsOf = (ids: Record<string, string>, list: string[]) => list.map((id) => Object.keys(ids).find((s) => ids[s] === id)).sort();
const openSlugs = async () => (await rows<{ slug: string }>(db, `select slug from public.threads where status = 'open' order by slug`)).map((r) => r.slug);

const R12: Seed[] = [
  { slug: 'vieux', events: ['2026-10-01', '2026-10-16'] },
  { slug: 'frais', events: ['2026-10-17'] },
  { slug: 'sans-evenement', updatedAt: '2026-10-10T09:00:00Z' },
  { slug: 'minuit-paris', updatedAt: '2026-10-16T22:30:00Z' },
  { slug: 'deja-ferme', status: 'closed', events: ['2026-01-01'] },
  { slug: 'futur', events: ['2026-11-20'] },
];

describe('SupabaseContextStore', () => {
  it('ferme les seuls Threads périmés (21 jours pleins), une seule fois', async () => {
    const ids = await seed(R12);
    expect(slugsOf(ids, await store.closeStaleThreads('2026-11-06'))).toEqual(['sans-evenement', 'vieux']);
    expect(await openSlugs()).toEqual(['frais', 'futur', 'minuit-paris']);
    expect(await store.closeStaleThreads('2026-11-06')).toEqual([]);
    // « minuit-paris » : 22:30 UTC le 16 = le 17 à Paris, donc fermé le 7 seulement, comme « frais ».
    expect(slugsOf(ids, await store.closeStaleThreads('2026-11-07', 21))).toEqual(['frais', 'minuit-paris']);
  });

  it('ferme exactement les mêmes Threads que le store en mémoire', async () => {
    const ids = await seed(R12);
    const memory = new MemoryContextStore({
      threads: R12.map((t): StoredThread => ({ id: t.slug, slug: t.slug, title: t.slug, lang: t.lang ?? 'fr', updatedAt: t.updatedAt ?? '2026-10-01T08:00:00+02:00', status: t.status ?? 'open', events: t.events ?? [] })),
    });
    for (const date of ['2026-11-01', '2026-11-06', '2026-11-07', '2026-12-31']) {
      expect(slugsOf(ids, await store.closeStaleThreads(date))).toEqual(await memory.closeStaleThreads(date));
    }
  });

  it('renvoie les ids fermés triés', async () => {
    await seed([{ slug: 'a', events: ['2026-01-01'] }, { slug: 'b', events: ['2026-01-01'] }, { slug: 'c', events: ['2026-01-01'] }]);
    const closed = await store.closeStaleThreads('2026-11-06');
    expect(closed).toHaveLength(3);
    expect(closed).toEqual([...closed].sort());
  });

  it('note les fermetures dans runs, et les cumule entre deux passages du même jour', async () => {
    const ids = await seed([{ slug: 'vieux', events: ['2026-10-01'] }, { slug: 'frais', events: ['2026-10-17'] }]);
    await store.closeStaleThreads('2026-11-06');
    expect(await rows(db, `select date::text as date, status, steps from public.runs`)).toEqual([{ date: '2026-11-06', status: 'running', steps: { closedThreads: [ids.vieux] } }]);
    // Second passage le même jour, avec un délai plus court : le premier Thread fermé reste noté.
    await store.closeStaleThreads('2026-11-06', 20);
    const [run] = await rows<{ steps: { closedThreads: string[] } }>(db, 'select steps from public.runs');
    expect(run.steps.closedThreads).toEqual([ids.vieux, ids.frais].sort());
    // Rien à fermer : pas de nouvelle ligne.
    expect(await store.closeStaleThreads('2026-11-07', 1)).toEqual([]);
    expect(await rows(db, 'select date::text as date from public.runs')).toEqual([{ date: '2026-11-06' }]);
  });

  it('save_run garde les fermetures déjà notées', async () => {
    const ids = await seed([{ slug: 'vieux', events: ['2026-10-01'] }]);
    await store.closeStaleThreads('2026-11-06');
    await rpc(db, 'save_run', { p_date: '2026-11-06', p_status: 'ok', p_steps: { publish: { status: 'ok' }, closedThreads: ['intrus'] }, p_notes: null });
    expect(await rows(db, 'select status, steps from public.runs')).toEqual([{ status: 'ok', steps: { publish: { status: 'ok' }, closedThreads: [ids.vieux] } }]);
  });

  it('Threads ouverts au format OpenThread : updatedAt en ISO avec T et Z', async () => {
    const ids = await seed([
      { slug: 'fr-greve', updatedAt: '2026-11-05T08:00:00+01:00' },
      { slug: 'en-midterms', lang: 'en', updatedAt: '2026-11-04T23:59:59.123Z' },
      { slug: 'ferme', status: 'closed' },
    ]);
    const threads = await store.openThreads();
    expect(threads).toEqual([
      { id: ids['en-midterms'], slug: 'en-midterms', title: 'Thread en-midterms', lang: 'en', updatedAt: '2026-11-04T23:59:59.123Z' },
      { id: ids['fr-greve'], slug: 'fr-greve', title: 'Thread fr-greve', lang: 'fr', updatedAt: '2026-11-05T07:00:00.000Z' },
    ]);
    for (const t of threads) expect(OpenThreadSchema.safeParse(t).success).toBe(true);
  });

  it('sujets de la veille seulement, par langue puis par position', async () => {
    const edition = async (date: string, lang: string, titles: string[]) => {
      const id = (await db.query<{ id: string }>(`insert into public.editions (date, lang, region, headline, morning_brief, generated_at) values ($1, $2, 'r', 'h', '[]', now()) returning id`, [date, lang])).rows[0].id;
      for (const [i, title] of titles.entries()) {
        await db.query(`insert into public.stories (edition_id, key, rubric, position, kicker, date_label, title, summary, visual) values ($1, $2, 'pol', $3, 'k', 'd', $4, 's', '{}')`, [id, `k${i}`, titles.length - i, title]);
      }
    };
    await edition('2026-11-05', 'fr', ['Second', 'Budget au Sénat']);
    await edition('2026-11-05', 'es', ['Presupuestos']);
    await edition('2026-11-04', 'fr', ['Avant-veille']);
    await edition('2026-11-06', 'fr', ['Aujourd’hui']);
    expect(await store.yesterdayTopics('2026-11-06')).toEqual([
      { lang: 'es', title: 'Presupuestos' },
      { lang: 'fr', title: 'Budget au Sénat' },
      { lang: 'fr', title: 'Second' },
    ]);
    expect(await store.yesterdayTopics('2026-03-01')).toEqual([]);
  });

  it('anomalies : événement à plus de 7 jours dans le futur, Threads ouverts seulement', async () => {
    const ids = await seed([
      { slug: 'loin', events: ['2026-11-05', '2026-11-14', '2026-12-01'] },
      { slug: 'limite', events: ['2026-11-13'] },
      { slug: 'ferme', status: 'closed', events: ['2027-01-01'] },
    ]);
    expect(await store.anomalies('2026-11-06')).toEqual([{ threadId: ids.loin, kind: 'future-event', detail: 'événement daté du 2026-12-01, à plus de 7 jours dans le futur' }]);
  });

  it('transmet le signal reçu : rien n’est écrit après une annulation', async () => {
    await seed([{ slug: 'vieux', events: ['2026-10-01'] }]);
    const c = new AbortController();
    c.abort();
    await expect(store.closeStaleThreads('2026-11-06', 21, c.signal)).rejects.toThrow();
    expect(await openSlugs()).toEqual(['vieux']);
    expect(fake.calls[0].signal?.aborted).toBe(true);
  });

  it('une réponse d’une forme inattendue est une erreur, pas une liste vide', async () => {
    fake.intercept = () => ({ json: { ids: [] } });
    await expect(store.closeStaleThreads('2026-11-06')).rejects.toThrow('Supabase close_stale_threads : réponse inattendue');
    await expect(store.openThreads()).rejects.toThrow('Supabase context_open_threads : réponse inattendue');
  });

  it('close_stale_threads refuse un nombre de jours inférieur à 1 ; save_run exige un objet', async () => {
    const ids = await seed([{ slug: 'vieux', events: ['2026-10-01'] }]);
    for (const days of [0, -5]) await expect(rpc(db, 'close_stale_threads', { p_date: '2026-11-06', p_days: days })).rejects.toThrow(/p_days/);
    await expect(store.closeStaleThreads('2026-11-06', 0)).rejects.toThrow(/p_days/);
    expect(await openSlugs()).toEqual(['vieux']);
    for (const steps of [[1], 'texte', 3, null, true]) {
      await expect(asRole(db, 'service_role', (tx) => tx.query(`select public.save_run('2026-11-06', 'ok', $1::jsonb)`, [JSON.stringify(steps)]))).rejects.toThrow(/p_steps/);
    }
    expect(await rows(db, 'select * from public.runs')).toEqual([]);
    expect(ids.vieux).toBeTruthy();
  });

  it('les fonctions de contexte sont refusées à l’utilisateur de l’appli et au rôle anon', async () => {
    for (const role of ['anon', { email: 'nanigeek@gmail.com' }] as const) {
      await expect(asRole(db, role, (tx) => tx.query(`select public.close_stale_threads('2026-11-06')`))).rejects.toThrow(/permission denied/);
      await expect(asRole(db, role, (tx) => tx.query('select public.context_open_threads()'))).rejects.toThrow(/permission denied/);
      await expect(asRole(db, role, (tx) => tx.query(`select public.save_run('2026-11-06', 'ok', '{}')`))).rejects.toThrow(/permission denied/);
    }
  });
});

describe('runContext avec le store Supabase', () => {
  it('écrit context.json et le rapport, ferme les Threads périmés, signale une anomalie', async () => {
    const ids = await seed([
      { slug: 'vieux', events: ['2026-10-01'] },
      { slug: 'fr-greve', updatedAt: '2026-11-05T08:00:00Z', events: ['2026-11-05'] },
      { slug: 'en-midterms', lang: 'en', updatedAt: '2026-11-04T08:00:00Z', events: ['2026-11-04', '2026-12-25'] },
    ]);
    const outDir = mkdtempSync(join(tmpdir(), 'context-sb-'));
    const r = await runContext({ outDir, date: '2026-11-06', store, secrets: [FAKE_KEY], now: new Date('2026-11-06T04:13:00Z') });
    expect(r.exitCode).toBe(0);
    const context = ContextSchema.parse(JSON.parse(readFileSync(join(outDir, '2026-11-06', 'context.json'), 'utf8')));
    expect(context.openThreads.map((t) => t.slug)).toEqual(['fr-greve', 'en-midterms']);
    expect(r.report).toMatchObject({ store: 'supabase', closedThreads: [ids.vieux], openThreads: 2 });
    expect(r.report.issues).toEqual([{ level: 'warning', message: `Thread ${ids['en-midterms']} : événement daté du 2026-12-25, à plus de 7 jours dans le futur` }]);
  });

  it('clé refusée : code 2, pas de context.json, la clé n’est dans aucun fichier', async () => {
    const outDir = mkdtempSync(join(tmpdir(), 'context-sb-'));
    const bad = new SupabaseContextStore(createSupabaseClient({ url: FAKE_URL, serviceKey: 'mauvaise-clé-secrète' }, fake.fetch));
    const r = await runContext({ outDir, date: '2026-11-06', store: bad, secrets: ['mauvaise-clé-secrète'] });
    expect(r.exitCode).toBe(2);
    expect(r.report.issues).toEqual([{ level: 'error', message: 'store supabase : Supabase close_stale_threads : HTTP 401 — Invalid API key' }]);
    expect(readFileSync(join(outDir, '2026-11-06', 'context-report.json'), 'utf8')).not.toContain('mauvaise-clé-secrète');
  });
});
