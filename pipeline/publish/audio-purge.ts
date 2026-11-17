import { z } from 'zod';
import { messageOf } from '../collect/http';
import type { SupabaseClient } from '../supabase/client';
import type { PublishIssue } from './inputs';

/** Les MP3 sont gardés 30 jours (spec §6.2). */
export const AUDIO_RETENTION_DAYS = 30;

/** Seul un chemin écrit par la publication (`AAAA-MM-JJ/<langue>.mp3`) peut être supprimé. */
const AUDIO_PATH = /^\d{4}-\d{2}-\d{2}\/(fr|en|es)\.mp3$/;
const Paths = z.array(z.string());
const Ack = z.object({}).loose();

/**
 * Supprime du bucket `audio` les MP3 des éditions de plus de 30 jours, par l'API Storage (une
 * suppression en SQL laisserait le fichier orphelin), puis vide `editions.audio_path`. Dans cet
 * ordre : un échec après la suppression est rattrapé au passage suivant, la suppression d'un
 * fichier déjà absent étant sans effet. Tout échec n'est qu'un avertissement.
 */
export async function purgeExpiredAudio(client: SupabaseClient, date: string): Promise<{ removed: number; issues: PublishIssue[] }> {
  try {
    const expired = await client.rpc('audio_expired', { p_date: date, p_days: AUDIO_RETENTION_DAYS }, Paths);
    const paths = expired.filter((p) => AUDIO_PATH.test(p));
    const issues: PublishIssue[] = paths.length < expired.length ? [{ level: 'warning', message: `purge audio : ${expired.length - paths.length} chemin(s) inattendu(s) ignoré(s)` }] : [];
    if (paths.length === 0) return { removed: 0, issues };
    await client.remove('audio', paths);
    await client.rpc('audio_clear', { p_paths: paths }, Ack);
    return { removed: paths.length, issues };
  } catch (e) {
    return { removed: 0, issues: [{ level: 'warning', message: `purge des MP3 de plus de ${AUDIO_RETENTION_DAYS} jours impossible : ${messageOf(e)}` }] };
  }
}
