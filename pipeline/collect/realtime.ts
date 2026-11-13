import { LANGS, type Lang } from '@daily-brief/schema';
import { toIso } from './article';
import { Breaker } from './breaker';
import { messageOf, type HttpFetch } from './http';
import { stripSecrets } from './redact';
import { topNews } from './thenewsapi';
import { readDailyUsage, recordDailyUsage, utcDay } from './usage-ledger';

/** Âge maximal de l'article le plus récent pour juger TheNewsAPI « en temps réel » (spec §16). */
export const REALTIME_MAX_AGE_MINUTES = 120;

/** Plafond dur de TheNewsAPI par jour : budget de 90 de `brief:collect` plus la marge de 10 de cette vérification. */
export const THENEWSAPI_HARD_CAP = 100;
/** Une date publiée plus de 5 min dans le futur n'est pas fiable : elle est ignorée. */
const FUTURE_TOLERANCE_MS = 5 * 60_000;

export type LangFreshness = {
  /** Date de publication la plus récente parmi les articles renvoyés, ou null. */
  newest: string | null;
  /** Âge de cet article en minutes (0 s'il est daté dans le futur), ou null. */
  ageMinutes: number | null;
  articles: number;
  error: string | null;
};

export type RealtimeVerdict = 'thenewsapi' | 'exa' | 'unknown';

export type RealtimeReport = {
  checkedAt: string;
  maxAgeMinutes: number;
  perLang: Record<Lang, LangFreshness>;
  requests: number;
  /** Raison du refus de lancer la vérification (marge quotidienne épuisée), le cas échéant. */
  refused?: string;
  /** thenewsapi : temps réel ; exa : Exa doit devenir la découverte principale ; unknown : vérification impossible. */
  verdict: RealtimeVerdict;
};

/**
 * Vérification §16 : un appel `/v1/news/top` par langue (tri par défaut : date de publication),
 * puis l'âge de l'article le plus récent. Verdict `exa` dès qu'une langue n'a aucun article ou un
 * article le plus récent de plus de 2 h ; `thenewsapi` si les trois langues sont fraîches ;
 * `unknown` si une langue n'a pas pu être vérifiée et qu'aucune n'est en retard. Un 401, 402, 403,
 * 429 ou un délai dépassé arrête les appels suivants. Aucun secret dans le rapport.
 */
export async function checkRealtime(opts: {
  token: string;
  fetch: HttpFetch;
  now?: Date;
  timeoutMs?: number;
  maxAgeMinutes?: number;
  /** Registre quotidien (`out/thenewsapi-usage.json`) : les requêtes y sont inscrites, et la vérification est refusée au-delà de 100 par jour. */
  ledgerPath?: string;
}): Promise<RealtimeReport> {
  const now = opts.now ?? new Date();
  const maxAge = opts.maxAgeMinutes ?? REALTIME_MAX_AGE_MINUTES;
  const breaker = new Breaker();
  const perLang = {} as Record<Lang, LangFreshness>;
  let requests = 0;
  const day = utcDay(now);
  let usedBefore = 0;
  if (opts.ledgerPath) {
    const before = readDailyUsage(opts.ledgerPath, day, THENEWSAPI_HARD_CAP);
    usedBefore = before.used;
    if (before.used + LANGS.length > THENEWSAPI_HARD_CAP) {
      const refused = `marge quotidienne épuisée (${before.used} requêtes déjà utilisées sur ${THENEWSAPI_HARD_CAP})`;
      for (const lang of LANGS) perLang[lang] = { newest: null, ageMinutes: null, articles: 0, error: `non vérifié (${refused})` };
      return { checkedAt: now.toISOString(), maxAgeMinutes: maxAge, perLang, requests: 0, refused, verdict: 'unknown' };
    }
  }
  const stale = new Set<Lang>();
  for (const lang of LANGS) {
    if (breaker.open) {
      perLang[lang] = { newest: null, ageMinutes: null, articles: 0, error: `non vérifié (${breaker.reason})` };
      continue;
    }
    requests++;
    try {
      if (opts.ledgerPath) recordDailyUsage(opts.ledgerPath, day, usedBefore + requests);
      const items = await topNews({ language: lang, limit: 3 }, { token: opts.token, fetch: opts.fetch, timeoutMs: opts.timeoutMs ?? 10_000 });
      const dates = items
        .map((i) => toIso(i.published_at))
        .filter((d): d is string => d !== null && Date.parse(d) - now.getTime() <= FUTURE_TOLERANCE_MS)
        .sort();
      const newest = dates.at(-1) ?? null;
      const ageMs = newest === null ? null : Math.max(0, now.getTime() - Date.parse(newest));
      const ageMinutes = ageMs === null ? null : Math.floor(ageMs / 60_000);
      if (ageMs !== null && ageMs > maxAge * 60_000) stale.add(lang);
      perLang[lang] = { newest, ageMinutes, articles: items.length, error: null };
    } catch (e) {
      breaker.trip(e);
      perLang[lang] = { newest: null, ageMinutes: null, articles: 0, error: stripSecrets(messageOf(e), [opts.token]) };
    }
  }
  const checked = LANGS.map((l) => perLang[l]).filter((f) => f.error === null);
  const late = LANGS.some((l) => perLang[l].error === null && (perLang[l].ageMinutes === null || stale.has(l)));
  const verdict: RealtimeVerdict = late ? 'exa' : checked.length === LANGS.length ? 'thenewsapi' : 'unknown';
  return { checkedAt: now.toISOString(), maxAgeMinutes: maxAge, perLang, requests, verdict };
}

/** Lignes affichées par `npm run check:thenewsapi`, avec la consigne pour `collect.json`. */
export function describeRealtime(r: RealtimeReport, currentPrimary: 'thenewsapi' | 'exa'): string[] {
  const lines = LANGS.map((lang) => {
    const f = r.perLang[lang];
    if (f.error !== null) return `${lang.toUpperCase()} : erreur, ${f.error}`;
    if (f.newest === null) return `${lang.toUpperCase()} : aucun article daté (${f.articles} renvoyés)`;
    return `${lang.toUpperCase()} : article le plus récent publié il y a ${f.ageMinutes} min (${f.newest})`;
  });
  if (r.verdict === 'thenewsapi') {
    lines.push(`Verdict : TheNewsAPI est en temps réel (au plus ${r.maxAgeMinutes} min dans les trois langues).`);
    if (currentPrimary !== 'thenewsapi') lines.push('À faire : remettre "primary": "thenewsapi" dans pipeline/config/collect.json.');
  } else if (r.verdict === 'exa') {
    lines.push(`Verdict : TheNewsAPI n'est pas en temps réel (plus de ${r.maxAgeMinutes} min ou aucun article) : Exa doit devenir la découverte principale (spec §16).`);
    if (currentPrimary !== 'exa') lines.push('À faire : passer "primary": "exa" dans pipeline/config/collect.json.');
  } else {
    lines.push('Verdict : vérification impossible, configuration inchangée. Relance plus tard.');
  }
  if (r.refused) lines.push(`Refusé : ${r.refused}.`);
  lines.push(`Requêtes TheNewsAPI utilisées : ${r.requests} (hors budget quotidien de 90 de brief:collect).`);
  return lines;
}
