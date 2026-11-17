import 'server-only';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { z } from 'zod';
import { LANGS, parseBrief, type Brief, type Lang } from '@daily-brief/schema';
import { isIsoDate } from '@/lib/dates';
import { editionFromFixture, fixtureThreadId, fixtureVocabId } from './fixture-edition';
import type { AnkiStatus, DataSource, EditionDay, EditionView, FileTarget, RunRecord, ThreadDetail, ThreadEventView, ThreadSummary, VocabEntry, VocabFilter } from './types';

/**
 * Source de données du mode FIXTURE=1 : fixtures/brief-2026-11-06.json (trois éditions) et
 * fixtures/threads-2026-11-06.json (épisodes passés des Threads), lus sans réseau. Les écritures
 * (mots cochés, Anki, Threads suivis) restent en mémoire, le temps du processus.
 */

export type FixtureOptions = { today: string; light?: Lang[] };

const ThreadsFixture = z.record(
  z.string(),
  z.object({ title: z.string(), nodes: z.array(z.object({ st: z.string(), d: z.string(), h: z.string(), p: z.string(), src: z.string().optional() })) }),
);

/** Remonte depuis le dossier courant jusqu'au dossier fixtures/ du dépôt (vitest : racine ; next : apps/web). */
export function fixturesDir(start = process.cwd()): string {
  let dir = start;
  for (;;) {
    if (existsSync(join(dir, 'fixtures', 'brief-2026-11-06.json'))) return join(dir, 'fixtures');
    const up = dirname(dir);
    if (up === dir) throw new Error('dossier fixtures/ introuvable');
    dir = up;
  }
}

const MONTHS: Record<string, number> = {
  janv: 1, ene: 1, jan: 1, févr: 2, feb: 2, mars: 3, mar: 3, avr: 4, abr: 4, apr: 4, mai: 5, may: 5, juin: 6, jun: 6,
  juil: 7, jul: 7, août: 8, ago: 8, aug: 8, sept: 9, sep: 9, oct: 10, nov: 11, déc: 12, dic: 12, dec: 12,
};

/** « Mar 20 oct », « Wed 04 Nov », « Dom 18 ene » → date civile de l'année de la fixture, ou null. */
export function nodeDate(label: string, year: string): string | null {
  const m = /(\d{1,2})\s+([A-Za-zÀ-ÿ]+)/.exec(label);
  const month = m ? MONTHS[m[2].toLowerCase().replace('.', '')] : undefined;
  if (!m || !month) return null;
  return `${year}-${String(month).padStart(2, '0')}-${m[1].padStart(2, '0')}`;
}

/** Silence MP3 (MPEG-2, 24 kHz, 32 kb/s, mono), `seconds` secondes : le lecteur du mode fixture. */
export function silentMp3(seconds: number): Uint8Array {
  const frame = new Uint8Array(96);
  frame.set([0xff, 0xf3, 0x44, 0xc4]);
  const count = Math.round((seconds * 24000) / 576);
  const out = new Uint8Array(frame.length * count);
  for (let i = 0; i < count; i++) out.set(frame, i * frame.length);
  return out;
}

type MutableState = { vocab: Map<string, { selected: boolean; ankiStatus: AnkiStatus }>; followed: Map<string, boolean> };
// Survit aux rechargements à chaud de `next dev` ; propre à chaque processus.
const g = globalThis as typeof globalThis & { __dailyBriefFixtureState?: MutableState };
const state: MutableState = (g.__dailyBriefFixtureState ??= { vocab: new Map(), followed: new Map() });

/** Vide l'état en mémoire (tests). */
export function resetFixtureState(): void {
  state.vocab.clear();
  state.followed.clear();
}

const step = (status: string, finishedAt: string | null, counters: Record<string, number>, errors: string[] = []) => ({ status, finishedAt, durationMs: null, counters, errors });

