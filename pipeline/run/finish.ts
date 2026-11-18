import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { IsoDateSchema } from '@daily-brief/schema';
import { writeAtomic } from '../lib/fs';
import { buildNotification, type Notification } from './notify';

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
        steps.push({ step, exitCode: null, error: e instanceof Error ? e.message : String(e) });
      }
    }
  }
  const dayDir = join(opts.outDir, opts.date);
  const notification = IsoDateSchema.safeParse(opts.date).success
    ? buildNotification(dayDir, opts.date, { dryRun: opts.dryRun })
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
