import 'server-only';
import { cache } from 'react';
import { fixtureMode, fixtureVisitor, isAllowedEmail } from '@/lib/env';
import { createSupabase } from '@/lib/supabase/server';

export type CurrentUser = { email: string };

/**
 * Utilisateur de la requête, s'il est l'utilisateur autorisé ; null sinon (visiteur sans session ou
 * autre adresse : lecture publique seulement). Les pages s'en servent pour montrer ou cacher les
 * actions personnelles, chaque action serveur le revérifie avant tout, et la page Santé aussi (en plus
 * du proxy). `getClaims()` vérifie la signature du jeton ; la RLS reste l'autorité sur les données.
 * Mode fixture : connecté, sauf FIXTURE_VISITOR=1 (visiteur). Mémorisé pour la requête (mise en page et page).
 */
export const currentUser = cache(async (): Promise<CurrentUser | null> => {
  if (fixtureMode()) return fixtureVisitor() ? null : { email: 'fixture@localhost' };
  const supabase = await createSupabase();
  const { data, error } = await supabase.auth.getClaims();
  const email = data?.claims?.email;
  if (error || typeof email !== 'string' || !isAllowedEmail(email)) return null;
  return { email };
});
