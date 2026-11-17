import { z } from 'zod';
import { IsoDateSchema } from '@daily-brief/schema';
import { messageOf } from '../collect/http';
import type { SupabaseClient } from '../supabase/client';
import type { PublishIssue } from './inputs';

/** Les MP3 sont gardés 30 jours (spec §6.2). */
export const AUDIO_RETENTION_DAYS = 30;
/** Entrées demandées par page de listage Storage. */
export const LIST_PAGE_SIZE = 100;
/** Dossiers datés examinés par passage : le reste est repris au passage suivant. */
const MAX_FOLDERS = 100;
/** Pages lues au plus par dossier : borne le passage même si Storage répond sans fin. */
const MAX_PAGES = 50;
/** Chemins supprimés par appel à Storage. */
const REMOVE_CHUNK = 100;

/** Seul un chemin écrit par la publication (`AAAA-MM-JJ/<langue>.mp3`) peut être supprimé. */
const AUDIO_PATH = /^(\d{4}-\d{2}-\d{2})\/(fr|en|es)\.mp3$/;
const DATED_FOLDER = /^\d{4}-\d{2}-\d{2}$/;
const MP3_NAME = /^(fr|en|es)\.mp3$/;
const Expired = z.array(z.object({ date: IsoDateSchema, path: z.string() }));
const Ack = z.object({}).loose();

/** Jour limite : les dossiers et éditions strictement antérieurs ont plus de 30 jours. */
function cutoffOf(date: string): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) - AUDIO_RETENTION_DAYS * 86_400_000).toISOString().slice(0, 10);
}

/** Toutes les entrées d'un dossier, page après page. */
async function listAll(client: SupabaseClient, prefix: string, pageSize: number): Promise<{ name: string; folder: boolean }[]> {
  const all: { name: string; folder: boolean }[] = [];
  for (let page = 0; page < MAX_PAGES; page++) {
    const entries = await client.list('audio', prefix, { limit: pageSize, offset: page * pageSize });
    all.push(...entries);
    if (entries.length < pageSize) break;
  }
  return all;
}

/**
 * Supprime du bucket `audio` les MP3 de plus de 30 jours, par l'API Storage (une suppression en SQL
 * laisserait le fichier orphelin), puis vide `editions.audio_path`. Deux sources :
 *  - les éditions de plus de 30 jours (`audio_expired`), à condition que la date du chemin soit celle de
 *    l'édition ; un chemin douteux n'est jamais supprimé, il est vidé de `audio_path` et signalé une fois ;
 *  - le bucket lui-même, listé par dossier daté : un MP3 sans ligne d'édition (publication interrompue,
 *    ligne supprimée) est supprimé dès que son dossier a plus de 30 jours.
 * Dans cet ordre : un échec après la suppression est rattrapé au passage suivant, la suppression d'un
 * fichier déjà absent étant sans effet. Tout échec n'est qu'un avertissement.
 */
export async function purgeExpiredAudio(client: SupabaseClient, date: string, options: { pageSize?: number } = {}): Promise<{ removed: number; issues: PublishIssue[] }> {
  const issues: PublishIssue[] = [];
  const pageSize = options.pageSize ?? LIST_PAGE_SIZE;
  try {
    const expired = await client.rpc('audio_expired', { p_date: date, p_days: AUDIO_RETENTION_DAYS }, Expired);
    const good = expired.filter((e) => AUDIO_PATH.exec(e.path)?.[1] === e.date).map((e) => e.path);
    const bad = expired.filter((e) => AUDIO_PATH.exec(e.path)?.[1] !== e.date).map((e) => e.path);
    const paths = new Set(good);

    // Dossiers datés de plus de 30 jours : MP3 orphelins. Un échec du listage ne bloque pas le reste.
    try {
      const cutoff = cutoffOf(date);
      const folders = (await listAll(client, '', pageSize)).filter((e) => e.folder && DATED_FOLDER.test(e.name) && e.name < cutoff).slice(0, MAX_FOLDERS);
      for (const folder of folders) {
        for (const entry of await listAll(client, folder.name, pageSize)) if (!entry.folder && MP3_NAME.test(entry.name)) paths.add(`${folder.name}/${entry.name}`);
      }
    } catch (e) {
      issues.push({ level: 'warning', message: `purge audio : listage du bucket impossible : ${messageOf(e)}` });
    }

    // Chemins douteux : vidés d'abord (aucun fichier supprimé pour eux), signalés une seule fois.
    if (bad.length > 0) {
      await client.rpc('audio_clear', { p_paths: bad }, Ack);
      issues.push({ level: 'warning', message: `purge audio : ${bad.length} chemin(s) inattendu(s) retiré(s) de editions.audio_path (aucun fichier supprimé pour eux)` });
    }
    const all = [...paths].sort();
    for (let i = 0; i < all.length; i += REMOVE_CHUNK) await client.remove('audio', all.slice(i, i + REMOVE_CHUNK));
    if (all.length > 0) await client.rpc('audio_clear', { p_paths: all }, Ack);
    return { removed: all.length, issues };
  } catch (e) {
    return { removed: 0, issues: [...issues, { level: 'warning', message: `purge des MP3 de plus de ${AUDIO_RETENTION_DAYS} jours impossible : ${messageOf(e)}` }] };
  }
}
