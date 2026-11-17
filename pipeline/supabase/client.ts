import { z } from 'zod';
import { Breaker } from '../collect/breaker';
import { deadline, HttpError, messageOf, readCapped, type HttpResponse } from '../collect/http';
import { stripSecrets } from '../lib/redact';
import type { SupabaseConfig } from './config';

/** Requête vers Supabase : comme `HttpInit`, avec DELETE et un corps binaire (envoi de fichiers). */
export type SupabaseInit = {
  method?: 'GET' | 'POST' | 'DELETE';
  headers?: Record<string, string>;
  body?: string | Uint8Array;
  signal?: AbortSignal;
};

/** Sous-ensemble de `fetch` utilisé pour Supabase : injectable dans les tests, aucun appel réseau réel. */
export type SupabaseFetch = (url: string, init?: SupabaseInit) => Promise<HttpResponse>;

/** Réponse en erreur de PostgREST ou de Storage. Le message ne contient ni clé ni corps de requête. */
export class SupabaseError extends HttpError {
  constructor(
    status: number,
    readonly what: string,
    readonly code?: string,
    detail?: string,
  ) {
    super(status, '');
    this.name = 'SupabaseError';
    this.message = `${what} : HTTP ${status}${code ? ` ${code}` : ''}${detail ? ` — ${detail}` : ''}`;
  }
}

/** Supabase n'est plus appelé pendant le reste du passage (voir `Breaker`). */
export class SupabaseDownError extends Error {
  constructor(reason: string) {
    super(`Supabase coupé (${reason})`);
    this.name = 'SupabaseDownError';
  }
}

export type CallOptions = { signal?: AbortSignal; timeoutMs?: number };

export type SupabaseClient = {
  /** Appelle une fonction SQL (`POST /rest/v1/rpc/<fn>`) et valide sa réponse. */
  rpc<T>(fn: string, args: Record<string, unknown>, schema: z.ZodType<T>, opts?: CallOptions): Promise<T>;
  /** Dépose (ou remplace) un fichier dans un bucket. */
  upload(bucket: string, path: string, bytes: Uint8Array, contentType: string, opts?: CallOptions): Promise<void>;
  /** Lit un fichier d'un bucket ; `null` s'il n'existe pas. */
  download(bucket: string, path: string, opts?: CallOptions): Promise<Buffer | null>;
  /** Supprime des fichiers d'un bucket (les fichiers absents sont ignorés). */
  remove(bucket: string, paths: string[], opts?: CallOptions): Promise<void>;
  readonly breaker: Breaker;
};

export const RPC_TIMEOUT_MS = 30_000;
export const STORAGE_TIMEOUT_MS = 120_000;
/** Taille maximale d'une réponse de fonction SQL (octets). */
export const MAX_RPC_BYTES = 5_000_000;
/** Taille maximale d'un fichier envoyé ou relu (octets) : limite du plan gratuit de Supabase Storage. */
export const MAX_FILE_BYTES = 50 * 1024 * 1024;

/** 401/403 : clé refusée ; 402 : quota ; 429 : trop de requêtes (mêmes statuts que `Breaker`). */
const FATAL_STATUS = new Set([401, 402, 403, 429]);

/** Réponse 2xx illisible ou d'une forme inattendue : erreur de données, pas de santé du service. */
class ResponseError extends Error {}

const ErrorBody = z.object({ code: z.string().optional(), message: z.string().optional(), error: z.string().optional() });
const NAME = /^[a-z][a-z0-9_]*$/;
/** Segment de chemin sûr : pas de « .. », pas de barre oblique, caractères simples seulement. */
const SEGMENT = /^(?!\.+$)[A-Za-z0-9._-]+$/;

/** Chemin d'objet `<bucket>/<a>/<b>` encodé, ou erreur si un segment est douteux. */
export function objectPath(bucket: string, path: string): string {
  const segments = [bucket, ...path.split('/')];
  for (const s of segments) if (!SEGMENT.test(s)) throw new Error(`chemin de stockage refusé : « ${bucket}/${path} »`);
  return segments.map(encodeURIComponent).join('/');
}

/**
 * Client Supabase minimal sur `fetch` : fonctions SQL par PostgREST et fichiers par l'API Storage.
 * Chaque appel est borné dans le temps, interruptible par un signal, et passe par un disjoncteur :
 * après un 401, 402, 403, 429, un délai dépassé ou trois échecs de suite, plus aucun appel ne part.
 */
