import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { IsoDateSchema, LANGS, RawCollectionSchema, type Lang, type RawArticle } from '@daily-brief/schema';
import { canReadFull, loadWhitelist } from '../lib/whitelist';
import { RequestBudget } from './budget';
import { loadCollectConfig, THENEWSAPI_DAILY_CAP, type BudgetBucket, type CollectConfig } from './config';
import { dedupe } from './dedupe';
import { applyEditionPerimeter } from './perimeter';
import { collectExa } from './exa';
import { fillFullTexts, type FullTextStats } from './fulltext';
import { messageOf, type HttpFetch } from './http';
import { redactText, stripSecrets } from './redact';
import { collectRss, loadFeeds } from './rss';
import { loadRubriques } from './rubriques';
import { collectTheNewsApi } from './thenewsapi';
import type { SourceContext, SourceName, SourceRun } from './types';
import { readDailyUsage, recordDailyUsage, utcDay, writeDailyUsage } from './usage-ledger';
import { collectWebz } from './webz';

export type CollectKeys = { thenewsapi?: string; exa?: string; webz?: string };

export type RunCollectOptions = {
  outDir: string;
  date: string;
  keys: CollectKeys;
  fetch: HttpFetch;
  configPath: string;
  rubriquesPath: string;
  feedsPath: string;
  whitelistPath: string;
  /** Heure de la collecte (maintenant par défaut) : la fenêtre est `[now - windowHours, now]`. */
  now?: Date;
};

export type CollectIssue = { level: 'error' | 'warning'; source?: SourceName; message: string };

export type SourceReport = { used: boolean; requests: number; candidates: number; stoppedBy: string | null; errors: string[] };

export type CollectReport = {
  date: string;
  generatedAt: string;
  exitCode: 0 | 2;
  primary: CollectConfig['primary'] | null;
  articles: number;
  groups: number;
  perLang: Record<Lang, { articles: number; fullTexts: number; light: boolean }>;
  sources: Record<SourceName, SourceReport>;
  budget: {
    thenewsapi: { dailyCap: number; usedBefore: number; usedThisRun: number; perBucket: Record<BudgetBucket, number> | null };
    exa: { requests: number; max: number | null };
    webz: { requests: number; max: number | null };
  };
  fulltext: Omit<FullTextStats, 'errors'> | null;
  /** Textes renvoyés par une API pour un domaine qui n'est pas `full`, écartés (R1). */
  discardedTexts: number;
  issues: CollectIssue[];
};

export type RunCollectResult = { exitCode: 0 | 2; report: CollectReport };

const SOURCES: SourceName[] = ['thenewsapi', 'exa', 'rss', 'webz'];
const KEY_NAMES: Record<keyof CollectKeys, string> = { thenewsapi: 'THENEWSAPI_KEY', exa: 'EXA_API_KEY', webz: 'WEBZ_TOKEN' };

function emptyReport(date: string, now: Date): CollectReport {
  return {
    date,
    generatedAt: now.toISOString(),
    exitCode: 2,
    primary: null,
    articles: 0,
    groups: 0,
    perLang: Object.fromEntries(LANGS.map((l) => [l, { articles: 0, fullTexts: 0, light: true }])) as CollectReport['perLang'],
    sources: Object.fromEntries(SOURCES.map((s) => [s, { used: false, requests: 0, candidates: 0, stoppedBy: null, errors: [] }])) as unknown as CollectReport['sources'],
    budget: {
      thenewsapi: { dailyCap: THENEWSAPI_DAILY_CAP, usedBefore: 0, usedThisRun: 0, perBucket: null },
      exa: { requests: 0, max: null },
      webz: { requests: 0, max: null },
    },
    fulltext: null,
    discardedTexts: 0,
    issues: [],
  };
}

/**
 * `brief:collect` : interroge chaque source indépendamment (une source en échec n'arrête pas les
 * autres), dédoublonne, complète les textes des domaines `full`, puis écrit `out/<date>/raw.json`
 * et `collect-report.json`. Les anciens fichiers sont supprimés d'abord ; le rapport est toujours
 * écrit, sans aucun secret. Code 0 si au moins un article, 2 sinon.
 */