export class FixtureDataSource implements DataSource {
  readonly kind = 'fixture' as const;
  private readonly brief: Brief;
  private readonly threadsFile: z.infer<typeof ThreadsFixture>;

  constructor(private readonly opts: FixtureOptions, dir = fixturesDir()) {
    const parsed = parseBrief(JSON.parse(readFileSync(join(dir, 'brief-2026-11-06.json'), 'utf8')));
    if (!parsed.success) throw new Error(`fixture invalide : ${parsed.errors.join(' ; ')}`);
    this.brief = parsed.data;
    this.threadsFile = ThreadsFixture.parse(JSON.parse(readFileSync(join(dir, 'threads-2026-11-06.json'), 'utf8')));
  }

  today(): string {
    return this.opts.today;
  }

  private generatedAt = () => `${this.brief.date}T04:41:00.000Z`;

  async edition(date: string, lang: Lang): Promise<EditionView | null> {
    const ed = this.brief.editions.find((e) => e.lang === lang);
    if (!ed || date !== this.brief.date) return null;
    return editionFromFixture(ed, { light: this.opts.light?.includes(lang) ?? false, hasAudio: lang !== 'es', hasPdf: false, generatedAt: this.generatedAt() }, state.vocab);
  }

  async latestDate(_lang: Lang, onOrBefore: string): Promise<string | null> {
    return isIsoDate(onOrBefore) && this.brief.date <= onOrBefore ? this.brief.date : null;
  }

  async days(from: string, to: string): Promise<EditionDay[]> {
    const d = this.brief.date;
    return d >= from && d <= to ? [{ date: d, langs: [...LANGS], light: this.opts.light ?? [] }] : [];
  }

  private allThreads(): ThreadDetail[] {
    const year = this.brief.date.slice(0, 4);
    const out = new Map<string, ThreadDetail>();
    for (const ed of this.brief.editions) {
      for (const section of ed.sections) {
        for (const st of section.stories) {
          if (!st.thread) continue;
          const id = fixtureThreadId(ed.lang, st.thread.title);
          const first = st.sources[0];
          const event: ThreadEventView = {
            date: ed.date,
            title: st.title,
            text: st.thread.subtitle,
            rubric: section.key,
            source: first ? { outlet: first.outlet, url: first.url } : null,
            map: st.visual.type === 'map' ? { spec: st.visual.map, caption: st.visual.caption } : null,
          };
          const past: ThreadEventView[] = [];
          const file = this.threadsFile[ed.lang];
          if (file && file.title === st.thread.title) {
            for (const n of file.nodes.filter((x) => x.st === '')) {
              const date = nodeDate(n.d, year);
              if (date && date < ed.date) past.push({ date, title: n.h, text: n.p, rubric: null, source: null, map: null });
            }
          }
          const events = [event, ...past].sort((a, b) => (a.date < b.date ? 1 : -1));
          out.set(id, { id, title: st.thread.title, lang: ed.lang, status: 'open', followed: state.followed.get(id) ?? false, eventCount: events.length, lastDate: events[0].date, lastTitle: events[0].title, events });
        }
      }
    }
    return [...out.values()];
  }

  async threads(): Promise<ThreadSummary[]> {
    return this.allThreads().map(({ events: _events, ...summary }) => summary);
  }

  async thread(id: string): Promise<ThreadDetail | null> {
    return this.allThreads().find((t) => t.id === id) ?? null;
  }

  async vocab(filter: VocabFilter): Promise<VocabEntry[]> {
    const out: VocabEntry[] = [];
    for (const ed of this.brief.editions) {
      const view = await this.edition(ed.date, ed.lang);
      for (const w of view?.vocab?.words ?? []) out.push({ ...w, date: ed.date, lang: ed.lang });
    }
    return out.filter((w) => (!filter.lang || w.lang === filter.lang) && (!filter.date || w.date === filter.date) && (filter.selected === undefined || w.selected === filter.selected));
  }