export function createSupabaseClient(config: SupabaseConfig, fetch: SupabaseFetch, base: { signal?: AbortSignal } = {}): SupabaseClient {
  const breaker = new Breaker();
  const clean = (m: string) => stripSecrets(m, [config.serviceKey]);
  const auth = { apikey: config.serviceKey, authorization: `Bearer ${config.serviceKey}` };

  /**
   * Un appel : en-têtes d'authentification, délai, disjoncteur. `read` lit le corps sous le même
   * délai. Une erreur SQL ou de données (4xx hors 401, 402, 403 et 429) ne compte pas pour le
   * disjoncteur : elle ne dit rien de la santé de Supabase.
   */
  async function call<T>(what: string, url: string, init: SupabaseInit, opts: CallOptions | undefined, defaultTimeout: number, read: (res: HttpResponse) => Promise<T>, okStatuses: number[] = []): Promise<T> {
    if (breaker.open) throw new SupabaseDownError(breaker.reason!);
    const parents = [base.signal, opts?.signal].filter((s): s is AbortSignal => !!s);
    const signal = deadline(opts?.timeoutMs ?? defaultTimeout, parents.length ? AbortSignal.any(parents) : undefined);
    try {
      const res = await fetch(url, { ...init, headers: { ...auth, ...init.headers }, signal });
      if (!res.ok && !okStatuses.includes(res.status)) {
        let code: string | undefined;
        let detail: string | undefined;
        try {
          const body = ErrorBody.parse(JSON.parse(new TextDecoder().decode(await readCapped(res, 10_000))));
          code = body.code;
          detail = (body.message ?? body.error)?.slice(0, 200);
        } catch {
          await res.body?.cancel().catch(() => {});
        }
        throw new SupabaseError(res.status, what, code, detail && clean(detail));
      }
      const out = await read(res);
      breaker.success();
      return out;
    } catch (e) {
      if (e instanceof ResponseError) throw new Error(`${what} : ${e.message}`);
      if (e instanceof SupabaseError) {
        if (e.status >= 500 || FATAL_STATUS.has(e.status)) breaker.trip(e);
        throw e;
      }
      breaker.trip(e);
      const err = new Error(`${what} : ${clean(messageOf(e))}`);
      if (e instanceof Error) err.name = e.name; // « TimeoutError » reste reconnaissable
      throw err;
    }
  }

  const discard = async (res: HttpResponse) => {
    await res.body?.cancel().catch(() => {});
  };

  return {
    breaker,

    async rpc(fn, args, schema, opts) {
      if (!NAME.test(fn)) throw new Error(`nom de fonction refusé : « ${fn} »`);
      const init: SupabaseInit = { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json' }, body: JSON.stringify(args) };
      return call(`Supabase ${fn}`, `${config.url}/rest/v1/rpc/${fn}`, init, opts, RPC_TIMEOUT_MS, async (res) => {
        const text = new TextDecoder().decode(await readCapped(res, MAX_RPC_BYTES));
        let data: unknown;
        try {
          data = JSON.parse(text);
        } catch {
          throw new ResponseError('réponse non JSON');
        }
        const parsed = schema.safeParse(data);
        if (!parsed.success) throw new ResponseError(`réponse inattendue (${parsed.error.issues.length} champs invalides)`);
        return parsed.data;
      });
    },

    async upload(bucket, path, bytes, contentType, opts) {
      const target = objectPath(bucket, path);
      if (bytes.byteLength === 0) throw new Error(`Supabase Storage (envoi ${bucket}/${path}) : fichier vide`);
      if (bytes.byteLength > MAX_FILE_BYTES) throw new Error(`Supabase Storage (envoi ${bucket}/${path}) : fichier trop lourd (${bytes.byteLength} octets)`);
      const init: SupabaseInit = { method: 'POST', headers: { 'content-type': contentType, 'x-upsert': 'true' }, body: bytes };
      await call(`Supabase Storage (envoi ${bucket}/${path})`, `${config.url}/storage/v1/object/${target}`, init, opts, STORAGE_TIMEOUT_MS, discard);
    },

    async download(bucket, path, opts) {
      // Storage répond 400 ou 404 pour un objet absent, selon la version.
      return call(
        `Supabase Storage (lecture ${bucket}/${path})`,
        `${config.url}/storage/v1/object/${objectPath(bucket, path)}`,
        { method: 'GET' },
        opts,
        STORAGE_TIMEOUT_MS,
        async (res) => {
          if (!res.ok) {
            await discard(res);
            return null;
          }
          return readCapped(res, MAX_FILE_BYTES);
        },
        [400, 404],
      );
    },

    async remove(bucket, paths, opts) {
      if (paths.length === 0) return;
      for (const p of paths) objectPath(bucket, p);
      const init: SupabaseInit = { method: 'DELETE', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ prefixes: paths }) };
      await call(`Supabase Storage (suppression dans ${bucket})`, `${config.url}/storage/v1/object/${encodeURIComponent(bucket)}`, init, opts, STORAGE_TIMEOUT_MS, discard);
    },
  };
}
