import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import { ContextSchema, IsoDateSchema, LANGS, LangSchema, OpenThreadSchema, type Context, type OpenThread } from '@daily-brief/schema';
import { stripSecrets } from '../collect/redact';
import { STALE_DAYS } from './stale';
import type { ContextStore, Topic } from './store';

export type ContextIssue = { level: 'error' | 'warning'; message: string };

export type ContextReport = {
  date: string;
  generatedAt: string;
  exitCode: 0 | 2;
  store: string;
  staleDays: number;
  closedThreads: string[];
  openThreads: number;
  yesterdayTopics: number;
  issues: ContextIssue[];
};

export type RunContextOptions = {
  outDir: string;
  date: string;
  store: ContextStore;
  /** Avertissements préalables (choix du store). */
  warnings?: string[];
  /** Secrets à masquer dans les messages (clé Supabase). */
  secrets?: (string | undefined)[];
  /** Délai de chaque appel au store (30 s par défaut). */
  timeoutMs?: number;
  now?: Date;
};

const TopicSchema = z.object({ lang: LangSchema, title: z.string().trim().min(1) });
const ClosedSchema = z.array(z.string().min(1));

/** Appel au store borné dans le temps : une base muette ne bloque jamais la routine. */
async function withTimeout<T>(label: string, ms: number, fn: () => Promise<T>): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} : délai dépassé (${ms} ms)`)), ms);
  });
  try {
    return await Promise.race([fn(), timeout]);
  } finally {
    clearTimeout(timer);
  }
}

const langRank = (l: string) => (LANGS as readonly string[]).indexOf(l);
const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/**
 * `brief:context` : ferme les Threads périmés (R12, 21 jours), lit les Threads ouverts et les sujets
 * de la veille, puis écrit `out/<date>/context.json` (ContextSchema) et `context-report.json`.
 * Chaque élément est revalidé : un élément invalide est retiré avec un avertissement. Une erreur ou
 * un délai dépassé du store : pas de context.json et code 2 (un contexte faux ferait dupliquer des
 * Threads). Les anciens fichiers sont supprimés d'abord ; le rapport est toujours écrit.
 */
export async function runContext(opts: RunContextOptions): Promise<{ exitCode: 0 | 2; report: ContextReport }> {
  const now = opts.now ?? new Date();
  const ms = opts.timeoutMs ?? 30_000;
  const clean = (m: string) => stripSecrets(m, opts.secrets ?? []);
  const report: ContextReport = {
    date: opts.date,
    generatedAt: now.toISOString(),
    exitCode: 2,
    store: opts.store.name,
    staleDays: STALE_DAYS,
    closedThreads: [],
    openThreads: 0,
    yesterdayTopics: 0,
    issues: (opts.warnings ?? []).map((m) => ({ level: 'warning' as const, message: clean(m) })),
  };
  const issue = (level: ContextIssue['level'], message: string) => report.issues.push({ level, message: clean(message) });
  if (!IsoDateSchema.safeParse(opts.date).success) {
    issue('error', `date incorrecte : « ${opts.date} »`);
    return { exitCode: 2, report };
  }
  const dayDir = join(opts.outDir, opts.date);
  const contextPath = join(dayDir, 'context.json');
  const reportPath = join(dayDir, 'context-report.json');
  mkdirSync(dayDir, { recursive: true });
  rmSync(contextPath, { force: true });
  rmSync(reportPath, { force: true });

  const finish = (context: Context | null) => {
    report.exitCode = context ? 0 : 2;
    if (context) writeFileSync(contextPath, JSON.stringify(context, null, 2) + '\n');
    writeFileSync(reportPath, clean(JSON.stringify(report, null, 2)) + '\n');
    return { exitCode: report.exitCode, report };
  };

  try {
    const closed = ClosedSchema.parse(await withTimeout('fermeture des Threads', ms, () => opts.store.closeStaleThreads(opts.date, STALE_DAYS)));
    report.closedThreads = [...new Set(closed)].sort();
    const rawThreads: unknown[] = await withTimeout('Threads ouverts', ms, () => opts.store.openThreads());
    const rawTopics: unknown[] = await withTimeout('sujets de la veille', ms, () => opts.store.yesterdayTopics(opts.date));

    const threads = new Map<string, OpenThread>();
    for (const [i, raw] of rawThreads.entries()) {
      const t = OpenThreadSchema.safeParse(raw);
      if (!t.success) issue('warning', `Thread n° ${i + 1} invalide, ignoré : ${t.error.issues.map((x) => `${x.path.join('.')} ${x.message}`).join(' ; ')}`);
      else if (report.closedThreads.includes(t.data.id)) issue('warning', `Thread ${t.data.id} fermé mais encore listé ouvert, ignoré`);
      else if (threads.has(t.data.id)) issue('warning', `Thread ${t.data.id} en double, ignoré`);
      else threads.set(t.data.id, t.data);
    }
    const topics: Topic[] = [];
    for (const [i, raw] of rawTopics.entries()) {
      const t = TopicSchema.safeParse(raw);
      if (t.success) topics.push(t.data);
      else issue('warning', `sujet de la veille n° ${i + 1} invalide, ignoré`);
    }

    const context = ContextSchema.parse({
      date: opts.date,
      openThreads: [...threads.values()].sort((a, b) => langRank(a.lang) - langRank(b.lang) || Date.parse(b.updatedAt) - Date.parse(a.updatedAt) || cmp(a.id, b.id)),
      yesterdayTopics: topics.map((t, i) => ({ t, i })).sort((a, b) => langRank(a.t.lang) - langRank(b.t.lang) || a.i - b.i).map(({ t }) => t),
    });
    report.openThreads = context.openThreads.length;
    report.yesterdayTopics = context.yesterdayTopics.length;
    return finish(context);
  } catch (e) {
    issue('error', `store ${opts.store.name} : ${e instanceof Error ? e.message : String(e)}`);
    return finish(null);
  }
}
