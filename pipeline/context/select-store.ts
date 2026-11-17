import { createSupabaseClient, type SupabaseFetch } from '../supabase/client';
import { MISSING_SUPABASE, supabaseConfig } from '../supabase/config';
import { EmptyContextStore, type ContextStore } from './store';
import { SupabaseContextStore } from './supabase-store';

/** Store qui échoue toujours : `runContext` écrit alors son rapport et sort avec le code 2. */
export class UnavailableContextStore implements ContextStore {
  readonly name = 'indisponible';

  constructor(private readonly reason: string) {}

  private fail(): never {
    throw new Error(this.reason);
  }

  async openThreads(): Promise<never> {
    return this.fail();
  }

  async yesterdayTopics(): Promise<never> {
    return this.fail();
  }

  async closeStaleThreads(): Promise<never> {
    return this.fail();
  }
}

export type SelectStoreOptions = {
  /** `--allow-empty` : sans configuration Supabase, contexte vide et avertissement (développement local). */
  allowEmpty?: boolean;
  fetch: SupabaseFetch;
};

/**
 * Store de `brief:context` d'après l'environnement. Avec SUPABASE_URL et SUPABASE_SERVICE_ROLE_KEY :
 * store Supabase. Sans elles : store indisponible (code 2), sauf avec `allowEmpty`, qui donne un
 * contexte vide et un avertissement. Une URL invalide est toujours une erreur.
 */
export function selectStore(env: Record<string, string | undefined>, opts: SelectStoreOptions): { store: ContextStore; warnings: string[] } {
  const r = supabaseConfig(env);
  if (r.ok) return { store: new SupabaseContextStore(createSupabaseClient(r.config, opts.fetch)), warnings: [] };
  if (r.error === MISSING_SUPABASE && opts.allowEmpty) {
    return { store: new EmptyContextStore(), warnings: [`${MISSING_SUPABASE} : contexte vide (aucun Thread ouvert, aucun sujet de la veille)`] };
  }
  const hint = r.error === MISSING_SUPABASE ? ' (--allow-empty pour un contexte vide en développement local)' : '';
  return { store: new UnavailableContextStore(`${r.error}${hint}`), warnings: [] };
}
