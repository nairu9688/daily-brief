import { z } from 'zod';
import {
  DivergenceSchema,
  IsoDateSchema,
  LangSchema,
  MorningBriefItemSchema,
  PrepaSchema,
  QuoteSchema,
  RubricKeySchema,
  StatSchema,
  UrlSchema,
  VisualSchema,
  type Lang,
  type SourceRef,
} from '@daily-brief/schema';
import type { EditionView, RunRecord, SectionView, StoryView, ThreadDetail, ThreadEventView, ThreadSummary, VocabEntry, VocabWord } from './types';

/**
 * Lignes telles que PostgREST les renvoie (JSON : dates « AAAA-MM-JJ », horodatages ISO), validées
 * par zod, puis converties en modèles d'affichage. Une ligne invalide n'interrompt jamais une page :
 * elle est écartée et signalée dans `problems`. Les URL doivent être en http(s) : une source
 * `javascript:` n'atteint jamais un attribut href.
 */

const Uuid = z.string().min(1);
const Timestamp = z.string().min(1);

export const EditionRowSchema = z.object({
  id: Uuid,
  date: IsoDateSchema,
  lang: LangSchema,
  region: z.string(),
  headline: z.string(),
  morning_brief: z.array(MorningBriefItemSchema),
  sections: z.array(z.object({ key: RubricKeySchema, title: z.string().min(1) })),
  vocab_title: z.string().nullable(),
  audio_path: z.string().nullable(),
  pdf_path: z.string().nullable(),
  status: z.enum(['published', 'light']),
  generated_at: Timestamp,
});

export const StoryRowSchema = z.object({
  id: Uuid,
  key: z.string().min(1),
  rubric: RubricKeySchema,
  position: z.number().int(),
  kicker: z.string(),
  date_label: z.string(),
  title: z.string().min(1),
  summary: z.string(),
  visual: z.unknown(),
  stats: z.unknown(),
  quote: z.unknown(),
  divergences: z.unknown(),
  prepa: z.unknown(),
  thread_id: Uuid.nullable(),
  thread_subtitle: z.string().nullable(),
  thread: z.object({ id: Uuid, title: z.string().min(1) }).nullable(),
});

export const SourceRowSchema = z.object({
  story_id: Uuid.nullable(),
  rubric: RubricKeySchema,
  position: z.number().int(),
  outlet: z.string().min(1),
  title: z.string().min(1),
  url: z.string(),
  lang: z.string(),
  read_full: z.boolean(),
  published_at: z.string().nullable(),
});

export const VocabRowSchema = z.object({
  id: Uuid,
  position: z.number().int(),
  term: z.string().min(1),
  pos: z.string(),
  translation: z.string(),
  example: z.string(),
  source_url: z.string().nullable(),
  selected: z.boolean(),
  anki_status: z.enum(['none', 'queued', 'sent']),
});

export type EditionRow = z.infer<typeof EditionRowSchema>;
export type StoryRow = z.infer<typeof StoryRowSchema>;
export type SourceRow = z.infer<typeof SourceRowSchema>;
export type VocabRow = z.infer<typeof VocabRowSchema>;

export type Mapped<T> = { value: T; problems: string[] };

/** Valide une liste de lignes : les invalides sont écartées et décrites. */
export function parseRows<T>(schema: z.ZodType<T>, rows: unknown, what: string): Mapped<T[]> {
  const problems: string[] = [];
  if (!Array.isArray(rows)) return { value: [], problems: [`${what} : réponse inattendue`] };
  const value: T[] = [];
  rows.forEach((r, i) => {
    const p = schema.safeParse(r);
    if (p.success) value.push(p.data);
    else problems.push(`${what} ${i} ignoré : ${p.error.issues[0]?.message ?? 'invalide'}`);
  });
  return { value, problems };
}

/** URL http(s) seulement, sinon null. */
export function safeUrl(url: string | null | undefined): string | null {
  return typeof url === 'string' && UrlSchema.safeParse(url).success ? url : null;
}

/** Photo affichable : seulement une image https de images.pexels.com (CSP img-src), sinon null. */
export function pexelsSrc(src: string | undefined): string | null {
  if (!src) return null;
  try {
    const u = new URL(src);
    return u.protocol === 'https:' && u.hostname === 'images.pexels.com' && !u.username && !u.password ? u.href : null;
  } catch {
    return null;
  }
}

const sourceOf = (r: SourceRow): SourceRef | null => {
  const url = safeUrl(r.url);
  if (!url) return null;
  return { outlet: r.outlet, title: r.title, url, lang: r.lang, readFull: r.read_full, ...(r.published_at ? { publishedAt: r.published_at } : {}) };
};

const byPosition = <T extends { position: number }>(a: T, b: T) => a.position - b.position;

const StoryJson = z.object({
  visual: VisualSchema,
  stats: z.array(StatSchema),
  quote: QuoteSchema.nullable(),
  divergences: z.array(DivergenceSchema),
  prepa: PrepaSchema.nullable(),
});

