import { z } from 'zod';
import { LANGS, type Lang } from '@daily-brief/schema';
import type { RunRecord, RunStatus } from './data/types';

/** Au-delà de 6 h, une ligne `runs` restée à `running` est un passage interrompu (consigne du lot 3). */
export const INTERRUPTED_AFTER_MS = 6 * 3600 * 1000;

/** Ordre de la routine (lot 5) : les étapes inconnues suivent, par ordre alphabétique. */
export const STEP_ORDER = ['context', 'collect', 'verify', 'audio', 'render', 'publish', 'drive'];

const StepSchema = z.object({
  status: z.string(),
  finishedAt: z.string().nullable().optional(),
  durationMs: z.number().nullable().optional(),
  counters: z.record(z.string(), z.number()).optional(),
  errors: z.array(z.string()).optional(),
  perLang: z.record(z.string(), z.object({ light: z.boolean() }).loose()).optional(),
});

export type StepView = { name: string; status: string; finishedAt: string | null; durationMs: number | null; counters: [string, number][]; errors: string[] };
export type RunView = {
  date: string;
  status: RunStatus | 'interrupted';
  label: string;
  updatedAt: string;
  steps: StepView[];
  closedThreads: number;
  light: Lang[];
  notes: string | null;
  problems: number;
};

const LABEL: Record<RunView['status'], string> = { ok: 'réussi', degraded: 'dégradé', failed: 'échec', running: 'en cours', interrupted: 'interrompu' };

/** Ligne `runs` → affichage de la page Santé. `steps` est validé étape par étape ; une étape illisible est signalée. */
export function runView(run: RunRecord, now: Date): RunView {
  const raw = run.steps && typeof run.steps === 'object' ? (run.steps as Record<string, unknown>) : {};
  const steps: StepView[] = [];
  let problems = 0;
  for (const [name, value] of Object.entries(raw)) {
    if (name === 'closedThreads') continue;
    const s = StepSchema.safeParse(value);
    if (!s.success) {
      problems++;
      steps.push({ name, status: 'illisible', finishedAt: null, durationMs: null, counters: [], errors: [] });
      continue;
    }
    steps.push({ name, status: s.data.status, finishedAt: s.data.finishedAt ?? null, durationMs: s.data.durationMs ?? null, counters: Object.entries(s.data.counters ?? {}), errors: s.data.errors ?? [] });
  }
  const rank = (n: string) => (STEP_ORDER.includes(n) ? STEP_ORDER.indexOf(n) : STEP_ORDER.length);
  steps.sort((a, b) => rank(a.name) - rank(b.name) || a.name.localeCompare(b.name));
  const closed = Array.isArray(raw.closedThreads) ? raw.closedThreads.length : 0;
  const perLang = StepSchema.safeParse(raw.collect).data?.perLang ?? {};
  const light = LANGS.filter((l) => perLang[l]?.light === true);
  const age = now.getTime() - new Date(run.updatedAt).getTime();
  const status: RunView['status'] = run.status === 'running' && age > INTERRUPTED_AFTER_MS ? 'interrupted' : run.status;
  return { date: run.date, status, label: LABEL[status], updatedAt: run.updatedAt, steps, closedThreads: closed, light, notes: run.notes, problems };
}
