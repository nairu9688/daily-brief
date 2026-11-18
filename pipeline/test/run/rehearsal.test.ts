import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { LANGS, type Lang } from '@daily-brief/schema';
import { runAudio } from '../../audio/run-audio';
import type { HttpFetch } from '../../collect/http';
import { MemoryContextStore } from '../../context/memory-store';
import { canReadFull, loadWhitelist } from '../../lib/whitelist';
import { runContext } from '../../context/run-context';
import { runNewsletters } from '../../newsletters/run-newsletters';
import { runPublish } from '../../publish/run-publish';
import { runRender } from '../../render/run-render';
import { runFinish } from '../../run/finish';
import { runVerify } from '../../verify/run-verify';
import { fakeTts } from '../audio/fake-tts';
import { fixtureArticles, fixtureEdition, PROGRAMME_PATH, WHITELIST_PATH } from '../helpers';
import { DRIVE_TOKEN, startAppsScript } from '../publish/apps-script-server';
import { fakeFetch } from '../render/fake-fetch';
import { FAKE_KEY, FAKE_URL, fakeSupabase, type FakeSupabase } from '../supabase/fake-supabase';
import { createTestDb, resetData, rows, type TestDb } from '../supabase/pg';

const DAY = '2026-11-06';
const TTS_KEY = 'AIzaTEMOIN-repetition';
/** Thread ouvert, présent dans la base et dans le contexte : le sujet FR 1 s'y rattache (R12). */
const THREAD = { id: '6f1c2a4e-0d5b-4c1e-9a77-3b2f1e0c9d01', slug: 'mobilisation-sociale-de-l-automne', title: 'Mobilisation sociale de l’automne', lang: 'fr' as const, updatedAt: '2026-11-01T06:00:00.000Z' };
/** Article cité par la newsletter : publicsenat.fr est « meta », seul inNewsletter le rend lisible (R1). */
const NL_ARTICLE = 'https://www.publicsenat.fr/actualites/budget';
let db: TestDb;
let fake: FakeSupabase;
let server: Awaited<ReturnType<typeof startAppsScript>>;

beforeAll(async () => {
  db = await createTestDb();
}, 60_000);
afterAll(async () => {
  await db.close();
});
beforeEach(async () => {
  await resetData(db);
  fake = fakeSupabase(db);
  server = await startAppsScript();
});
afterEach(async () => {
  await server.close();
});

/**
 * Répétition hors ligne de la routine (ROUTINE.md), sur la fixture du 06/11/2026 : contexte (store
 * en mémoire), collecte remplacée par raw.json des textes de fixtures/sources, newsletters, rédaction
 * remplacée par les éditions de la fixture, boucle brief:verify (3 essais au plus), puis brief:finish
 * avec un faux Text-to-Speech, un rendu sans Chromium, Supabase sur PGlite et un faux Apps Script.
 */
type Rehearsal = {
  /** Contenu de `{lang}.json` à l'essai n (1 à 3) : la rédaction corrige entre deux essais ; null : fichier absent. */
  draft?: (lang: Lang, attempt: number) => string | null;
};

/** Édition FR de la fixture, dont le premier sujet cite aussi l'article de la newsletter. */
function frWithNewsletter(): string {
  const ed = fixtureEdition('fr');
  ed.sections[0].stories[0].sources.push({ outlet: 'Public Sénat', title: 'Le Sénat examine le budget', url: NL_ARTICLE, lang: 'fr', readFull: true });
  return JSON.stringify(ed, null, 2);
}
const goodDraft = (lang: Lang) => (lang === 'fr' ? frWithNewsletter() : JSON.stringify(fixtureEdition(lang), null, 2));

