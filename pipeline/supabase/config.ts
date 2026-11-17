import { readSupabaseEnv } from '../context/supabase-env';

export type SupabaseConfig = { url: string; serviceKey: string };

export const MISSING_SUPABASE = 'SUPABASE_URL ou SUPABASE_SERVICE_ROLE_KEY absente';

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

/**
 * Configuration Supabase tirée de l'environnement. L'URL doit être l'origine du projet, en https
 * (http n'est accepté que pour une pile locale) : la clé service n'est jamais envoyée en clair
 * sur le réseau, ni à une URL qui porterait des identifiants, un chemin ou une requête.
 */
export function supabaseConfig(env: Record<string, string | undefined>): { ok: true; config: SupabaseConfig } | { ok: false; error: string } {
  const { url, serviceKey } = readSupabaseEnv(env);
  if (!url || !serviceKey) return { ok: false, error: MISSING_SUPABASE };
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { ok: false, error: 'SUPABASE_URL invalide : URL attendue (https://<projet>.supabase.co)' };
  }
  const local = LOCAL_HOSTS.has(parsed.hostname);
  if (parsed.protocol !== 'https:' && !(parsed.protocol === 'http:' && local)) {
    return { ok: false, error: 'SUPABASE_URL invalide : https obligatoire (http seulement pour localhost)' };
  }
  if (parsed.username || parsed.password || parsed.search || parsed.hash || (parsed.pathname !== '/' && parsed.pathname !== '')) {
    return { ok: false, error: 'SUPABASE_URL invalide : origine seule attendue, sans chemin, requête ni identifiants' };
  }
  return { ok: true, config: { url: parsed.origin, serviceKey } };
}
