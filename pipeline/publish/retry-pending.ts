import { z } from 'zod';
import { IsoDateSchema } from '@daily-brief/schema';
import { messageOf } from '../collect/http';
import type { SupabaseClient } from '../supabase/client';
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
const Ack = z.object({}).loose();

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
    list = await client.rpc('drive_pending_list', { p_max_attempts: MAX_ATTEMPTS, p_limit: RETRY_LIMIT + 1 }, ListSchema);
  } catch (e) {
    warn(`dépôts Drive en attente illisibles : ${messageOf(e)}`);
    return out;
  }
  out.abandoned = list.abandoned;
  if (list.abandoned > 0) warn(`${list.abandoned} dépôt(s) Drive abandonné(s) après ${MAX_ATTEMPTS} tentatives (table drive_pending)`);

  for (const row of list.rows.filter((r) => r.date !== today).slice(0, RETRY_LIMIT)) {
    if (drive.breaker.open || client.breaker.open) break;
    const parsed = z.array(z.unknown()).safeParse(row.files);
    const remaining: DayFile[] = [];
    /** Fichiers perdus : absents de Storage, au mauvais format ou incohérents. Ils ne sont jamais envoyés. */
    const dropped: string[] = [];
    let incoherent = 0;
    let sent = 0;
    let lastError = '';
    if (!parsed.success) {
      dropped.push('liste de fichiers illisible');
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
          warn(`${file.name} n’existe plus dans Supabase Storage : dépôt Drive abandonné`);
          dropped.push(file.name);
          remaining.push(file);
          continue;
        }
        if (!looksLike(file, bytes)) {
          warn(`${file.name} relu dans Supabase Storage n’a pas le bon format : dépôt Drive abandonné`);
          dropped.push(`${file.name} (format invalide)`);
          remaining.push(file);
          continue;
        }
        await drive.send(row.date, file, bytes);
        sent++;
      } catch (e) {
        lastError = messageOf(e);
        remaining.push(file);
      }
    }
    if (incoherent > 0) dropped.push(`${incoherent} entrée(s) incohérente(s)`);
    if (dropped.length === 0 && remaining.length === 0 && sent === 0) dropped.push('aucun fichier à déposer');
    try {
      if (dropped.length > 0) {
        // Un fichier perdu ne se retrouvera jamais : le dépôt est abandonné, mais reste visible.
        const reason = `fichier(s) introuvable(s) dans Storage : ${dropped.join(', ')}`;
        await client.rpc('drive_pending_fail', { p_date: row.date, p_error: reason.slice(0, 500), p_files: remaining, p_attempts_at_least: MAX_ATTEMPTS }, Ack);
        out.abandoned++;
        warn(`dépôt Drive du ${row.date} abandonné : ${reason}`);
      } else if (remaining.length === 0 && sent > 0) {
        await resolvePending(client, row.date);
        out.resolved.push(row.date);
      } else {
        await client.rpc('drive_pending_fail', { p_date: row.date, p_error: lastError.slice(0, 500), p_files: remaining }, Ack);
        out.failed.push(row.date);
        warn(`dépôt Drive du ${row.date} toujours en attente (tentative ${row.attempts + 1} sur ${MAX_ATTEMPTS}) : ${lastError}`);
      }
    } catch (e) {
      out.failed.push(row.date);
      warn(`dépôt en attente du ${row.date} : mise à jour impossible : ${messageOf(e)}`);
    }
  }
  return out;
}