async function rehearse(tts: ReturnType<typeof fakeTts>, opts: Rehearsal = {}) {
  const outDir = mkdtempSync(join(tmpdir(), 'repetition-'));
  const dayDir = join(outDir, DAY);
  mkdirSync(join(dayDir, 'newsletters', 'gmail'), { recursive: true });
  await db.query('insert into public.threads (id, slug, title, lang) values ($1, $2, $3, $4)', [THREAD.id, THREAD.slug, THREAD.title, THREAD.lang]);

  // 1. Contexte : un Thread ouvert.
  const store = new MemoryContextStore({ threads: [{ ...THREAD, status: 'open', events: ['2026-11-01'] }] });
  const ctx = await runContext({ outDir, date: DAY, store, now: new Date(`${DAY}T04:13:00.000Z`) });
  expect(ctx.exitCode).toBe(0);
  // 2. Collecte : les textes lus de la fixture.
  const articles = fixtureArticles().map((a, i) => ({ id: `a${i}`, url: a.url, outlet: new URL(a.url).hostname, title: `Article ${i}`, description: null, lang: a.url.includes('pbs.org') ? 'en' : 'fr', publishedAt: null, origin: 'rss', text: a.text }));
  writeFileSync(join(dayDir, 'raw.json'), JSON.stringify({ date: DAY, collectedAt: `${DAY}T04:15:00.000Z`, articles, errors: [] }));
  // 3. Newsletters : un message enregistré depuis Gmail, converti mécaniquement.
  writeFileSync(join(dayDir, 'newsletters', 'gmail', 'm1.json'), JSON.stringify({ id: 'm1', from: 'Public Sénat <newsletter@publicsenat.fr>', subject: 'La Quotidienne', date: `${DAY}T05:00:00+01:00`, authenticationResults: 'mx.google.com; dkim=pass header.i=@publicsenat.fr; dmarc=pass (p=NONE) header.from=publicsenat.fr', html: `<p>Le Sénat examine le budget.</p><p><a href="${NL_ARTICLE}">Lire</a></p>` }));
  expect(runNewsletters({ outDir, date: DAY, now: new Date(`${DAY}T04:20:00.000Z`) }).report.written).toHaveLength(1);
  // 4 et 5. Rédaction, puis boucle brief:verify : au plus 3 essais ; codes 1 et 2 : corriger {lang}.json et relancer.
  const draft = opts.draft ?? goodDraft;
  const codes: number[] = [];
  for (let attempt = 1; attempt <= 3; attempt++) {
    for (const lang of LANGS) {
      const text = draft(lang, attempt);
      if (text === null) rmSync(join(dayDir, `${lang}.json`), { force: true });
      else writeFileSync(join(dayDir, `${lang}.json`), text);
    }
    const v = runVerify({ outDir, date: DAY, whitelistPath: WHITELIST_PATH, programmePath: PROGRAMME_PATH });
    codes.push(v.exitCode);
    if (v.exitCode === 0) break;
  }
  // 6. brief:finish : audio → rendu → publication.
  const printed: string[] = [];
  const finish = await runFinish({
    outDir,
    date: DAY,
    steps: {
      audio: () => runAudio({ outDir, date: DAY, apiKey: TTS_KEY, fetch: tts.fetch, ffmpeg: null }),
      render: () => runRender({ outDir, date: DAY, fetch: fakeFetch({}).fetch, print: async (html, path) => (printed.push(html), writeFileSync(path, '%PDF-1.7\n%%EOF\n')) }),
      publish: () =>
        runPublish({ outDir, date: DAY, env: { SUPABASE_URL: FAKE_URL, SUPABASE_SERVICE_ROLE_KEY: FAKE_KEY, APPS_SCRIPT_URL: server.url, APPS_SCRIPT_TOKEN: DRIVE_TOKEN }, supabaseFetch: fake.fetch, driveFetch: fetch as unknown as HttpFetch, driveHosts: [server.host], driveTimeoutMs: 5_000 }),
    },
  });
  return { outDir, dayDir, codes, finish, html: printed[0] ?? '' };
}

