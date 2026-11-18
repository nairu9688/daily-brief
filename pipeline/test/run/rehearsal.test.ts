import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { LANGS } from '@daily-brief/schema';
import { runAudio } from '../../audio/run-audio';
import type { HttpFetch } from '../../collect/http';
import { MemoryContextStore } from '../../context/memory-store';
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
async function rehearse(tts: ReturnType<typeof fakeTts>) {
  const outDir = mkdtempSync(join(tmpdir(), 'repetition-'));
  const dayDir = join(outDir, DAY);
  mkdirSync(join(dayDir, 'newsletters', 'gmail'), { recursive: true });

  // 1. Contexte.
  const ctx = await runContext({ outDir, date: DAY, store: new MemoryContextStore(), now: new Date(`${DAY}T04:13:00.000Z`) });
  expect(ctx.exitCode).toBe(0);
  // 2. Collecte : les textes lus de la fixture.
  const articles = fixtureArticles().map((a, i) => ({ id: `a${i}`, url: a.url, outlet: new URL(a.url).hostname, title: `Article ${i}`, description: null, lang: a.url.includes('pbs.org') ? 'en' : 'fr', publishedAt: null, origin: 'rss', text: a.text }));
  writeFileSync(join(dayDir, 'raw.json'), JSON.stringify({ date: DAY, collectedAt: `${DAY}T04:15:00.000Z`, articles, errors: [] }));
  // 3. Newsletters : un message enregistré depuis Gmail, converti mécaniquement.
  writeFileSync(join(dayDir, 'newsletters', 'gmail', 'm1.json'), JSON.stringify({ id: 'm1', from: 'Public Sénat <newsletter@publicsenat.fr>', subject: 'La Quotidienne', date: `${DAY}T06:30:00+01:00`, html: '<p>Le Sénat examine le budget.</p><p><a href="https://www.publicsenat.fr/actualites/budget">Lire</a></p>' }));
  expect(runNewsletters({ outDir, date: DAY, now: new Date(`${DAY}T04:20:00.000Z`) }).report.written).toHaveLength(1);
  // 4. Rédaction : les éditions de la fixture.
  for (const lang of LANGS) writeFileSync(join(dayDir, `${lang}.json`), JSON.stringify(fixtureEdition(lang), null, 2));
  // 5. Boucle brief:verify : au plus 3 essais, puis on garde les .verified.json.
  const codes: number[] = [];
  for (let attempt = 1; attempt <= 3; attempt++) {
    const v = runVerify({ outDir, date: DAY, whitelistPath: WHITELIST_PATH, programmePath: PROGRAMME_PATH });
    codes.push(v.exitCode);
    if (v.exitCode !== 1) break;
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
    expect(finish.report.notification.message).toBe('Brief du jour prêt : 10 sujets, 23 médias');
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
  });

  it('Text-to-Speech refusé : le brief part sans lecteur, la routine va jusqu’au bout et le dit', async () => {
    const { finish } = await rehearse(fakeTts(() => ({ status: 403, json: {} })));
    expect(finish.report.steps.map((s) => s.exitCode)).toEqual([1, 0, 0]);
    expect(finish.exitCode).toBe(0);
    expect(finish.report.notification.message).toBe('Brief du jour prêt : 10 sujets, 23 médias (audio en échec, éditions sans lecteur)');
    expect(await rows(db, 'select audio_path from public.editions')).toEqual([{ audio_path: null }, { audio_path: null }, { audio_path: null }]);
  });
});
