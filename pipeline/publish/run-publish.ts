import { mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { IsoDateSchema, LANGS, type Lang } from '@daily-brief/schema';
import { messageOf, type HttpFetch } from '../collect/http';
import { writeAtomic } from '../lib/fs';
import { redactText, stripSecrets } from '../lib/redact';
import { Ack, createSupabaseClient, type SupabaseClient, type SupabaseFetch } from '../supabase/client';
import { supabaseConfig } from '../supabase/config';
import { purgeExpiredAudio } from './audio-purge';
import { createDriveClient, driveConfig, MISSING_DRIVE, type DriveClient } from './drive';
import type { DayFile } from './files';
import { loadPublishInputs, type LocalFile, type PublishIssue } from './inputs';
import { queuePending, resolvePending, retryPending } from './retry-pending';
import { capErrors, summarizeReports, type StepSummary } from './run-summary';
import { publishEditions, uploadFiles, type EditionResult } from './supabase';

export type RunPublishOptions = {
  outDir: string;
  date: string;
  /** SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, APPS_SCRIPT_URL, APPS_SCRIPT_TOKEN. */
  env: Record<string, string | undefined>;
  supabaseFetch: SupabaseFetch;
  driveFetch: HttpFetch;
  /** Hôtes permis pour Apps Script (tests : serveur local). */
  driveHosts?: string[];
  /** Délai d'un dépôt Drive (3 min par défaut). */
  driveTimeoutMs?: number;
  /** Échéance globale, en ms (15 min par défaut) : au-delà, tout appel restant est interrompu. */
  deadlineMs?: number;
  /** Marge gardée avant l'échéance globale pour la mise en attente et la ligne `runs` (60 s par défaut) : Drive est coupé avant. */
  driveReserveMs?: number;
  /** Délai propre de la mise en attente Drive et de la ligne `runs`, indépendant de l'échéance globale (30 s par défaut). */
  bookkeepingMs?: number;
  now?: Date;
  /** Horloge des durées (ms), remplaçable dans les tests. */
  clock?: () => number;
};

export type DriveStatus = 'sent' | 'pending' | 'failed' | 'skipped';

export type PublishReport = {
  date: string;
  generatedAt: string;
  exitCode: 0 | 2;
  /** `ok` : tout est publié et déposé ; `degraded` : publié, avec un manque ; `failed` : rien de publié. */
  status: 'ok' | 'degraded' | 'failed';
  editions: EditionResult[];
  /** Fichiers du jour et leur sort dans Supabase Storage. */
  files: { name: string; bucket: string; path: string; stored: boolean }[];
  drive: { status: DriveStatus; sent: string[]; pending: string[]; retried: { resolved: string[]; failed: string[]; abandoned: number } };
  audioPurged: number;
  /** Vrai si la ligne `runs` du jour a été écrite. */
  runSaved: boolean;
  durationMs: number;
  issues: PublishIssue[];
};

export type RunPublishResult = { exitCode: 0 | 2; report: PublishReport; /** Faux si publish-report.json n'a pas pu être écrit. */ reportWritten: boolean };


/**
 * `brief:publish` : publie ce que `brief:render` a produit pour `date`.
 *   1. retente les dépôts Drive en attente ;
 *   2. dépose le PDF et les MP3 dans Supabase Storage ;
 *   3. publie chaque édition (une transaction par édition) ;
 *   4. dépose les fichiers dans Drive — en cas d'échec, ils sont mis en attente (`drive_pending`) ;
 *   5. purge les MP3 de plus de 30 jours ;
 *   6. écrit la ligne `runs` du jour, puis `publish-report.json`.
 * Chaque étape est indépendante : un échec devient un problème du rapport, jamais une exception.
 * L'ancien rapport est supprimé d'abord ; le nouveau est toujours écrit, sans aucun secret.
 * Code 0 si au moins une édition est publiée dans Supabase (Drive peut rester en attente), 2 sinon.
 */
export async function runPublish(opts: RunPublishOptions): Promise<RunPublishResult> {
  const now = opts.now ?? new Date();
  const clock = opts.clock ?? Date.now;
  const started = clock();
  const secrets = [opts.env.SUPABASE_SERVICE_ROLE_KEY?.trim(), opts.env.APPS_SCRIPT_TOKEN?.trim(), opts.env.APPS_SCRIPT_URL?.trim()];
  const clean = (m: string) => redactText(m, secrets);
  const report: PublishReport = {
    date: opts.date,
    generatedAt: now.toISOString(),
    exitCode: 2,
    status: 'failed',
    editions: [],
    files: [],
    drive: { status: 'skipped', sent: [], pending: [], retried: { resolved: [], failed: [], abandoned: 0 } },
    audioPurged: 0,
    runSaved: false,
    durationMs: 0,
    issues: [],
  };
  const issue = (level: PublishIssue['level'], message: string, lang?: Lang) => report.issues.push({ level, ...(lang ? { lang } : {}), message: clean(message) });
  const add = (list: PublishIssue[]) => list.forEach((i) => issue(i.level, i.message, i.lang));

  if (!IsoDateSchema.safeParse(opts.date).success) {
    issue('error', `date incorrecte : « ${opts.date} »`);
    return { exitCode: 2, report, reportWritten: false };
  }
  const dayDir = join(opts.outDir, opts.date);
  const reportPath = join(dayDir, 'publish-report.json');
  try {
    mkdirSync(dayDir, { recursive: true });
    rmSync(reportPath, { force: true });
  } catch (e) {
    issue('error', `dossier de sortie inutilisable : ${messageOf(e)}`);
    return { exitCode: 2, report, reportWritten: false };
  }

  const published = () => report.editions.filter((e) => e.published);
  const finish = (): RunPublishResult => {
    report.exitCode = published().length > 0 ? 0 : 2;
    report.durationMs = clock() - started;
    let reportWritten = true;
    try {
      writeAtomic(reportPath, stripSecrets(JSON.stringify(report, null, 2), secrets) + '\n');
    } catch {
      reportWritten = false;
    }
    return { exitCode: report.exitCode, report, reportWritten };
  };

  const deadlineMs = opts.deadlineMs ?? 15 * 60_000;
  const global = AbortSignal.timeout(deadlineMs);
  // Drive s'arrête avant l'échéance globale : il reste de quoi mettre en attente et écrire `runs`.
  const driveSignal = AbortSignal.any([global, AbortSignal.timeout(Math.max(1, deadlineMs - (opts.driveReserveMs ?? 60_000)))]);
  let sbConfig: Extract<ReturnType<typeof supabaseConfig>, { ok: true }>['config'] | null = null;
  /** Client des écritures de suivi (`drive_pending`, `runs`) : son délai ne dépend pas de l'échéance globale. */
  const bookClient = (): SupabaseClient => (client?.breaker.open && client.breaker.reason !== 'délai dépassé' ? client : createSupabaseClient(sbConfig!, opts.supabaseFetch, { signal: AbortSignal.timeout(opts.bookkeepingMs ?? 30_000) }));
  let client: SupabaseClient | null = null;
  let summary: ReturnType<typeof summarizeReports> | null = null;
  const driveErrors: string[] = [];
  try {
    const inputs = loadPublishInputs(dayDir, opts.date);
    add(inputs.issues);
    summary = summarizeReports(dayDir, opts.date);
    add(summary.issues);
    const local: LocalFile[] = [...(inputs.pdf ? [inputs.pdf] : []), ...inputs.audio];

    const sb = supabaseConfig(opts.env);
    if (sb.ok) {
      sbConfig = sb.config;
      client = createSupabaseClient(sb.config, opts.supabaseFetch, { signal: global });
    }
    else issue('error', `${sb.error} : rien n’est publié dans Supabase`);

    let drive: DriveClient | null = null;
    const dr = driveConfig(opts.env, opts.driveHosts);
    let retryDrive: DriveClient | null = null;
    if (dr.ok) {
      drive = createDriveClient(dr.config, opts.driveFetch, { signal: driveSignal, hosts: opts.driveHosts, timeoutMs: opts.driveTimeoutMs });
      // La relance des vieux dépôts a son propre disjoncteur : un vieux fichier en échec ne bloque pas le dépôt du jour.
      retryDrive = createDriveClient(dr.config, opts.driveFetch, { signal: driveSignal, hosts: opts.driveHosts, timeoutMs: opts.driveTimeoutMs });
    }
    else issue(dr.error === MISSING_DRIVE ? 'warning' : 'error', `${dr.error} : dépôt Drive ignoré`);

    // 1. Dépôts Drive en attente des jours précédents.
    if (client && retryDrive) {
      const retried = await retryPending(client, retryDrive, opts.date);
      report.drive.retried = { resolved: retried.resolved, failed: retried.failed, abandoned: retried.abandoned };
      add(retried.issues);
    }

    // 2. Fichiers dans Supabase Storage, avant les éditions : `publish_edition` écrit leurs chemins.
    let stored: DayFile[] = [];
    if (client && inputs.editions.length > 0) {
      const up = await uploadFiles(client, local);
      stored = up.stored;
      add(up.issues);
    }
    report.files = local.map((f) => ({ name: f.name, bucket: f.bucket, path: f.path, stored: stored.some((s) => s.path === f.path && s.bucket === f.bucket) }));

    // 3. Éditions.
    if (client && inputs.editions.length > 0) {
      const pub = await publishEditions(client, inputs.editions, { stored, light: summary.light, generatedAt: inputs.renderedAt ?? now.toISOString() });
      report.editions = pub.results;
      add(pub.issues);
    } else {
      report.editions = inputs.editions.map((e) => ({ lang: e.lang, published: false, stories: 0, sources: 0, vocab: 0, threadsCreated: 0 }));
    }
    if (published().length === 0) issue('error', 'aucune édition publiée');

    // 4. Drive : un fichier par requête ; ce qui échoue est mis en attente s'il est dans Storage.
    if (drive && local.length > 0) {
      const failed: LocalFile[] = [];
      for (const { bytes, lang: _lang, ...file } of local) {
        try {
          await drive.send(opts.date, file, bytes);
          report.drive.sent.push(file.name);
        } catch (e) {
          driveErrors.push(messageOf(e));
          failed.push({ ...file, bytes });
        }
      }
      if (failed.length === 0) {
        report.drive.status = 'sent';
        if (client) await resolvePending(bookClient(), opts.date).catch((e) => issue('warning', `dépôt en attente du ${opts.date} non soldé : ${messageOf(e)}`));
      } else {
        const queueable = failed.filter((f) => stored.some((s) => s.path === f.path && s.bucket === f.bucket)).map(({ bytes: _bytes, lang: _lang, ...f }) => f);
        let queued = false;
        let queueFailed = false;
        if (client && queueable.length > 0) {
          try {
            await queuePending(bookClient(), opts.date, queueable, clean(driveErrors.at(-1) ?? ''));
            queued = true;
            report.drive.pending = queueable.map((f) => f.name);
          } catch (e) {
            queueFailed = true;
            issue('error', `mise en attente Drive impossible : ${messageOf(e)}`);
          }
        }
        report.drive.status = queued ? 'pending' : 'failed';
        const lost = failed.filter((f) => !report.drive.pending.includes(f.name)).map((f) => f.name);
        issue('warning', `Drive : ${failed.length} fichier(s) non déposé(s) (${driveErrors[0]})${queued ? ' — mis en attente, retentés au prochain passage' : ''}`);
        if (lost.length > 0) issue('error', `Drive : ${lost.join(', ')} ni déposé(s) ni mis en attente (${queueFailed ? 'mise en attente impossible' : 'absent(s) de Supabase Storage'})`);
      }
    }

    // 5. Purge des MP3 de plus de 30 jours (seulement quand la publication du jour a abouti).
    if (client && published().length > 0) {
      const purge = await purgeExpiredAudio(client, opts.date);
      report.audioPurged = purge.removed;
      add(purge.issues);
    }
  } catch (e) {
    // Quoi qu'il arrive, le rapport est écrit : la routine ne doit jamais lire un état périmé.
    issue('error', `erreur inattendue : ${messageOf(e)}`);
  }

  // Un fichier du jour absent de Storage (le PDF comme un MP3) rend le passage dégradé.
  const filesMissing = !report.files.some((f) => f.bucket === 'pdf' && f.stored) || report.files.some((f) => !f.stored);
  // Une édition manquante (non contrôlée ou non publiée) rend aussi le passage dégradé : la page Santé dit alors ce que dit la notification (« Brief incomplet »).
  report.status = published().length === 0 ? 'failed' : published().length < LANGS.length || report.issues.some((i) => i.level === 'error') || filesMissing || report.drive.status === 'pending' || report.drive.status === 'failed' ? 'degraded' : 'ok';

  // 6. Ligne `runs` du jour : bilan de chaque étape, pour la page Santé.
  if (client && summary) {
    const sum = (key: 'stories' | 'sources' | 'vocab' | 'threadsCreated') => report.editions.reduce((n, e) => n + e[key], 0);
    const publishStep: StepSummary = {
      status: report.status,
      finishedAt: now.toISOString(),
      durationMs: clock() - started,
      counters: { editions: published().length, stories: sum('stories'), sources: sum('sources'), vocab: sum('vocab'), threadsCreated: sum('threadsCreated'), files: report.files.filter((f) => f.stored).length, audioPurged: report.audioPurged },
      errors: capErrors(report.issues.filter((i) => i.level === 'error').map((i) => (i.lang ? `${i.lang.toUpperCase()} : ${i.message}` : i.message))),
    };
    // MP3 réellement publiés : enregistrés dans Storage et rattachés à une édition publiée.
    const audioPublished = report.files.filter((f) => f.bucket === 'audio' && f.stored && published().some((e) => f.path === `${opts.date}/${e.lang}.mp3`)).length;
    const audioStep = summary.steps.audio.status === 'missing' || summary.steps.audio.status === 'unreadable' ? summary.steps.audio : { ...summary.steps.audio, counters: { ...summary.steps.audio.counters, published: audioPublished } };
    const steps = {
      ...summary.steps,
      audio: audioStep,
      publish: publishStep,
      drive: {
        status: report.drive.status,
        counters: { sent: report.drive.sent.length, pending: report.drive.pending.length, retriedResolved: report.drive.retried.resolved.length, retriedFailed: report.drive.retried.failed.length, abandoned: report.drive.retried.abandoned },
        errors: capErrors(driveErrors.map(clean)),
      },
    };
    const notes = `${published().length} édition(s) publiée(s) : ${published().map((e) => e.lang.toUpperCase()).join(', ') || 'aucune'} ; Drive : ${report.drive.status}`;
    try {
      // L'écriture a son propre délai, même sans édition publiée : un passage en échec à l'échéance est noté.
      await bookClient().rpc('save_run', { p_date: opts.date, p_status: report.status, p_steps: JSON.parse(stripSecrets(JSON.stringify(steps), secrets)), p_notes: notes }, Ack);
      report.runSaved = true;
    } catch (e) {
      issue('warning', `ligne runs non écrite : ${messageOf(e)}`);
    }
  }
  return finish();
}
