/** Variables Supabase de l'environnement, rognées : une valeur blanche compte pour absente. */
export function readSupabaseEnv(env: Record<string, string | undefined>): { url?: string; serviceKey?: string } {
  const url = env.SUPABASE_URL?.trim();
  const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  return { url: url || undefined, serviceKey: serviceKey || undefined };
}
