/**
 * Configuration lue dans l'environnement du serveur. Rien ici n'est secret : l'URL du projet et la
 * clé publique sont publiques par nature, ALLOWED_EMAIL ne protège rien à lui seul (c'est la RLS qui
 * protège les données : contenu public, runs et écritures réservés à l'adresse autorisée). Ce module refuse en revanche toute clé de service : l'appli ne doit jamais
 * contourner la RLS, même mal configurée.
 */

type Env = Record<string, string | undefined>;

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigError';
  }
}

/** Date de la fixture : en mode fixture, « aujourd'hui » vaut cette date sauf FIXTURE_TODAY. */
export const FIXTURE_DATE = '2026-11-06';

/**
 * FIXTURE=1 : l'appli lit fixtures/ au lieu de Supabase, sans connexion. Interdit sur Vercel
 * (variable VERCEL présente au build comme à l'exécution) : ce mode ouvre tout sans authentification.
 * Interdit aussi en production (`next start`), sauf accord explicite FIXTURE_ALLOW_START=1, que seuls
 * les tests de bout en bout posent (playwright.config.ts).
 */
export function fixtureMode(env: Env = process.env): boolean {
  if (env.FIXTURE !== '1') return false;
  if (env.VERCEL) throw new ConfigError('FIXTURE=1 est interdit sur Vercel : ce mode désactive la connexion.');
  if (env.NODE_ENV === 'production' && env.FIXTURE_ALLOW_START !== '1') {
    throw new ConfigError('FIXTURE=1 est interdit en production : ce mode désactive la connexion (FIXTURE_ALLOW_START=1 pour les tests de bout en bout).');
  }
  return true;
}

/**
 * FIXTURE_VISITOR=1 (mode fixture seulement) : simule un visiteur sans session, pour vérifier la
 * lecture publique (pas d'actions personnelles, Santé renvoyée vers /login) sans Supabase.
 */
export function fixtureVisitor(env: Env = process.env): boolean {
  return fixtureMode(env) && env.FIXTURE_VISITOR === '1';
}

/** « Aujourd'hui » du mode fixture : FIXTURE_TODAY (AAAA-MM-JJ) ou la date de la fixture. */
export function fixtureToday(env: Env = process.env): string {
  const v = env.FIXTURE_TODAY;
  return v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : FIXTURE_DATE;
}

export type SupabaseConfig = { url: string; anonKey: string; origin: string };

/** Charge utile d'un JWT, ou null si la chaîne n'en est pas un. */
function jwtPayload(token: string): Record<string, unknown> | null {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  try {
    const json = Buffer.from(parts[1].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
    const v: unknown = JSON.parse(json);
    return v && typeof v === 'object' ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** Vrai si la clé est une clé de service (JWT `role: service_role` ou clé secrète `sb_secret_…`). */
export function isServiceKey(key: string): boolean {
  if (key.startsWith('sb_secret_')) return true;
  return jwtPayload(key)?.role === 'service_role';
}

/**
 * URL et clé publique du projet (NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY). L'URL est en
 * https (http seulement pour un Supabase local sur 127.0.0.1 ou localhost). Une clé de service est refusée.
 */
export function supabaseConfig(env: Env = process.env): SupabaseConfig {
  const rawUrl = env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const anonKey = env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();
  if (!rawUrl || !anonKey) throw new ConfigError('NEXT_PUBLIC_SUPABASE_URL et NEXT_PUBLIC_SUPABASE_ANON_KEY sont requises (ou FIXTURE=1 en local).');
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new ConfigError('NEXT_PUBLIC_SUPABASE_URL n’est pas une URL.');
  }
  const local = url.hostname === '127.0.0.1' || url.hostname === 'localhost';
  if (url.protocol !== 'https:' && !(local && url.protocol === 'http:')) throw new ConfigError('NEXT_PUBLIC_SUPABASE_URL doit être en https.');
  if (url.username || url.password) throw new ConfigError('NEXT_PUBLIC_SUPABASE_URL ne doit pas contenir d’identifiants.');
  if (isServiceKey(anonKey)) throw new ConfigError('NEXT_PUBLIC_SUPABASE_ANON_KEY est une clé de service : utiliser la clé publique (anon ou sb_publishable_…).');
  return { url: url.origin, anonKey, origin: url.origin };
}

const normalize = (email: string) => email.trim().toLowerCase();

/** Email autorisé (ALLOWED_EMAIL), normalisé ; null si absent ou vide : personne n'est autorisé. */
export function allowedEmail(env: Env = process.env): string | null {
  const v = env.ALLOWED_EMAIL ? normalize(env.ALLOWED_EMAIL) : '';
  return v === '' ? null : v;
}

/** Même règle que private.is_allowed_user() : sans casse ni espaces, et jamais un email vide. */
export function isAllowedEmail(email: string | null | undefined, env: Env = process.env): boolean {
  const allowed = allowedEmail(env);
  return allowed !== null && typeof email === 'string' && normalize(email) === allowed;
}

/**
 * Origine du site pour le lien du courriel : SITE_URL (https) en production. Sans SITE_URL, seule une
 * origine locale (localhost, 127.0.0.1) est acceptée : un en-tête Host forgé ne choisit jamais la
 * destination du lien magique (Supabase la vérifie aussi contre sa liste « Redirect URLs »).
 */
export function siteOrigin(requestOrigin: string | null, env: Env = process.env): string | null {
  const configured = env.SITE_URL?.trim();
  if (configured) {
    try {
      const u = new URL(configured);
      return u.protocol === 'https:' && !u.username && !u.password ? u.origin : null;
    } catch {
      return null;
    }
  }
  if (!requestOrigin) return null;
  try {
    const u = new URL(requestOrigin);
    return u.hostname === 'localhost' || u.hostname === '127.0.0.1' ? u.origin : null;
  } catch {
    return null;
  }
}