  async runs(limit: number): Promise<RunRecord[]> {
    const d = this.brief.date;
    const ok = (at: string) => step('ok', at, {});
    const rows: RunRecord[] = [
      {
        date: d,
        status: 'ok',
        updatedAt: `${d}T04:52:00.000Z`,
        notes: '3 édition(s) publiée(s) : FR, EN, ES ; Drive : sent',
        steps: {
          context: step('ok', `${d}T04:14:00.000Z`, { openThreads: 4, yesterdayTopics: 12, closedThreads: 0, warnings: 0 }),
          collect: { ...step('ok', `${d}T04:22:00.000Z`, { articles: 184, groups: 61, warnings: 2 }), perLang: { fr: { articles: 80, fullTexts: 22, light: false }, en: { articles: 60, fullTexts: 18, light: false }, es: { articles: 44, fullTexts: 16, light: false } } },
          verify: step('ok', `${d}T04:35:00.000Z`, { editions: 3, fixed: 0, warnings: 1, errors: 0 }),
          render: step('ok', `${d}T04:41:00.000Z`, { finals: 3, pdfEditions: 3, pdf: 1, warnings: 0 }),
          publish: { ...step('ok', `${d}T04:52:00.000Z`, { editions: 3, stories: 10, sources: 41, vocab: 12, threadsCreated: 1, files: 4, audioPurged: 0 }), durationMs: 41000 },
          drive: step('sent', null, { sent: 4, pending: 0 }),
          closedThreads: [],
        },
      },
      {
        date: '2026-11-05',
        status: 'degraded',
        updatedAt: '2026-11-05T04:55:00.000Z',
        notes: '3 édition(s) publiée(s) : FR, EN, ES ; Drive : pending',
        steps: {
          context: ok('2026-11-05T04:14:00.000Z'),
          collect: ok('2026-11-05T04:21:00.000Z'),
          verify: ok('2026-11-05T04:33:00.000Z'),
          render: ok('2026-11-05T04:40:00.000Z'),
          publish: step('degraded', '2026-11-05T04:55:00.000Z', { editions: 3 }, ['Drive : délai dépassé']),
          drive: step('pending', null, { sent: 0, pending: 4 }, ['délai dépassé']),
          closedThreads: ['t-ancien'],
        },
      },
      { date: '2026-11-04', status: 'running', updatedAt: '2026-11-04T04:13:00.000Z', notes: null, steps: { closedThreads: [] } },
    ];
    return rows.slice(0, limit);
  }

  async setSelected(ids: string[], selected: boolean): Promise<number> {
    const known = await this.knownVocab();
    let n = 0;
    for (const id of ids) {
      if (!known.has(id)) continue;
      state.vocab.set(id, { selected, ankiStatus: state.vocab.get(id)?.ankiStatus ?? 'none' });
      n++;
    }
    return n;
  }

  async queueAnki(ids: string[]): Promise<number> {
    const known = await this.knownVocab();
    let n = 0;
    for (const id of ids) {
      const cur = state.vocab.get(id);
      if (!known.has(id) || (cur && cur.ankiStatus !== 'none')) continue;
      state.vocab.set(id, { selected: true, ankiStatus: 'queued' });
      n++;
    }
    return n;
  }

  async setFollowed(id: string, followed: boolean): Promise<number> {
    if (!this.allThreads().some((t) => t.id === id)) return 0;
    state.followed.set(id, followed);
    return 1;
  }

  private async knownVocab(): Promise<Set<string>> {
    return new Set(this.brief.editions.flatMap((e) => (e.vocab?.items ?? []).map((v) => fixtureVocabId(e.date, e.lang, v.term))));
  }

  async audio(date: string, lang: Lang): Promise<FileTarget | null> {
    const ed = await this.edition(date, lang);
    return ed?.hasAudio ? { kind: 'bytes', body: silentMp3(3), contentType: 'audio/mpeg' } : null;
  }

  async pdf(): Promise<FileTarget | null> {
    return null;
  }
}
