import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { LANGS, LangSchema, type Lang } from '@daily-brief/schema';
import { z } from 'zod';
import { isIsoDate } from '@/lib/dates';
import { isLang } from '@/lib/edition-choice';
import { MAX_IDS, VOCAB_LIMIT, WRITE_BATCH } from './limits';
import {
  EditionRowSchema,
  editionFromRows,
  parseRows,
  RunRowSchema,
  runFromRow,
  SourceRowSchema,
  StoryRowSchema,
  threadFromRow,
  ThreadRowSchema,
  threadSummary,
  VocabEntryRowSchema,
  vocabEntryFromRow,
  VocabRowSchema,
} from './rows';
import type { DataSource, EditionDay, EditionView, FileTarget, RunRecord, ThreadDetail, ThreadSummary, VocabEntry, VocabFilter } from './types';

/**
 * Source de données Supabase : clé publique et session de l'utilisateur s'il y en a une (client de
 * lib/supabase/server.ts), donc toujours sous RLS. Sans session, le contenu se lit (0005) ; `runs` rend
 * une erreur de droits et les écritures aussi. Jamais de clé de service ici. Les écritures ne nomment que les colonnes que
 * la migration 0001 ouvre à l'utilisateur : vocab_items.selected, vocab_items.anki_status, threads.followed.
 */

export const SIGNED_URL_SECONDS = 600;
export { MAX_IDS } from './limits';

export const EDITION_COLUMNS = 'id,date,lang,region,headline,morning_brief,sections,vocab_title,audio_path,pdf_path,status,generated_at';
export const STORY_COLUMNS = 'id,key,rubric,position,kicker,date_label,title,summary,visual,stats,quote,divergences,prepa,thread_id,thread_subtitle,thread:threads(id,title)';
export const SOURCE_COLUMNS = 'story_id,rubric,position,outlet,title,url,lang,read_full,published_at';
export const VOCAB_COLUMNS = 'id,position,term,pos,translation,example,source_url,selected,anki_status';
export const THREAD_COLUMNS = 'id,title,lang,status,followed,thread_events(date,title,text,story:stories(rubric,visual,sources(outlet,url,position)))';

const AUDIO_PATH = /^\d{4}-\d{2}-\d{2}\/(fr|en|es)\.mp3$/;
const PDF_PATH = /^\d{4}-\d{2}-\d{2}\/daily-brief-\d{4}-\d{2}-\d{2}\.pdf$/;

/**
 * Garde-fous à la frontière de la base : un identifiant, une date ou une langue invalide n'est jamais
 * envoyé à PostgREST (Postgres répondrait 22P02, d'où une DataError et une page 500). La source répond
 * alors comme la fixture : null, liste vide ou zéro ligne modifiée.
 */
const isUuid = (v: unknown): v is string => z.uuid().safeParse(v).success;

const DayRowSchema = z.object({ date: z.string().refine(isIsoDate), lang: LangSchema, status: z.string() });

export class DataError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DataError';
  }
}

type Result = { data: unknown; error: { message: string } | null };

function check(what: string, r: Result): unknown {
  if (r.error) throw new DataError(`${what} : ${r.error.message}`);
  return r.data;
}

/** Les lignes écartées sont signalées dans les journaux du serveur, jamais à l'écran. */
function report(problems: string[]): void {
  for (const p of problems) console.warn(`[daily-brief] ${p}`);
}

export class SupabaseDataSource implements DataSource {
  readonly kind = 'supabase' as const;

  constructor(
    private readonly db: SupabaseClient,
    private readonly todayFn: () => string,
  ) {}

  today(): string {
    return this.todayFn();
  }

