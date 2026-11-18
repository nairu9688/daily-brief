import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import { IsoDateSchema, LANGS, type Lang } from '@daily-brief/schema';
import type { PublishIssue } from './inputs';

export type StepStatus = 'ok' | 'degraded' | 'failed' | 'missing' | 'unreadable';

/** Bilan d'une étape, rangé dans `runs.steps.<étape>` et affiché par la page Santé. */
export type StepSummary = {
  status: StepStatus;
  /** Fin de l'étape (`generatedAt` de son rapport). */
  finishedAt: string | null;
  /** Durée en ms ; null quand le rapport de l'étape ne la mesure pas. */
  durationMs: number | null;
  counters: Record<string, number>;
  errors: string[];
  /** Collecte seulement : articles, textes lus et édition allégée par langue. */
  perLang?: Partial<Record<Lang, { articles: number; fullTexts: number; light: boolean }>>;
};

export const MAX_ERRORS = 5;
export const MAX_ERROR_CHARS = 300;

/** Au plus 5 messages de 300 caractères : `runs` reste léger. */
export const capErrors = (messages: string[]): string[] => messages.slice(0, MAX_ERRORS).map((m) => (m.length > MAX_ERROR_CHARS ? `${m.slice(0, MAX_ERROR_CHARS - 1)}…` : m));

const Issues = z.array(z.object({ level: z.string(), message: z.string() }));
const Base = { date: IsoDateSchema, generatedAt: z.iso.datetime({ offset: true }), exitCode: z.number().int(), issues: Issues };
const ContextReport = z.object({ ...Base, openThreads: z.number().int(), yesterdayTopics: z.number().int(), closedThreads: z.array(z.string()) });
const LangStats = z.object({ articles: z.number().int(), fullTexts: z.number().int(), light: z.boolean() });
const CollectReport = z.object({ ...Base, degraded: z.boolean(), articles: z.number().int(), groups: z.number().int(), perLang: z.object({ fr: LangStats, en: LangStats, es: LangStats }).partial() });
const VerifyReport = z.object({ ...Base, editions: z.array(z.object({ lang: z.string(), written: z.boolean() })) });
const AudioReport = z.object({
  ...Base,
  status: z.enum(['ok', 'degraded', 'disabled', 'failed', 'invalid']),
  characters: z.object({ sent: z.number().int() }),
  editions: z.array(z.object({ lang: z.string(), file: z.string().nullable() })),
});
/** `disabled` (clé absente) est un passage dégradé : les éditions partent sans lecteur. */
const AUDIO_STEP: Record<z.infer<typeof AudioReport>['status'], StepStatus> = { ok: 'ok', degraded: 'degraded', disabled: 'degraded', failed: 'failed', invalid: 'failed' };
const RenderReport = z.object({ ...Base, pdf: z.string().nullable(), langs: z.array(z.string()), finals: z.array(z.string()) });

const errorsOf = (issues: z.infer<typeof Issues>) => capErrors(issues.filter((i) => i.level === 'error').map((i) => i.message));
const countOf = (issues: z.infer<typeof Issues>, level: string) => issues.filter((i) => i.level === level).length;

export type ReportsSummary = {
  steps: Record<'context' | 'collect' | 'verify' | 'audio' | 'render', StepSummary>;
  /** Éditions allégées d'après la collecte (`perLang.<lang>.light`). */
  light: Partial<Record<Lang, boolean>>;
  issues: PublishIssue[];
};

/**
 * Résume les rapports des étapes précédentes (`context-report.json`, `collect-report.json`,
 * `verify-report.json`, `audio-report.json`, `render-report.json`) pour la ligne `runs` du jour. Un rapport absent donne
 * `missing`, un rapport illisible ou d'une autre date `unreadable` avec un avertissement : jamais
 * d'exception. Ces rapports ne mesurent pas leur durée : `durationMs` vaut null.
 */
export function summarizeReports(dayDir: string, date: string): ReportsSummary {
  const issues: PublishIssue[] = [];
  const light: Partial<Record<Lang, boolean>> = {};

  function step<T extends { date: string; generatedAt: string }>(file: string, schema: z.ZodType<T>, build: (r: T) => Omit<StepSummary, 'finishedAt' | 'durationMs'>): StepSummary {
    const empty = (status: StepStatus): StepSummary => ({ status, finishedAt: null, durationMs: null, counters: {}, errors: [] });
    const path = join(dayDir, file);
    if (!existsSync(path)) return empty('missing');
    let report: T;
    try {
      report = schema.parse(JSON.parse(readFileSync(path, 'utf8')));
    } catch {
      issues.push({ level: 'warning', message: `${file} illisible : étape notée « unreadable » dans runs` });
      return empty('unreadable');
    }
    if (report.date !== date) {
      issues.push({ level: 'warning', message: `${file} est celui du ${report.date} : étape notée « unreadable » dans runs` });
      return empty('unreadable');
    }
    return { ...build(report), finishedAt: report.generatedAt, durationMs: null };
  }

  const steps = {
    context: step('context-report.json', ContextReport, (r) => ({
      status: r.exitCode === 0 ? 'ok' : 'failed',
      counters: { openThreads: r.openThreads, yesterdayTopics: r.yesterdayTopics, closedThreads: r.closedThreads.length, warnings: countOf(r.issues, 'warning') },
      errors: errorsOf(r.issues),
    })),
    collect: step('collect-report.json', CollectReport, (r) => {
      for (const lang of LANGS) if (r.perLang[lang]) light[lang] = r.perLang[lang].light;
      return {
        status: r.exitCode !== 0 ? 'failed' : r.degraded ? 'degraded' : 'ok',
        counters: { articles: r.articles, groups: r.groups, warnings: countOf(r.issues, 'warning') },
        errors: errorsOf(r.issues),
        perLang: r.perLang,
      };
    }),
    verify: step('verify-report.json', VerifyReport, (r) => ({
      status: r.exitCode === 0 ? 'ok' : r.exitCode === 1 ? 'degraded' : 'failed',
      counters: { editions: r.editions.filter((e) => e.written).length, fixed: countOf(r.issues, 'fixed'), warnings: countOf(r.issues, 'warning'), errors: countOf(r.issues, 'error') },
      errors: errorsOf(r.issues),
    })),
    audio: step('audio-report.json', AudioReport, (r) => ({
      status: AUDIO_STEP[r.status],
      counters: { mp3: r.editions.filter((e) => e.file !== null).length, characters: r.characters.sent, warnings: countOf(r.issues, 'warning') },
      errors: errorsOf(r.issues),
    })),
    render: step('render-report.json', RenderReport, (r) => ({
      status: r.exitCode === 0 ? (countOf(r.issues, 'error') ? 'degraded' : 'ok') : 'failed',
      counters: { finals: r.finals.length, pdfEditions: r.langs.length, pdf: r.pdf ? 1 : 0, warnings: countOf(r.issues, 'warning') },
      errors: errorsOf(r.issues),
    })),
  };
  return { steps, light, issues };
}
