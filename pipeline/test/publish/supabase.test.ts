import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Edition } from '@daily-brief/schema';
import { mp3File, pdfFile } from '../../publish/files';
import type { LocalFile } from '../../publish/inputs';
import { editionPayload } from '../../publish/rows';
import { publishEditions, uploadFiles, type PublishMeta } from '../../publish/supabase';
import { createSupabaseClient, type SupabaseClient } from '../../supabase/client';
import { FAKE_KEY, FAKE_URL, fakeSupabase, type FakeSupabase } from '../supabase/fake-supabase';
import { ALLOWED_EMAIL, asRole, createTestDb, resetData, rows, rpc, type TestDb } from '../supabase/pg';
import { DAY, editionFor, MP3_BYTES, PDF_BYTES, RENDERED_AT } from './day';

let db: TestDb;
let fake: FakeSupabase;
let client: SupabaseClient;

beforeAll(async () => {
  db = await createTestDb();
}, 60_000);
afterAll(async () => {
  await db.close();
});
beforeEach(async () => {
  await resetData(db);
  fake = fakeSupabase(db);
  client = createSupabaseClient({ url: FAKE_URL, serviceKey: FAKE_KEY }, fake.fetch);
});

const META: PublishMeta = { stored: [pdfFile(DAY)], light: {}, generatedAt: RENDERED_AT };
const count = async (table: string, where = 'true') => (await rows<{ n: number }>(db, `select count(*)::int as n from public.${table} where ${where}`))[0].n;
const publish = (editions: Edition[], meta: PublishMeta = META) => publishEditions(client, editions, meta);
const threads = () => rows<{ slug: string; lang: string; status: string; followed: boolean; events: number }>(
  db,
  `select t.slug, t.lang, t.status, t.followed, (select count(*)::int from public.thread_events e where e.thread_id = t.id) as events from public.threads t order by t.slug`,
);

