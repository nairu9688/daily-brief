import { EmptyContextStore, type ContextStore } from './store';

/**
 * Store de `brief:context` d'après l'environnement. Sans SUPABASE_URL ni SUPABASE_SERVICE_ROLE_KEY :
 * store vide et avertissement. Le store Supabase remplace la seconde branche au lot 4.
 */
export function selectStore(env: Record<string, string | undefined>): { store: ContextStore; warning: string } {
  const configured = !!env.SUPABASE_URL?.trim() && !!env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  return {
    store: new EmptyContextStore(),
    warning: configured
      ? 'store Supabase pas encore disponible (lot 4) : contexte vide'
      : 'SUPABASE_URL ou SUPABASE_SERVICE_ROLE_KEY absente : contexte vide (aucun Thread ouvert, aucun sujet de la veille)',
  };
}
