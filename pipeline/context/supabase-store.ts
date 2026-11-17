import { z } from 'zod';
import { IsoDateSchema, type OpenThread } from '@daily-brief/schema';
import type { SupabaseClient } from '../supabase/client';
import { FUTURE_EVENT_DAYS } from './memory-store';
import { STALE_DAYS } from './stale';
import type { ContextStore, StoreAnomaly, Topic } from './store';

/** Lignes brutes : `runContext` revalide chaque élément, on ne vérifie ici que la forme d'ensemble. */
const Rows = z.array(z.unknown());
const Ids = z.array(z.string().min(1));
const Anomalies = z.array(z.object({ threadId: z.string().min(1), date: IsoDateSchema }));

/**
 * Store Supabase de `brief:context`, avec la clé service. Chaque méthode appelle une fonction SQL
 * de `supabase/migrations/0002_context_runs.sql` et transmet l'`AbortSignal` reçu à la requête HTTP
 * (l'équivalent de `.abortSignal(signal)` de supabase-js). La fermeture R12 est une seule
 * instruction `UPDATE … RETURNING`, qui note aussi les Threads fermés dans `runs`.
 */
export class SupabaseContextStore implements ContextStore {
  readonly name = 'supabase';

  constructor(private readonly client: SupabaseClient) {}

  async openThreads(signal?: AbortSignal): Promise<OpenThread[]> {
    return (await this.client.rpc('context_open_threads', {}, Rows, { signal })) as OpenThread[];
  }

  async yesterdayTopics(date: string, signal?: AbortSignal): Promise<Topic[]> {
    return (await this.client.rpc('context_yesterday_topics', { p_date: date }, Rows, { signal })) as Topic[];
  }

  async closeStaleThreads(date: string, days: number = STALE_DAYS, signal?: AbortSignal): Promise<string[]> {
    return this.client.rpc('close_stale_threads', { p_date: date, p_days: days }, Ids, { signal });
  }

  async anomalies(date: string, signal?: AbortSignal): Promise<StoreAnomaly[]> {
    const found = await this.client.rpc('context_anomalies', { p_date: date, p_days: FUTURE_EVENT_DAYS }, Anomalies, { signal });
    return found.map((a) => ({ threadId: a.threadId, kind: 'future-event' as const, detail: `événement daté du ${a.date}, à plus de ${FUTURE_EVENT_DAYS} jours dans le futur` }));
  }
}
