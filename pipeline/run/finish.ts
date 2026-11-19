import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { IsoDateSchema } from '@daily-brief/schema';
import { runAudio } from '../audio/run-audio';
import type { HttpFetch } from '../collect/http';
import { writeAtomic } from '../lib/fs';
import { redactText } from '../lib/redact';
import { runPublish } from '../publish/run-publish';
import type { FetchLike } from '../render/http';
import { runRender, type RunRenderOptions } from '../render/run-render';
import type { SupabaseFetch } from '../supabase/client';
import { buildNotification, type Notification } from './notify';

/** Variables secrètes lues par les étapes de fin : masquées dans tout message. */
export const FINISH_SECRET_ENV = ['GOOGLE_TTS_API_KEY', 'SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'APPS_SCRIPT_URL', 'APPS_SCRIPT_TOKEN'] as const;
const PUBLISH_ENV = ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'APPS_SCRIPT_URL', 'APPS_SCRIPT_TOKEN'] as const;

export type FinishStepsOptions = {
  outDir: string;
  date: string;
  dryRun?: boolean;
  env: Partial<Record<string, string | undefined>>;
  fetch: typeof fetch;
  /** null : sans ffmpeg (option --no-ffmpeg) ; absent : détection habituelle. */
  ffmpeg?: null;
  print?: RunRenderOptions['print'];
};

/** Réseau coupé de la répétition : tout appel échoue sans partir. */
const offline = (async () => {
  throw new Error('répétition : aucun appel réseau');
}) as unknown as FetchLike;

/**
 * Les trois étapes de `brief:finish`. En répétition (`dryRun`), aucun appel extérieur : l'audio
 * part sans clé (« désactivé »), le rendu sans recherche de photos et sans réseau, et la publication n'est
 * pas lancée.
 */
export function finishSteps(o: FinishStepsOptions): Record<FinishStep, StepRunner> {
  const { outDir, date } = o;
  const ffmpeg = o.ffmpeg === null ? { ffmpeg: null } : {};
  const print = o.print ? { print: o.print } : {};
  if (o.dryRun) {
    return {
      audio: () => runAudio({ outDir, date, apiKey: undefined, fetch: offline as unknown as HttpFetch, ...ffmpeg }),
      render: () => runRender({ outDir, date, photoLookup: false, fetch: offline, ...print }),
      publish: async () => {
        throw new Error('répétition : pas de publication');
      },
    };
  }
  return {
    audio: () => runAudio({ outDir, date, apiKey: o.env.GOOGLE_TTS_API_KEY, fetch: o.fetch as HttpFetch, ...ffmpeg }),
    render: () => runRender({ outDir, date, fetch: o.fetch as FetchLike, ...print }),
    publish: () => runPublish({ outDir, date, env: Object.fromEntries(PUBLISH_ENV.map((n) => [n, o.env[n]])), supabaseFetch: o.fetch as SupabaseFetch, driveFetch: o.fetch as HttpFetch }),
  };
}

export type FinishStep = 'audio' | 'render' | 'publish';
/** Une étape lancée par `brief:finish` : son code de sortie, ou une exception (comptée comme code 2). */
export type StepRunner = () => Promise<{ exitCode: number }>;

export type RoutineReport = {
  date: string;
  generatedAt: string;
  exitCode: 0 | 2;
  dryRun: boolean;
  steps: { step: FinishStep; exitCode: number | null; error: string | null }[];
  notification: Notification;
};

export type RunFinishOptions = {
  outDir: string;
  date: string;
  steps: Record<FinishStep, StepRunner>;
  /** Répétition : pas de brief:publish, la notification compte les éditions rendues. */
  dryRun?: boolean;
  /** Valeurs secrètes à masquer dans le rapport (erreurs des étapes, notification). */
  secrets?: (string | undefined)[];
  now?: () => Date;
};

/**
 * `brief:finish` : la fin de la routine, après la boucle `brief:verify`. Lance, dans l'ordre et
 * quoi qu'il arrive à l'étape précédente, `brief:audio` → `brief:render` → `brief:publish`
 * (consigne du lot 5 : l'audio avant le rendu, qui lit audio.json, et avant la publication, qui
 * prend les MP3 annoncés). Écrit `routine-report.json` et renvoie le message final de la routine.
 * Code 0 : brief prêt (trois éditions publiées) ; 2 : brief incomplet.
 */
export async function runFinish(opts: RunFinishOptions): Promise<{ exitCode: 0 | 2; report: RoutineReport; reportWritten: boolean }> {
  const now = opts.now ?? (() => new Date());
  const order: FinishStep[] = opts.dryRun ? ['audio', 'render'] : ['audio', 'render', 'publish'];
  const steps: RoutineReport['steps'] = [];
  if (IsoDateSchema.safeParse(opts.date).success) {
    for (const step of order) {
      try {
        steps.push({ step, exitCode: (await opts.steps[step]()).exitCode, error: null });
      } catch (e) {
        steps.push({ step, exitCode: null, error: redactText(e instanceof Error ? e.message : String(e), opts.secrets ?? []) });
      }
    }
  }
  const dayDir = join(opts.outDir, opts.date);
  const notification = IsoDateSchema.safeParse(opts.date).success
    ? buildNotification(dayDir, opts.date, { dryRun: opts.dryRun, secrets: opts.secrets })
    : { ready: false, message: `Brief incomplet : date incorrecte (« ${opts.date} »)`, editions: [], stories: 0, outlets: 0, notes: [] };
  const report: RoutineReport = { date: opts.date, generatedAt: now().toISOString(), exitCode: notification.ready ? 0 : 2, dryRun: Boolean(opts.dryRun), steps, notification };
  let reportWritten = false;
  if (IsoDateSchema.safeParse(opts.date).success) {
    try {
      mkdirSync(dayDir, { recursive: true });
      writeAtomic(join(dayDir, 'routine-report.json'), JSON.stringify(report, null, 2) + '\n');
      reportWritten = true;
    } catch {
      reportWritten = false;
    }
  }
  return { exitCode: report.exitCode, report, reportWritten };
}
