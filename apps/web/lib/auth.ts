import 'server-only';
import { fixtureMode, isAllowedEmail } from '@/lib/env';
import { createSupabase } from '@/lib/supabase/server';

export type CurrentUser = { email: string };

/**
 * Utilisateur de la requête, s'il est l'utilisateur autorisé ; null sinon. Le proxy fait déjà ce
 * contrôle, mais chaque action serveur et chaque route de fichier le refait (défense en profondeur).
 * `getClaims()` vérifie la signature du jeton ; la RLS reste l'autorité sur les données.
 */
export async function currentUser(): Promise<CurrentUser | null> {
  if (fixtureMode()) return { email: 'fixture@localhost' };
  const supabase = await createSupabase();
  const { data, error } = await supabase.auth.getClaims();
  const email = data?.claims?.email;
  if (error || typeof email !== 'string' || !isAllowedEmail(email)) return null;
  return { email };
}
