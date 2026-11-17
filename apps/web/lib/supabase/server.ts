import 'server-only';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { supabaseConfig } from '@/lib/env';

/**
 * Client Supabase d'une requête : clé publique et session de l'utilisateur lue dans ses cookies.
 * Toutes les lectures et écritures passent donc par la RLS (private.is_allowed_user()).
 */
export async function createSupabase() {
  const { url, anonKey } = supabaseConfig();
  const store = await cookies();
  return createServerClient(url, anonKey, {
    cookies: {
      getAll: () => store.getAll(),
      setAll: (list) => {
        try {
          for (const { name, value, options } of list) store.set(name, value, options);
        } catch {
          // Composant serveur : les cookies ne s'y écrivent pas, le proxy rafraîchit la session.
        }
      },
    },
  });
}
