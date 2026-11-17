import type { Divergence, Lang, MapSpec, MorningBriefItem, Prepa, Quote, RubricKey, SourceRef, Stat, Visual } from '@daily-brief/schema';

/**
 * Modèles d'affichage, communs aux deux sources de données (fixture et Supabase). Les pages ne voient
 * que ces types : le mode fixture et le mode Supabase rendent exactement les mêmes écrans.
 */

export type AnkiStatus = 'none' | 'queued' | 'sent';

export type StoryView = {
  /** Clé du sujet dans l'édition (`stories.key`, « 2026-11-06-fr-1 »). */
  id: string;
  kicker: string;
  date: string;
  title: string;
  summary: string;
  visual: Visual;
  stats: Stat[];
  quote: Quote | null;
  divergences: Divergence[];
  /** `id` : identifiant du Thread (uuid), pour le lien vers sa frise. */
  thread: { id: string; title: string; subtitle: string } | null;
  prepa: Prepa | null;
  sources: SourceRef[];
};

export type SectionView = { key: RubricKey; title: string; stories: StoryView[]; briefs: SourceRef[] };

export type VocabWord = {
  id: string;
  term: string;
  pos: string;
  translation: string;
  example: string;
  sourceUrl: string | null;
  selected: boolean;
  ankiStatus: AnkiStatus;
};

export type EditionView = {
  date: string;
  lang: Lang;
  region: string;
  headline: string;
  morningBrief: MorningBriefItem[];
  sections: SectionView[];
  vocab: { title: string; words: VocabWord[] } | null;
  /** `editions.status = 'light'` : édition allégée (spec §12). */
  light: boolean;
  /** `audio_path` présent : lecteur affiché. */
  hasAudio: boolean;
  hasPdf: boolean;
  generatedAt: string;
};

/** Un jour de l'archive : éditions publiées et éditions allégées. */
export type EditionDay = { date: string; langs: Lang[]; light: Lang[] };

export type ThreadSummary = {
  id: string;
  title: string;
  lang: Lang;
  status: 'open' | 'closed';
  followed: boolean;
  eventCount: number;
  lastDate: string | null;
  lastTitle: string | null;
};

export type ThreadEventView = {
  date: string;
  title: string;
  text: string;
  /** Rubrique du sujet lié (kicker de la frise), première source et carte éventuelle. */
  rubric: RubricKey | null;
  source: { outlet: string; url: string } | null;
  map: { spec: MapSpec; caption: string } | null;
};

/** Frise : événements du plus récent au plus ancien. */
export type ThreadDetail = ThreadSummary & { events: ThreadEventView[] };

export type VocabEntry = VocabWord & { date: string; lang: Lang };
export type VocabFilter = { lang?: Lang; date?: string; selected?: boolean };

export type RunStatus = 'running' | 'ok' | 'degraded' | 'failed';

/** Ligne `runs` telle qu'en base (steps validé à la lecture, voir lib/runs.ts). */
export type RunRecord = { date: string; status: RunStatus; steps: unknown; notes: string | null; updatedAt: string };

/** Fichier du jour : redirection vers une URL signée, ou octets servis directement (mode fixture). */
export type FileTarget = { kind: 'redirect'; url: string } | { kind: 'bytes'; body: Uint8Array; contentType: string };

export interface DataSource {
  readonly kind: 'fixture' | 'supabase';
  /** Date du jour à Paris (mode fixture : date de la fixture). */
  today(): string;
  edition(date: string, lang: Lang): Promise<EditionView | null>;
  /** Dernière date publiée pour la langue, au plus tard `onOrBefore`. */
  latestDate(lang: Lang, onOrBefore: string): Promise<string | null>;
  /** Jours publiés entre deux dates incluses, du plus ancien au plus récent. */
  days(from: string, to: string): Promise<EditionDay[]>;
  threads(): Promise<ThreadSummary[]>;
  thread(id: string): Promise<ThreadDetail | null>;
  vocab(filter: VocabFilter): Promise<VocabEntry[]>;
  runs(limit: number): Promise<RunRecord[]>;
  /** Écritures permises par la RLS : renvoient le nombre de lignes modifiées. */
  setSelected(ids: string[], selected: boolean): Promise<number>;
  queueAnki(ids: string[]): Promise<number>;
  setFollowed(id: string, followed: boolean): Promise<number>;
  audio(date: string, lang: Lang): Promise<FileTarget | null>;
  pdf(date: string): Promise<FileTarget | null>;
}
