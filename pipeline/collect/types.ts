import type { RawArticle } from '@daily-brief/schema';
import type { Whitelist } from '../lib/whitelist';
import type { CollectConfig } from './config';
import type { HttpFetch } from './http';
import type { Rubriques } from './rubriques';

export type SourceName = 'thenewsapi' | 'exa' | 'webz' | 'rss';

/** Article candidat ; `seed` relie les résultats de `/similar` à l'article qui les a fait trouver. */
export type Candidate = { article: RawArticle; seed?: string };

/** Bilan d'une source : articles, requêtes envoyées, erreurs (déjà sans secret) et textes écartés par R1. */
export type SourceRun = {
  candidates: Candidate[];
  requests: number;
  errors: string[];
  discardedTexts: number;
  /** Articles écartés faute de date. */
  undated: number;
  /** Raison de la coupure du disjoncteur, le cas échéant. */
  stoppedBy: string | null;
};

export type SourceContext = {
  fetch: HttpFetch;
  whitelist: Whitelist;
  config: CollectConfig;
  rubriques: Rubriques;
  now: Date;
  /** Début de la fenêtre de collecte (`now - windowHours`). */
  windowStart: Date;
};

export const emptyRun = (): SourceRun => ({ candidates: [], requests: 0, errors: [], discardedTexts: 0, undated: 0, stoppedBy: null });
