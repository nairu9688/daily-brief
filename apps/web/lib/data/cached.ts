import 'server-only';
import { createClient } from '@supabase/supabase-js';
import { unstable_cache } from 'next/cache';
import type { Lang } from '@daily-brief/schema';
import { parisToday } from '@/lib/dates';
import { supabaseConfig } from '@/lib/env';
import { EDITIONS_TAG } from './cache-tags';
import { SupabaseDataSource } from './supabase';
import type { EditionView } from './types';

/**
 * Lecture des éditions mise en cache (cache de données de Next, partagé entre les visiteurs) : le contenu
 * est public depuis 0005, il est donc lu avec un client SANS session (rôle anon, sous RLS), identique pour
 * tous. Deux minutes au plus de retard sur une publication ; une écriture (cases du Vocab, Anki) purge
 * le cache aussitôt (updateTag dans app/actions.ts). Aucune URL signée ici : l'audio et le PDF passent
 * par leurs routes, jamais mises en cache, et leurs URL signées vivent SIGNED_URL_SECONDS.
 */
export const EDITIONS_REVALIDATE_S = 120;

function publicSource(): SupabaseDataSource {
  const { url, anonKey } = supabaseConfig();
  const db = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
  return new SupabaseDataSource(db, () => parisToday());
}

const options = { revalidate: EDITIONS_REVALIDATE_S, tags: [EDITIONS_TAG] };
const cachedEdition = unstable_cache((date: string, lang: Lang) => publicSource().edition(date, lang), ['edition-v1'], options);
const cachedLatestDate = unstable_cache((lang: Lang, onOrBefore: string) => publicSource().latestDate(lang, onOrBefore), ['latest-date-v1'], options);

/** Source Supabase de la requête, dont les deux lectures du Brief (édition, dernière date) passent par le cache. */
export class CachedSupabaseDataSource extends SupabaseDataSource {
  override async edition(date: string, lang: Lang): Promise<EditionView | null> {
    return cachedEdition(date, lang);
  }

  override async latestDate(lang: Lang, onOrBefore: string): Promise<string | null> {
    return cachedLatestDate(lang, onOrBefore);
  }
}
