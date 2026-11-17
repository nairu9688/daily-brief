import { z } from 'zod';
import { IsoDateSchema } from '@daily-brief/schema';
import { messageOf } from '../collect/http';
import { Ack, type SupabaseClient } from '../supabase/client';
import type { DriveClient } from './drive';
import { isDayFile, looksLike, type DayFile } from './files';
import type { PublishIssue } from './inputs';

/** Après ce nombre de tentatives, un dépôt en attente n'est plus retenté (il reste visible dans `drive_pending`). */
export const MAX_ATTEMPTS = 5;
/** Dépôts en attente retentés par passage, les plus anciens d'abord : le passage reste borné dans le temps. */
export const RETRY_LIMIT = 5;

const FileSchema = z.object({ name: z.string(), mimeType: z.enum(['application/pdf', 'audio/mpeg']), bucket: z.enum(['pdf', 'audio']), path: z.string() });
const ListSchema = z.object({
  rows: z.array(z.object({ date: IsoDateSchema, files: z.unknown(), attempts: z.number().int().min(0) })),
  abandoned: z.number().int().min(0),
});
const Claimed = z.object({ date: IsoDateSchema, files: z.unknown(), attempts: z.number().int().min(0) }).nullable();
const Dates = z.array(z.string());
/** Un dépôt abandonné est supprimé de `drive_pending` après ce nombre de jours. */
export const ABANDONED_KEEP_DAYS = 30;

/** Met en attente le dépôt Drive de `date` : ces fichiers seront relus dans Storage au passage suivant. */
export async function queuePending(client: SupabaseClient, date: string, files: DayFile[], error: string): Promise<void> {
  await client.rpc('drive_pending_put', { p_date: date, p_files: files, p_error: error.slice(0, 500) }, Ack);
}

/** Le dépôt de `date` a abouti : sa ligne en attente, s'il y en a une, disparaît. */
export async function resolvePending(client: SupabaseClient, date: string): Promise<void> {
  await client.rpc('drive_pending_resolve', { p_date: date }, Ack);
}

export type RetryResult = {
  /** Dates dont tous les fichiers sont maintenant dans Drive. */
  resolved: string[];
  /** Dates encore en attente après ce passage. */
  failed: string[];
  /** Dépôts abandonnés (au moins `MAX_ATTEMPTS` tentatives). */
  abandoned: number;
  issues: PublishIssue[];
};

/**
 * Retente les dépôts Drive en attente (spec §10, §12), sauf celui de `today`, que le passage en
 * cours envoie lui-même. Chaque fichier est relu dans Supabase Storage et revérifié (nom, date,
 * type, premiers octets) avant l'envoi. Un fichier qui n'existe plus dans Storage (MP3 purgé après
 * 30 jours) est abandonné avec un avertissement. Si Drive ou Supabase est coupé, on s'arrête là :
 * les dépôts non essayés ne perdent pas de tentative.
 */