describe('publishEditions', () => {
  it('publie les trois éditions de la fixture : lignes, rangs et Threads', async () => {
    const editions = [editionFor('fr'), editionFor('en'), editionFor('es')];
    const r = await publish(editions);
    expect(r.issues).toEqual([]);
    expect(r.results).toEqual([
      { lang: 'fr', published: true, stories: 7, sources: 26, vocab: 0, threadsCreated: 4 },
      { lang: 'en', published: true, stories: 1, sources: 11, vocab: 6, threadsCreated: 1 },
      { lang: 'es', published: true, stories: 2, sources: 13, vocab: 6, threadsCreated: 1 },
    ]);
    expect(await rows(db, `select date::text as date, lang, status, pdf_path, audio_path, vocab_title, generated_at = $1::timestamptz as same from public.editions order by lang`, [RENDERED_AT])).toEqual([
      { date: DAY, lang: 'en', status: 'published', pdf_path: '2026-11-06/daily-brief-2026-11-06.pdf', audio_path: null, vocab_title: editions[1].vocab!.title, same: true },
      { date: DAY, lang: 'es', status: 'published', pdf_path: '2026-11-06/daily-brief-2026-11-06.pdf', audio_path: null, vocab_title: editions[2].vocab!.title, same: true },
      { date: DAY, lang: 'fr', status: 'published', pdf_path: '2026-11-06/daily-brief-2026-11-06.pdf', audio_path: null, vocab_title: null, same: true },
    ]);
    expect(await threads()).toEqual([
      { slug: 'en-midterms-2026', lang: 'en', status: 'open', followed: false, events: 1 },
      { slug: 'es-crisis-ferroviaria-2026', lang: 'es', status: 'open', followed: false, events: 1 },
      { slug: 'fr-episodes-mediterraneens-2026', lang: 'fr', status: 'open', followed: false, events: 1 },
      { slug: 'fr-guerre-en-ukraine', lang: 'fr', status: 'open', followed: false, events: 1 },
      { slug: 'fr-midterms-2026', lang: 'fr', status: 'open', followed: false, events: 1 },
      { slug: 'fr-mobilisation-sociale-de-l-automne', lang: 'fr', status: 'open', followed: false, events: 1 },
    ]);
  });

  it('écrit le sujet tel que dans le JSON, et l’événement de son Thread à la date de l’édition', async () => {
    const fr = editionFor('fr');
    await publish([fr]);
    const st = fr.sections[0].stories[0];
    const [row] = await rows(
      db,
      `select s.key, s.rubric, s.position, s.kicker, s.date_label, s.title, s.summary, s.visual, s.stats, s.quote, s.divergences, s.prepa, s.thread_subtitle, t.slug
       from public.stories s left join public.threads t on t.id = s.thread_id where s.position = 1`,
    );
    expect(row).toEqual({ key: st.id, rubric: 'pol', position: 1, kicker: st.kicker, date_label: st.date, title: st.title, summary: st.summary, visual: st.visual, stats: st.stats, quote: st.quote, divergences: st.divergences, prepa: st.prepa, thread_subtitle: st.thread!.subtitle, slug: 'fr-mobilisation-sociale-de-l-automne' });
    expect(await rows(db, `select e.date::text as date, e.title, e.text from public.thread_events e join public.threads t on t.id = e.thread_id where t.slug = 'fr-mobilisation-sociale-de-l-automne'`)).toEqual([
      { date: DAY, title: st.title, text: st.thread!.subtitle },
    ]);
    expect(await rows(db, `select outlet, url, read_full, position from public.sources where story_id = (select id from public.stories where position = 1) order by position`)).toEqual(
      st.sources.map((s, i) => ({ outlet: s.outlet, url: s.url, read_full: s.readFull, position: i + 1 })),
    );
    expect(await count('sources', 'story_id is null')).toBe(4);
    // Une citation ou un lien prépa absent est NULL en base, pas le JSON « null ».
    expect(await count('stories', `quote = 'null'::jsonb or prepa = 'null'::jsonb`)).toBe(0);
    expect(await count('stories', 'quote is null')).toBe(fr.sections.flatMap((s) => s.stories).filter((s) => s.quote === null).length);
  });

  it('relancer la même date remplace les données sans doublon', async () => {
    const editions = [editionFor('fr'), editionFor('en'), editionFor('es')];
    await publish(editions);
    const before = [await count('editions'), await count('stories'), await count('sources'), await count('vocab_items'), await count('threads'), await count('thread_events')];
    const ids = await rows(db, 'select id from public.editions order by lang');
    const r = await publish(editions);
    expect(r.results.map((x) => x.threadsCreated)).toEqual([0, 0, 0]);
    expect([await count('editions'), await count('stories'), await count('sources'), await count('vocab_items'), await count('threads'), await count('thread_events')]).toEqual(before);
    expect(before).toEqual([3, 10, 50, 12, 6, 6]);
    expect(await rows(db, 'select id from public.editions order by lang')).toEqual(ids);
  });

  it('relancer avec une édition modifiée : titre, sujets retirés et brèves suivent', async () => {
    await publish([editionFor('fr')]);
    const changed = editionFor('fr', DAY, (e) => {
      e.headline = 'Nouveau titre du jour';
      e.sections = e.sections.slice(0, 1);
      e.sections[0].briefs = [];
    });
    await publish([changed]);
    expect(await rows(db, 'select headline from public.editions')).toEqual([{ headline: 'Nouveau titre du jour' }]);
    expect([await count('stories'), await count('sources', 'story_id is null')]).toEqual([1, 0]);
    // Les Threads créés par la première publication et restés sans événement disparaissent.
    expect((await threads()).map((t) => t.slug)).toEqual(['fr-mobilisation-sociale-de-l-automne']);
  });

  it('garde les mots cochés et leur état Anki quand la date est relancée', async () => {
    const en = editionFor('en');
    await publish([en]);
    const [a, b, c] = en.vocab!.items.map((v) => v.term);
    await asRole(db, { email: ALLOWED_EMAIL }, async (tx) => {
      await tx.query(`update public.vocab_items set selected = true, anki_status = 'queued' where term = $1`, [a]);
      await tx.query(`update public.vocab_items set selected = true where term = $1`, [b]);
    });
    await db.query(`update public.vocab_items set anki_status = 'sent' where term = $1`, [c]);
    // Relance : même mot écrit autrement (casse, espaces), un mot remplacé, ordre inversé.
    const again = editionFor('en', DAY, (e) => {
      e.vocab!.items[0].term = `  ${a.toUpperCase()} `;
      e.vocab!.items[5].term = 'brand-new word';
      e.vocab!.items.reverse();
    });
    await publish([again]);
    const state = await rows<{ term: string; selected: boolean; anki_status: string; position: number }>(db, 'select term, selected, anki_status, position from public.vocab_items order by position');
    expect(state).toHaveLength(6);
    expect(state.find((v) => v.term === `  ${a.toUpperCase()} `)).toMatchObject({ selected: true, anki_status: 'queued', position: 6 });
    expect(state.find((v) => v.term === b)).toMatchObject({ selected: true, anki_status: 'none' });
    expect(state.find((v) => v.term === c)).toMatchObject({ selected: false, anki_status: 'sent' });
    expect(state.find((v) => v.term === 'brand-new word')).toMatchObject({ selected: false, anki_status: 'none', position: 1 });
  });

  it('l’état d’un mot ne passe ni à une autre langue ni à une autre date', async () => {
    const en = editionFor('en');
    await publish([en]);
    await db.query(`update public.vocab_items set selected = true, anki_status = 'queued'`);
    const es = editionFor('es', DAY, (e) => {
      e.vocab!.items[0].term = en.vocab!.items[0].term;
    });
    const tomorrow = editionFor('en', '2026-11-07');
    await publish([es, tomorrow], { ...META, stored: [] });
    expect(await count('vocab_items', `selected and edition_id in (select id from public.editions where lang = 'es' or date = '2026-11-07')`)).toBe(0);
    expect(await count('vocab_items', 'selected')).toBe(6);
  });

  it('garde « suivi » sur un Thread quand la date est relancée', async () => {
    const fr = editionFor('fr');
    await publish([fr]);
    await asRole(db, { email: ALLOWED_EMAIL }, (tx) => tx.query(`update public.threads set followed = true where slug = 'fr-guerre-en-ukraine'`));
    const id = (await rows<{ id: string }>(db, `select id from public.threads where slug = 'fr-guerre-en-ukraine'`))[0].id;
    await publish([fr]);
    expect(await rows(db, `select id, followed from public.threads where slug = 'fr-guerre-en-ukraine'`)).toEqual([{ id, followed: true }]);
  });

  it('rattache un sujet au Thread existant désigné par son id, sans le renommer', async () => {
    const id = (await db.query<{ id: string }>(`insert into public.threads (slug, title, lang, updated_at) values ('fr-guerre-en-ukraine', 'Guerre en Ukraine', 'fr', '2026-10-01T00:00:00Z') returning id`)).rows[0].id;
    await db.query(`insert into public.thread_events (thread_id, date, title) values ($1, '2026-10-30', 'Étape précédente')`, [id]);
    const fr = editionFor('fr', DAY, (e) => {
      e.sections = e.sections.filter((s) => s.key === 'int');
      e.sections[0].stories = e.sections[0].stories.filter((s) => s.thread?.title === 'Guerre en Ukraine');
      e.sections[0].stories[0].thread = { id, title: 'Un autre libellé', subtitle: 'l’énergie, cible de l’hiver' };
    });
    const r = await publish([fr]);
    expect(r.issues).toEqual([]);
    expect(r.results[0].threadsCreated).toBe(0);
    expect(await rows(db, `select t.title, (t.updated_at > '2026-11-01') as refreshed, (select count(*)::int from public.thread_events e where e.thread_id = t.id) as events from public.threads t`)).toEqual([
      { title: 'Guerre en Ukraine', refreshed: true, events: 2 },
    ]);
    // Relance : l'événement du jour est remplacé, l'ancien reste, le Thread aussi.
    await publish([fr]);
    expect(await rows(db, `select date::text as date from public.thread_events order by date`)).toEqual([{ date: '2026-10-30' }, { date: DAY }]);
  });

  it('id de Thread inconnu ou d’une autre langue : nouveau Thread et avertissement', async () => {
    const other = (await db.query<{ id: string }>(`insert into public.threads (slug, title, lang) values ('en-x', 'X', 'en') returning id`)).rows[0].id;
    await db.query(`insert into public.thread_events (thread_id, date, title) values ($1, '2026-11-01', 'x')`, [other]);
    const fr = editionFor('fr', DAY, (e) => {
      e.sections = e.sections.slice(0, 2);
      e.sections[0].stories[0].thread = { id: other, title: 'Mobilisation', subtitle: 's' };
      e.sections[1].stories[0].thread = { id: 'pas-un-uuid', title: 'Midterms 2026', subtitle: 's' };
      e.sections[1].stories[1].thread = null;
    });
    const r = await publish([fr]);
    expect(r.results[0]).toMatchObject({ published: true, threadsCreated: 2 });
    expect(r.issues).toEqual([
      { level: 'warning', lang: 'fr', message: `2026-11-06-fr-1 : Thread ${other} inconnu ou d'une autre langue, traité comme nouveau Thread` },
      { level: 'warning', lang: 'fr', message: `2026-11-06-fr-2 : Thread pas-un-uuid inconnu ou d'une autre langue, traité comme nouveau Thread` },
    ]);
    expect((await threads()).map((t) => [t.slug, t.events])).toEqual([
      ['en-x', 1],
      ['fr-midterms-2026', 1],
      ['fr-mobilisation', 1],
    ]);
  });

  it('nouveau Thread de même titre qu’un Thread ouvert : rattaché ; qu’un Thread fermé : nouveau slug daté, stable à la relance', async () => {
    await db.query(`insert into public.threads (slug, title, lang, status) values ('fr-midterms-2026', 'Midterms 2026', 'fr', 'open'), ('fr-guerre-en-ukraine', 'Guerre en Ukraine', 'fr', 'closed')`);
    const fr = editionFor('fr', DAY, (e) => {
      e.sections = e.sections.filter((s) => s.key === 'int');
    });
    const first = await publish([fr]);
    expect(first.results[0].threadsCreated).toBe(1);
    const expected = [
      { slug: 'fr-guerre-en-ukraine', lang: 'fr', status: 'closed', followed: false, events: 0 },
      { slug: 'fr-guerre-en-ukraine-2026-11-06', lang: 'fr', status: 'open', followed: false, events: 1 },
      { slug: 'fr-midterms-2026', lang: 'fr', status: 'open', followed: false, events: 1 },
    ];
    expect(await threads()).toEqual(expected);
    const second = await publish([fr]);
    expect(second.results[0].threadsCreated).toBe(0);
    expect(await threads()).toEqual(expected);
  });

  it('un événement rouvre un Thread fermé désigné par son id', async () => {
    const id = (await db.query<{ id: string }>(`insert into public.threads (slug, title, lang, status) values ('fr-ancien', 'Ancien', 'fr', 'closed') returning id`)).rows[0].id;
    const fr = editionFor('fr', DAY, (e) => {
      e.sections = e.sections.slice(0, 1);
      e.sections[0].stories[0].thread = { id, title: 'Ancien', subtitle: 'reprise' };
    });
    await publish([fr]);
    expect(await threads()).toEqual([{ slug: 'fr-ancien', lang: 'fr', status: 'open', followed: false, events: 1 }]);
  });

  it('une édition en échec n’écrit rien (transaction) et n’empêche pas les autres', async () => {
    await publish([editionFor('en')]);
    const before = [await count('stories'), await count('sources'), await count('vocab_items'), await count('threads')];
    const headline = (await rows<{ headline: string }>(db, 'select headline from public.editions'))[0].headline;
    // Charge altérée en route : la seconde source du dernier sujet viole une contrainte NOT NULL,
    // après que l'en-tête, les sujets et les premières sources ont été écrits dans la transaction.
    const viaBroken = createSupabaseClient({ url: FAKE_URL, serviceKey: FAKE_KEY }, async (url, init) => {
      const body = typeof init?.body === 'string' && url.endsWith('/publish_edition') ? JSON.parse(init.body) : null;
      if (body?.payload.edition.lang !== 'en') return fake.fetch(url, init);
      body.payload.edition.headline = 'Titre qui ne doit pas rester';
      body.payload.stories.at(-1).sources[1].readFull = null;
      return fake.fetch(url, { ...init, body: JSON.stringify(body) });
    });
    const r = await publishEditions(viaBroken, [editionFor('en'), editionFor('es')], META);
    expect(r.results.map((x) => [x.lang, x.published])).toEqual([
      ['en', false],
      ['es', true],
    ]);
    expect(r.issues).toHaveLength(1);
    expect(r.issues[0]).toMatchObject({ level: 'error', lang: 'en' });
    expect(r.issues[0].message).toMatch(/^édition non publiée : Supabase publish_edition : HTTP 400 23502 — /);
    expect(await rows(db, `select headline from public.editions where lang = 'en'`)).toEqual([{ headline }]);
    expect([await count('stories', `edition_id in (select id from public.editions where lang = 'en')`), await count('vocab_items', `lang = 'en'`)]).toEqual([before[0], before[2]]);
    expect(await count('editions')).toBe(2);
  });

  it('statut « light » et chemin audio par édition, d’après les fichiers réellement déposés', async () => {
    await publish([editionFor('fr'), editionFor('en')], { stored: [mp3File(DAY, 'en')], light: { fr: true }, generatedAt: RENDERED_AT });
    expect(await rows(db, 'select lang, status, pdf_path, audio_path from public.editions order by lang')).toEqual([
      { lang: 'en', status: 'published', pdf_path: null, audio_path: '2026-11-06/en.mp3' },
      { lang: 'fr', status: 'light', pdf_path: null, audio_path: null },
    ]);
  });

  it('Supabase coupé : chaque édition est en erreur, sans nouvel appel', async () => {
    fake.intercept = () => ({ status: 401, json: { message: 'Invalid API key' } });
    const r = await publish([editionFor('fr'), editionFor('en')]);
    expect(r.results.map((x) => x.published)).toEqual([false, false]);
    expect(r.issues.map((i) => i.message)).toEqual(['édition non publiée : Supabase publish_edition : HTTP 401 — Invalid API key', 'édition non publiée : Supabase coupé (HTTP 401)']);
    expect(fake.calls).toHaveLength(1);
  });

  it('un Thread suivi n’est jamais supprimé, même devenu orphelin à la relance', async () => {
    const fr = editionFor('fr');
    await publish([fr]);
    await asRole(db, { email: ALLOWED_EMAIL }, (tx) => tx.query(`update public.threads set followed = true where slug = 'fr-guerre-en-ukraine'`));
    const without = editionFor('fr', DAY, (e) => {
      for (const sec of e.sections) for (const st of sec.stories) st.thread = null;
    });
    await publish([without]);
    expect(await threads()).toEqual([{ slug: 'fr-guerre-en-ukraine', lang: 'fr', status: 'open', followed: true, events: 0 }]);
  });

  it('le Thread daté d’un Thread fermé est repris le lendemain, sans nouveau Thread', async () => {
    await db.query(`insert into public.threads (slug, title, lang, status) values ('fr-x', 'X', 'fr', 'closed')`);
    const day = (date: string) =>
      editionFor('fr', date, (e) => {
        e.sections = e.sections.slice(0, 1);
        e.sections[0].stories = e.sections[0].stories.slice(0, 1);
        e.sections[0].stories[0].thread = { title: 'X', subtitle: 's' };
      });
    expect((await publish([day(DAY)])).results[0].threadsCreated).toBe(1);
    expect((await publish([day('2026-11-07')])).results[0].threadsCreated).toBe(0);
    expect(await threads()).toEqual([
      { slug: 'fr-x', lang: 'fr', status: 'closed', followed: false, events: 0 },
      { slug: 'fr-x-2026-11-06', lang: 'fr', status: 'open', followed: false, events: 2 },
    ]);
  });

  it('refuse une date qui n’est pas AAAA-MM-JJ', async () => {
    for (const date of ['today', 'epoch', '2026-1-1', '2026-11-06T00:00:00Z']) {
      await expect(rpc(db, 'publish_edition', { payload: { edition: { date, lang: 'fr' } } })).rejects.toThrow('publish_edition : édition absente ou incomplète');
    }
  });

  it('publish_edition refuse une charge sans édition, et n’est pas appelable par l’appli', async () => {
    await expect(rpc(db, 'publish_edition', { payload: {} })).rejects.toThrow('publish_edition : édition absente ou incomplète');
    const payload = editionPayload(editionFor('en'), { pdfPath: null, audioPath: null, light: false, generatedAt: RENDERED_AT });
    await expect(rpc(db, 'publish_edition', { payload }, { email: ALLOWED_EMAIL })).rejects.toThrow(/permission denied/);
    await expect(rpc(db, 'publish_edition', { payload }, 'anon')).rejects.toThrow(/permission denied/);
    expect(await count('editions')).toBe(0);
  });
});