  async edition(date: string, lang: Lang): Promise<EditionView | null> {
    if (!isIsoDate(date) || !isLang(lang)) return null;
    const row = check('édition', await this.db.from('editions').select(EDITION_COLUMNS).eq('date', date).eq('lang', lang).maybeSingle());
    if (row === null) return null;
    const edition = EditionRowSchema.safeParse(row);
    if (!edition.success) throw new DataError(`édition ${date} ${lang} illisible`);
    const id = edition.data.id;
    const [stories, sources, vocab] = await Promise.all([
      this.db.from('stories').select(STORY_COLUMNS).eq('edition_id', id).order('position'),
      this.db.from('sources').select(SOURCE_COLUMNS).eq('edition_id', id).order('position'),
      this.db.from('vocab_items').select(VOCAB_COLUMNS).eq('edition_id', id).order('position'),
    ]);
    const s = parseRows(StoryRowSchema, check('sujets', stories), 'sujet');
    const src = parseRows(SourceRowSchema, check('sources', sources), 'source');
    const v = parseRows(VocabRowSchema, check('mots', vocab), 'mot');
    const mapped = editionFromRows({ edition: edition.data, stories: s.value, sources: src.value, vocab: v.value });
    report([...s.problems, ...src.problems, ...v.problems, ...mapped.problems]);
    return mapped.value;
  }

  async latestDate(lang: Lang, onOrBefore: string): Promise<string | null> {
    if (!isLang(lang) || !isIsoDate(onOrBefore)) return null;
    const rows = check('dernière édition', await this.db.from('editions').select('date').eq('lang', lang).lte('date', onOrBefore).order('date', { ascending: false }).limit(1));
    const first = Array.isArray(rows) ? (rows[0] as { date?: unknown } | undefined) : undefined;
    return typeof first?.date === 'string' ? first.date : null;
  }

  async days(from: string, to: string): Promise<EditionDay[]> {
    if (!isIsoDate(from) || !isIsoDate(to)) return [];
    const rows = parseRows(DayRowSchema, check('archive', await this.db.from('editions').select('date,lang,status').gte('date', from).lte('date', to).order('date')), 'jour d’archive');
    report(rows.problems);
    const byDate = new Map<string, EditionDay>();
    for (const r of rows.value) {
      const day = byDate.get(r.date) ?? { date: r.date, langs: [], light: [] };
      day.langs.push(r.lang);
      if (r.status === 'light') day.light.push(r.lang);
      byDate.set(r.date, day);
    }
    return [...byDate.values()].map((d) => ({ ...d, langs: LANGS.filter((l) => d.langs.includes(l)), light: LANGS.filter((l) => d.light.includes(l)) }));
  }

  private async threadRows(id?: string) {
    let q = this.db.from('threads').select(THREAD_COLUMNS);
    if (id) q = q.eq('id', id);
    const rows = parseRows(ThreadRowSchema, check('Threads', await q.order('updated_at', { ascending: false }).limit(200)), 'Thread');
    report(rows.problems);
    return rows.value;
  }

  async threads(): Promise<ThreadSummary[]> {
    return (await this.threadRows()).map(threadSummary);
  }

  async thread(id: string): Promise<ThreadDetail | null> {
    if (!isUuid(id)) return null;
    const [row] = await this.threadRows(id);
    return row ? threadFromRow(row) : null;
  }

  async vocab(filter: VocabFilter): Promise<VocabEntry[]> {
    if ((filter.lang !== undefined && !isLang(filter.lang)) || (filter.date !== undefined && !isIsoDate(filter.date))) return [];
    let q = this.db.from('vocab_items').select(`${VOCAB_COLUMNS},lang,edition:editions!inner(date)`);
    if (filter.lang) q = q.eq('lang', filter.lang);
    if (filter.date) q = q.eq('edition.date', filter.date);
    if (filter.selected !== undefined) q = q.eq('selected', filter.selected);
    const rows = parseRows(VocabEntryRowSchema, check('vocabulaire', await q.limit(VOCAB_LIMIT)), 'mot');
    report(rows.problems);
    return rows.value.map(vocabEntryFromRow).sort((a, b) => (a.date === b.date ? 0 : a.date < b.date ? 1 : -1));
  }