export async function retryPending(client: SupabaseClient, drive: DriveClient, today: string): Promise<RetryResult> {
  const out: RetryResult = { resolved: [], failed: [], abandoned: 0, issues: [] };
  const warn = (message: string) => out.issues.push({ level: 'warning', message });
  let list: z.infer<typeof ListSchema>;
  try {
    // Les dépôts abandonnés depuis plus de 30 jours sortent de la table : une seule ligne d'avertissement.
    try {
      const expired = await client.rpc('drive_pending_expire', { p_today: today, p_days: ABANDONED_KEEP_DAYS, p_max_attempts: MAX_ATTEMPTS }, Dates);
      if (expired.length > 0) warn(`${expired.length} dépôt(s) Drive abandonné(s) depuis plus de ${ABANDONED_KEEP_DAYS} jours supprimé(s) de drive_pending : ${expired.join(', ')}`);
    } catch {
      // Ménage facultatif : la relance continue.
    }
    list = await client.rpc('drive_pending_list', { p_max_attempts: MAX_ATTEMPTS, p_limit: RETRY_LIMIT + 1 }, ListSchema);
  } catch (e) {
    warn(`dépôts Drive en attente illisibles : ${messageOf(e)}`);
    return out;
  }
  out.abandoned = list.abandoned;
  if (list.abandoned > 0) warn(`${list.abandoned} dépôt(s) Drive abandonné(s) après ${MAX_ATTEMPTS} tentatives (table drive_pending)`);

  for (const listed of list.rows.filter((r) => r.date !== today).slice(0, RETRY_LIMIT)) {
    if (drive.breaker.open || client.breaker.open) break;
    // La tentative est comptée avant tout traitement : une panne en cours de ligne ne l'efface pas.
    let row: { date: string; files: unknown; attempts: number };
    try {
      const claimed = await client.rpc('drive_pending_claim', { p_date: listed.date, p_max_attempts: MAX_ATTEMPTS }, Claimed);
      if (!claimed) continue;
      row = claimed;
    } catch (e) {
      out.failed.push(listed.date);
      warn(`dépôt en attente du ${listed.date} : prise en charge impossible : ${messageOf(e)}`);
      continue;
    }
    try {
      await retryRow(row);
    } catch (e) {
      // Une ligne qui plante ne bloque pas les suivantes.
      out.failed.push(row.date);
      warn(`dépôt en attente du ${row.date} : erreur inattendue : ${messageOf(e)}`);
    }
  }
  return out;

  async function retryRow(row: { date: string; files: unknown; attempts: number }): Promise<void> {
    const parsed = z.array(z.unknown()).safeParse(row.files);
    const remaining: DayFile[] = [];
    /** Fichiers perdus (absents de Storage ou au mauvais format) : ils ne sont jamais envoyés ni gardés en attente. */
    const lost: DayFile[] = [];
    const causes: string[] = [];
    const notFound: string[] = [];
    const badFormat: string[] = [];
    let incoherent = 0;
    let sent = 0;
    let lastError = '';
    if (!parsed.success) {
      causes.push('liste de fichiers illisible');
    }
    for (const raw of parsed.success ? parsed.data : []) {
      const f = FileSchema.safeParse(raw);
      if (!f.success || !isDayFile(f.data, row.date)) {
        warn(`dépôt en attente du ${row.date} : fichier incohérent ignoré`);
        incoherent++;
        continue;
      }
      const file = f.data;
      if (drive.breaker.open || client.breaker.open) {
        // Coupure en cours de ligne : le fichier reste en attente, sans être essayé.
        lastError ||= drive.breaker.open ? `Drive coupé (${drive.breaker.reason})` : `Supabase coupé (${client.breaker.reason})`;
        remaining.push(file);
        continue;
      }
      try {
        const bytes = await client.download(file.bucket, file.path);
        if (bytes === null) {
          warn(`${file.name} n’existe plus dans Supabase Storage : fichier retiré du dépôt Drive`);
          notFound.push(file.name);
          lost.push(file);
          continue;
        }
        if (!looksLike(file, bytes)) {
          warn(`${file.name} relu dans Supabase Storage n’a pas le bon format : fichier retiré du dépôt Drive`);
          badFormat.push(file.name);
          lost.push(file);
          continue;
        }
        await drive.send(row.date, file, bytes);
        sent++;
      } catch (e) {
        lastError = messageOf(e);
        remaining.push(file);
      }
    }
    if (notFound.length > 0) causes.push(`introuvable dans Storage : ${notFound.join(', ')}`);
    if (badFormat.length > 0) causes.push(`format invalide : ${badFormat.join(', ')}`);
    if (incoherent > 0) causes.push(`entrée incohérente : ${incoherent}`);
    if (causes.length === 0 && remaining.length === 0 && sent === 0) causes.push('aucun fichier à déposer');
    const reason = causes.join(' ; ');
    try {
      if (remaining.length === 0 && causes.length > 0) {
        // Plus aucun fichier à retenter et un fichier perdu pour toujours : le dépôt est abandonné,
        // mais reste visible avec les fichiers perdus.
        await client.rpc('drive_pending_fail', { p_date: row.date, p_error: reason.slice(0, 500), p_files: lost, p_attempts_at_least: MAX_ATTEMPTS }, Ack);
        out.abandoned++;
        warn(`dépôt Drive du ${row.date} abandonné : ${reason}`);
      } else if (remaining.length === 0 && sent > 0) {
        await resolvePending(client, row.date);
        out.resolved.push(row.date);
      } else {
        // Les fichiers perdus sont retirés de la ligne ; la cause reste dans l'erreur.
        const error = causes.length > 0 ? `${lastError} ; ${reason}` : lastError;
        await client.rpc('drive_pending_fail', { p_date: row.date, p_error: error.slice(0, 500), p_files: remaining }, Ack);
        out.failed.push(row.date);
        warn(`dépôt Drive du ${row.date} toujours en attente (tentative ${row.attempts} sur ${MAX_ATTEMPTS}) : ${lastError}`);
      }
    } catch (e) {
      out.failed.push(row.date);
      warn(`dépôt en attente du ${row.date} : mise à jour impossible : ${messageOf(e)}`);
    }
  }
}