describe('répétition de la routine sur la fixture', () => {
  it('passage complet : trois éditions publiées avec leur MP3, Drive déposé, runs complet, message final', async () => {
    const { codes, finish, html, dayDir } = await rehearse(fakeTts());
    expect(codes).toEqual([1, 1, 1]);
    expect(finish.report.steps.map((s) => [s.step, s.exitCode])).toEqual([['audio', 0], ['render', 0], ['publish', 0]]);
    expect(finish.exitCode).toBe(0);
    expect(finish.report.notification.message).toBe('Brief du jour prêt : 10 sujets, 24 médias');
    expect(html.match(/0:03 · voix Chirp HD/g)).toHaveLength(3);
    expect(await rows(db, 'select lang, audio_path from public.editions order by lang')).toEqual([
      { lang: 'en', audio_path: '2026-11-06/en.mp3' },
      { lang: 'es', audio_path: '2026-11-06/es.mp3' },
      { lang: 'fr', audio_path: '2026-11-06/fr.mp3' },
    ]);
    const [run] = await rows<{ steps: Record<string, { status: string; counters: Record<string, number> }> }>(db, 'select steps from public.runs');
    expect(Object.keys(run.steps).sort()).toEqual(['audio', 'closedThreads', 'collect', 'context', 'drive', 'publish', 'render', 'verify']);
    expect(run.steps.audio).toMatchObject({ status: 'ok', counters: { mp3: 3 } });
    expect(server.google.tree()).toHaveLength(4);
    expect(readFileSync(join(dayDir, 'routine-report.json'), 'utf8')).not.toContain(TTS_KEY);
    // R1 par la newsletter : publicsenat.fr n'est pas « full », la source reste lue parce que la newsletter du jour la cite.
    expect(canReadFull(loadWhitelist(WHITELIST_PATH), NL_ARTICLE)).toBe(false);
    const fr = JSON.parse(readFileSync(join(dayDir, 'fr.verified.json'), 'utf8'));
    expect(fr.sections[0].stories[0].sources.find((x: { url: string }) => x.url === NL_ARTICLE)).toMatchObject({ readFull: true });
    expect(readFileSync(join(dayDir, 'verify-report.json'), 'utf8')).not.toContain('Public Sénat');
    // R12 : le sujet FR 1 est rattaché au Thread ouvert du contexte, sans en créer un autre.
    expect(fr.sections[0].stories[0].thread.id).toBe(THREAD.id);
    expect(await rows(db, 'select count(*)::int as n from public.thread_events where thread_id = $1', [THREAD.id])).toEqual([{ n: 1 }]);
    expect(await rows(db, `select count(*)::int as n from public.threads where title = 'Mobilisation sociale de l’automne'`)).toEqual([{ n: 1 }]);
  });

  it('brief:verify en code 2 au premier essai (ES illisible), corrigé au deuxième', async () => {
    const { codes, finish } = await rehearse(fakeTts(), { draft: (lang, attempt) => (lang === 'es' && attempt === 1 ? '{ "lang": "es", tronqué' : goodDraft(lang)) });
    expect(codes).toEqual([2, 1, 1]);
    expect(finish.exitCode).toBe(0);
    expect(finish.report.notification.message).toBe('Brief du jour prêt : 10 sujets, 24 médias');
  });

  it('code 2 jusqu’au bout : l’édition ES n’est pas publiée, « Brief incomplet », code 2', async () => {
    const { codes, finish } = await rehearse(fakeTts(), { draft: (lang) => (lang === 'es' ? null : goodDraft(lang)) });
    expect(codes).toEqual([2, 2, 2]);
    expect(finish.report.steps.map((x) => x.exitCode)).toEqual([0, 0, 0]);
    expect(finish.exitCode).toBe(2);
    expect(finish.report.notification.message).toMatch(/^Brief incomplet : édition ES manquante — 8 sujets, \d+ médias$/);
    expect(await rows(db, 'select lang from public.editions order by lang')).toEqual([{ lang: 'en' }, { lang: 'fr' }]);
    // La ligne runs dit ce qui est publié ; l'étape verify y porte l'échec de l'édition ES.
    const [run] = await rows<{ notes: string; steps: Record<string, { status: string; counters: Record<string, number> }> }>(db, 'select notes, steps from public.runs');
    expect(run.notes).toMatch(/^2 édition\(s\) publiée\(s\) : FR, EN ;/);
    expect(run.steps.verify).toMatchObject({ status: 'failed', counters: { editions: 2 } });
  });

  it('Text-to-Speech refusé : le brief part sans lecteur, la routine va jusqu’au bout et le dit', async () => {
    const { finish } = await rehearse(fakeTts(() => ({ status: 403, json: {} })));
    expect(finish.report.steps.map((s) => s.exitCode)).toEqual([1, 0, 0]);
    expect(finish.exitCode).toBe(0);
    expect(finish.report.notification.message).toBe('Brief du jour prêt : 10 sujets, 24 médias (audio en échec, éditions sans lecteur)');
    expect(await rows(db, 'select audio_path from public.editions')).toEqual([{ audio_path: null }, { audio_path: null }, { audio_path: null }]);
  });
});