describe('uploadFiles', () => {
  const pdf: LocalFile = { ...pdfFile(DAY), bytes: PDF_BYTES };
  const mp3: LocalFile = { ...mp3File(DAY, 'fr'), lang: 'fr', bytes: MP3_BYTES };

  it('dépose le PDF et les MP3 à leur chemin, avec leur type', async () => {
    const r = await uploadFiles(client, [pdf, mp3]);
    expect(r).toEqual({ stored: [pdfFile(DAY), mp3File(DAY, 'fr')], issues: [] });
    expect([...fake.files.entries()].map(([k, v]) => [k, v.contentType, v.bytes.length])).toEqual([
      ['pdf/2026-11-06/daily-brief-2026-11-06.pdf', 'application/pdf', PDF_BYTES.length],
      ['audio/2026-11-06/fr.mp3', 'audio/mpeg', MP3_BYTES.length],
    ]);
  });

  it('un envoi en échec donne un avertissement ; les autres fichiers passent', async () => {
    fake.intercept = (call) => (call.path.includes('/object/pdf/') ? { status: 413, json: { message: 'The object exceeded the maximum allowed size' } } : undefined);
    const r = await uploadFiles(client, [pdf, mp3]);
    expect(r.stored).toEqual([mp3File(DAY, 'fr')]);
    expect(r.issues).toEqual([
      { level: 'warning', message: 'Daily Brief 2026-11-06.pdf non déposé dans Supabase Storage : Supabase Storage (envoi pdf/2026-11-06/daily-brief-2026-11-06.pdf) : HTTP 413 — The object exceeded the maximum allowed size' },
    ]);
  });

  it('relancer remplace le fichier', async () => {
    await uploadFiles(client, [pdf]);
    const r = await uploadFiles(client, [{ ...pdf, bytes: Buffer.concat([PDF_BYTES, Buffer.from('v2')]) }]);
    expect(r.issues).toEqual([]);
    expect(fake.files.get('pdf/2026-11-06/daily-brief-2026-11-06.pdf')!.bytes.length).toBe(PDF_BYTES.length + 2);
  });
});