/** Lignes d'une édition → modèle d'affichage (fonction pure). */
export function editionFromRows(input: { edition: EditionRow; stories: StoryRow[]; sources: SourceRow[]; vocab: VocabRow[] }): Mapped<EditionView> {
  const { edition: e } = input;
  const problems: string[] = [];
  const storySources = new Map<string, SourceRef[]>();
  const briefs = new Map<string, SourceRef[]>();
  for (const r of [...input.sources].sort(byPosition)) {
    const s = sourceOf(r);
    if (!s) {
      problems.push(`source « ${r.title} » ignorée : URL refusée`);
      continue;
    }
    const map = r.story_id ? storySources : briefs;
    const key = r.story_id ?? r.rubric;
    map.set(key, [...(map.get(key) ?? []), s]);
  }

  const storiesByRubric = new Map<string, StoryView[]>();
  for (const r of [...input.stories].sort(byPosition)) {
    const json = StoryJson.safeParse({ visual: r.visual, stats: r.stats ?? [], quote: r.quote ?? null, divergences: r.divergences ?? [], prepa: r.prepa ?? null });
    const sources = storySources.get(r.id) ?? [];
    if (!json.success || sources.length === 0) {
      problems.push(`sujet ${r.key} ignoré : ${json.success ? 'aucune source valide' : json.error.issues[0]?.message}`);
      continue;
    }
    const story: StoryView = {
      id: r.key,
      kicker: r.kicker,
      date: r.date_label,
      title: r.title,
      summary: r.summary,
      ...json.data,
      thread: r.thread ? { id: r.thread.id, title: r.thread.title, subtitle: r.thread_subtitle ?? '' } : null,
      sources,
    };
    storiesByRubric.set(r.rubric, [...(storiesByRubric.get(r.rubric) ?? []), story]);
  }

  const sections: SectionView[] = e.sections.map((s) => ({ key: s.key, title: s.title, stories: storiesByRubric.get(s.key) ?? [], briefs: briefs.get(s.key) ?? [] }));
  const words: VocabWord[] = [...input.vocab].sort(byPosition).map((v) => ({
    id: v.id,
    term: v.term,
    pos: v.pos,
    translation: v.translation,
    example: v.example,
    sourceUrl: safeUrl(v.source_url),
    selected: v.selected,
    ankiStatus: v.anki_status,
  }));
  return {
    value: {
      date: e.date,
      lang: e.lang,
      region: e.region,
      headline: e.headline,
      morningBrief: e.morning_brief,
      sections,
      vocab: e.vocab_title !== null ? { title: e.vocab_title, words } : null,
      light: e.status === 'light',
      hasAudio: e.audio_path !== null,
      hasPdf: e.pdf_path !== null,
      generatedAt: e.generated_at,
    },
    problems,
  };
}

export const ThreadRowSchema = z.object({
  id: Uuid,
  title: z.string().min(1),
  lang: LangSchema,
  status: z.enum(['open', 'closed']),
  followed: z.boolean(),
  thread_events: z.array(
    z.object({
      date: IsoDateSchema,
      title: z.string(),
      text: z.string(),
      story: z
        .object({
          rubric: RubricKeySchema,
          visual: z.unknown(),
          sources: z.array(z.object({ outlet: z.string(), url: z.string(), position: z.number().int() })),
        })
        .nullable(),
    }),
  ),
});
export type ThreadRow = z.infer<typeof ThreadRowSchema>;

/** Thread et ses événements → frise, du plus récent au plus ancien (fonction pure). */
export function threadFromRow(r: ThreadRow): ThreadDetail {
  const events: ThreadEventView[] = r.thread_events
    .map((ev) => {
      const visual = ev.story ? VisualSchema.safeParse(ev.story.visual) : null;
      const first = ev.story ? [...ev.story.sources].sort(byPosition).find((s) => safeUrl(s.url)) : undefined;
      return {
        date: ev.date,
        title: ev.title,
        text: ev.text,
        rubric: ev.story?.rubric ?? null,
        source: first ? { outlet: first.outlet, url: first.url } : null,
        map: visual?.success && visual.data.type === 'map' ? { spec: visual.data.map, caption: visual.data.caption } : null,
      };
    })
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  return { ...threadSummary(r), events };
}

export function threadSummary(r: ThreadRow): ThreadSummary {
  const sorted = [...r.thread_events].sort((a, b) => (a.date < b.date ? 1 : -1));
  return {
    id: r.id,
    title: r.title,
    lang: r.lang,
    status: r.status,
    followed: r.followed,
    eventCount: r.thread_events.length,
    lastDate: sorted[0]?.date ?? null,
    lastTitle: sorted[0]?.title ?? null,
  };
}

export const VocabEntryRowSchema = VocabRowSchema.extend({ lang: LangSchema, edition: z.object({ date: IsoDateSchema }) });

export const vocabEntryFromRow = (r: z.infer<typeof VocabEntryRowSchema>): VocabEntry => ({
  id: r.id,
  term: r.term,
  pos: r.pos,
  translation: r.translation,
  example: r.example,
  sourceUrl: safeUrl(r.source_url),
  selected: r.selected,
  ankiStatus: r.anki_status,
  date: r.edition.date,
  lang: r.lang as Lang,
});

export const RunRowSchema = z.object({
  date: IsoDateSchema,
  status: z.enum(['running', 'ok', 'degraded', 'failed']),
  steps: z.unknown(),
  notes: z.string().nullable(),
  updated_at: Timestamp,
});

export const runFromRow = (r: z.infer<typeof RunRowSchema>): RunRecord => ({ date: r.date, status: r.status, steps: r.steps, notes: r.notes, updatedAt: r.updated_at });