export async function runCollect(opts: RunCollectOptions): Promise<RunCollectResult> {
  const now = opts.now ?? new Date();
  const report = emptyReport(opts.date, now);
  const secrets = [opts.keys.thenewsapi, opts.keys.exa, opts.keys.webz];
  const clean = (m: string) => redactText(m, secrets);
  const issue = (level: CollectIssue['level'], message: string, source?: SourceName) =>
    report.issues.push({ level, ...(source ? { source } : {}), message: clean(message) });

  if (!IsoDateSchema.safeParse(opts.date).success) {
    issue('error', `date incorrecte : « ${opts.date} »`);
    return { exitCode: 2, report };
  }
  const dayDir = join(opts.outDir, opts.date);
  const rawPath = join(dayDir, 'raw.json');
  const reportPath = join(dayDir, 'collect-report.json');
  mkdirSync(dayDir, { recursive: true });
  rmSync(rawPath, { force: true });
  rmSync(reportPath, { force: true });

  let lightThreshold = 15;
  const finish = (articles: RawArticle[] | null): RunCollectResult => {
    const list = articles ?? [];
    report.articles = list.length;
    report.groups = new Set(list.map((a) => a.groupId)).size;
    for (const lang of LANGS) {
      const mine = list.filter((a) => a.lang === lang);
      const fullTexts = mine.filter((a) => a.text !== null).length;
      report.perLang[lang] = { articles: mine.length, fullTexts, light: fullTexts < lightThreshold };
    }
    report.exitCode = list.length > 0 ? 0 : 2;
    if (report.exitCode === 2) rmSync(rawPath, { force: true });
    writeFileSync(reportPath, clean(JSON.stringify(report, null, 2)) + '\n');
    return { exitCode: report.exitCode, report };
  };

  try {
    let config: CollectConfig;
    let ctx: SourceContext;
    let feeds: ReturnType<typeof loadFeeds>;
    try {
      config = loadCollectConfig(opts.configPath);
      const whitelist = loadWhitelist(opts.whitelistPath);
      ctx = {
        fetch: opts.fetch,
        whitelist,
        config,
        rubriques: loadRubriques(opts.rubriquesPath),
        now,
        windowStart: new Date(now.getTime() - config.windowHours * 3_600_000),
      };
      feeds = loadFeeds(opts.feedsPath);
    } catch (e) {
      issue('error', `configuration illisible : ${messageOf(e)}`);
      return finish(null);
    }
    report.primary = config.primary;
    lightThreshold = config.lightThreshold;
    report.budget.exa.max = config.exa.maxRequests;
    report.budget.webz.max = config.webz.maxRequests;

    const runs: Partial<Record<SourceName, SourceRun>> = {};
    const record = (name: SourceName, run: SourceRun) => {
      runs[name] = run;
      report.sources[name] = { used: true, requests: run.requests, candidates: run.candidates.length, stoppedBy: run.stoppedBy, errors: run.errors.map(clean) };
      report.discardedTexts += run.discardedTexts;
      for (const m of run.errors) issue('warning', m, name);
      if (run.undated > 0) issue('warning', `${run.undated} article(s) sans date écarté(s)`, name);
    };
    /** Lance une source ; une exception inattendue est consignée sans arrêter les autres. */
    const guarded = async (name: SourceName, fn: () => Promise<SourceRun>) => {
      try {
        record(name, await fn());
      } catch (e) {
        report.sources[name].used = true;
        issue('error', `${name} : erreur inattendue : ${messageOf(e)}`, name);
      }
    };
    const missing = (k: keyof CollectKeys, what: string) => issue('warning', `${KEY_NAMES[k]} absente : ${what}`, k);

    // 1. Découverte principale (§16 : TheNewsAPI, ou Exa en recherche ouverte).
    if (config.primary === 'thenewsapi') {
      const token = opts.keys.thenewsapi;
      if (token) {
        const ledgerPath = join(opts.outDir, 'thenewsapi-usage.json');
        const day = utcDay(now);
        const before = readDailyUsage(ledgerPath, day, THENEWSAPI_DAILY_CAP);
        if (before.error) issue('error', before.error, 'thenewsapi');
        if (before.warning) issue('warning', before.warning, 'thenewsapi');
        const { total, ...limits } = config.thenewsapi.budget;
        // Chaque requête réservée est inscrite aussitôt au registre : un passage interrompu ne perd pas son compte.
        const onTake = before.error ? undefined : (spent: number) => recordDailyUsage(ledgerPath, day, before.used + spent);
        const budget = new RequestBudget<BudgetBucket>(limits, Math.max(0, Math.min(total, THENEWSAPI_DAILY_CAP - before.used)), onTake);
        report.budget.thenewsapi.usedBefore = before.used;
        try {
          await guarded('thenewsapi', () => collectTheNewsApi(ctx, token, budget));
        } finally {
          report.budget.thenewsapi.usedThisRun = budget.spentTotal;
          report.budget.thenewsapi.perBucket = budget.usage();
          if (!before.error) writeDailyUsage(ledgerPath, day, before.used + budget.spentTotal);
        }
      } else missing('thenewsapi', 'TheNewsAPI ignorée');
    }

    // 2. Exa : domaines full avec texte ; recherche ouverte en plus si Exa est la découverte principale.
    if (opts.keys.exa) {
      const key = opts.keys.exa;
      await guarded('exa', () => collectExa(ctx, key, { broad: config.primary === 'exa' }));
      report.budget.exa.requests = runs.exa?.requests ?? 0;
    } else missing('exa', config.primary === 'exa' ? 'découverte principale (Exa) indisponible' : 'Exa ignorée');

    // 3. Flux RSS des domaines full et feed.
    await guarded('rss', () => collectRss(ctx, feeds));

    // 4. Webz en secours, pour les langues où la découverte principale est sous le seuil.
    const primaryRun = runs[config.primary];
    const below = LANGS.filter((l) => (primaryRun?.candidates.filter((c) => c.article.lang === l).length ?? 0) < config.webz.fallbackBelow);
    if (below.length > 0) {
      if (opts.keys.webz) {
        const token = opts.keys.webz;
        await guarded('webz', () => collectWebz(ctx, token, below));
        report.budget.webz.requests = runs.webz?.requests ?? 0;
      } else missing('webz', `secours indisponible pour ${below.join(', ')}`);
    }

    // 5. Dédoublonnage, textes intégraux (domaines full seulement), dernière garde R1.
    const { kept: candidates, dropped } = applyEditionPerimeter(
      SOURCES.flatMap((s) => runs[s]?.candidates ?? []),
      ctx.whitelist,
    );
    if (dropped > 0) issue('warning', `R2 : ${dropped} article(s) en espagnol d'un média non espagnol (ou de pays inconnu) écarté(s)`);
    let articles = dedupe(candidates, ctx.whitelist);
    const ft = config.fulltext;
    const filled = await fillFullTexts(articles, { whitelist: ctx.whitelist, fetch: opts.fetch, ...ft });
    articles = filled.articles;
    const { errors: ftErrors, ...ftStats } = filled.stats;
    report.fulltext = ftStats;
    if (ftErrors.length > 0) issue('warning', `textes intégraux non lus : ${ftErrors.join(' ; ')}`);
    articles = articles.map((a) => {
      if (a.text === null || canReadFull(ctx.whitelist, a.url)) return a;
      report.discardedTexts++;
      return { ...a, text: null };
    });

    if (articles.length === 0) {
      issue('error', 'aucun article collecté : raw.json non écrit');
      return finish(null);
    }
    const collection = RawCollectionSchema.parse({
      date: opts.date,
      collectedAt: now.toISOString(),
      articles,
      errors: report.issues.filter((i) => i.source).map((i) => ({ source: i.source!, message: i.message })),
    });
    writeFileSync(rawPath, stripSecrets(JSON.stringify(collection, null, 2), secrets) + '\n');
    return finish(collection.articles);
  } catch (e) {
    // Quoi qu'il arrive, le rapport est écrit et aucun raw.json partiel ne reste.
    issue('error', `erreur inattendue : ${messageOf(e)}`);
    return finish(null);
  }
}