  async runs(limit: number): Promise<RunRecord[]> {
    const rows = parseRows(RunRowSchema, check('passages', await this.db.from('runs').select('date,status,steps,notes,updated_at').order('date', { ascending: false }).limit(limit)), 'passage');
    report(rows.problems);
    return rows.value.map(runFromRow);
  }

  private static count(what: string, r: Result): number {
    const data = check(what, r);
    return Array.isArray(data) ? data.length : 0;
  }

  /** Identifiants valides seulement (comme la fixture, qui ignore les inconnus) ; null si la liste est hors bornes. */
  private static validIds(ids: string[]): string[] | null {
    if (ids.length === 0 || ids.length > MAX_IDS) return null;
    const valid = ids.filter(isUuid);
    return valid.length > 0 ? valid : null;
  }

  /**
   * Écrit par lots de WRITE_BATCH identifiants : 500 uuid dans un seul `?id=in.(…)` donneraient une URL
   * d'environ 20 Ko, au-delà des limites des passerelles (Cloudflare, Kong). Les comptes s'additionnent.
   */
  private static async batched(ids: string[], write: (batch: string[]) => Promise<number>): Promise<number> {
    let total = 0;
    for (let i = 0; i < ids.length; i += WRITE_BATCH) total += await write(ids.slice(i, i + WRITE_BATCH));
    return total;
  }

  async setSelected(ids: string[], selected: boolean): Promise<number> {
    const valid = SupabaseDataSource.validIds(ids);
    if (!valid) return 0;
    return SupabaseDataSource.batched(valid, async (batch) => SupabaseDataSource.count('mots', await this.db.from('vocab_items').update({ selected }).in('id', batch).select('id')));
  }

  /** « Ajouter à Anki » : met en file les mots encore à `none` (un mot déjà envoyé n'est pas rétrogradé). */
  async queueAnki(ids: string[]): Promise<number> {
    const valid = SupabaseDataSource.validIds(ids);
    if (!valid) return 0;
    return SupabaseDataSource.batched(valid, async (batch) =>
      SupabaseDataSource.count('Anki', await this.db.from('vocab_items').update({ anki_status: 'queued', selected: true }).in('id', batch).eq('anki_status', 'none').select('id')),
    );
  }

  async setFollowed(id: string, followed: boolean): Promise<number> {
    if (!isUuid(id)) return 0;
    return SupabaseDataSource.count('Thread', await this.db.from('threads').update({ followed }).eq('id', id).select('id'));
  }

  private async signed(bucket: 'audio' | 'pdf', path: string, download?: string): Promise<FileTarget | null> {
    const { data, error } = await this.db.storage.from(bucket).createSignedUrl(path, SIGNED_URL_SECONDS, download ? { download } : undefined);
    if (error || !data?.signedUrl) return null;
    return { kind: 'redirect', url: data.signedUrl };
  }

  async audio(date: string, lang: Lang): Promise<FileTarget | null> {
    if (!isIsoDate(date) || !isLang(lang)) return null;
    const row = check('audio', await this.db.from('editions').select('audio_path').eq('date', date).eq('lang', lang).maybeSingle()) as { audio_path?: unknown } | null;
    const path = row?.audio_path;
    return typeof path === 'string' && AUDIO_PATH.test(path) ? this.signed('audio', path) : null;
  }

  async pdf(date: string): Promise<FileTarget | null> {
    if (!isIsoDate(date)) return null;
    const rows = check('PDF', await this.db.from('editions').select('pdf_path').eq('date', date).not('pdf_path', 'is', null).limit(1));
    const path = Array.isArray(rows) ? (rows[0] as { pdf_path?: unknown } | undefined)?.pdf_path : undefined;
    return typeof path === 'string' && PDF_PATH.test(path) ? this.signed('pdf', path, `Daily Brief ${date}.pdf`) : null;
  }
}
