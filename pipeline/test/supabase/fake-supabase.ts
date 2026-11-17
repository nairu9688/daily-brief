import type { HttpResponse } from '../../collect/http';
import type { SupabaseFetch, SupabaseInit } from '../../supabase/client';
import { rpc, type TestDb } from './pg';

export const FAKE_URL = 'https://projet-test.supabase.co';
export const FAKE_KEY = 'clé-service-ultra-secrète-123456';

export type FakeCall = { method: string; path: string; headers: Record<string, string>; body?: string | Uint8Array; signal?: AbortSignal };

/** Réponse forcée par un test : statut et corps JSON, appel muet (`hang`) ou erreur réseau. */
export type Forced = { status?: number; json?: unknown; text?: string; hang?: boolean; error?: Error };

export type FakeSupabase = {
  fetch: SupabaseFetch;
  calls: FakeCall[];
  /** Fichiers des buckets, par « bucket/chemin ». */
  files: Map<string, { bytes: Uint8Array; contentType: string }>;
  /** Appelé avant chaque requête : une réponse renvoyée ici remplace le comportement normal. */
  intercept: (call: FakeCall) => Forced | undefined;
};

function reply(status: number, body: Uint8Array | string, contentType = 'application/json'): HttpResponse {
  const bytes = typeof body === 'string' ? new TextEncoder().encode(body) : body;
  const headers: Record<string, string> = { 'content-type': contentType, 'content-length': String(bytes.byteLength) };
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (n) => headers[n.toLowerCase()] ?? null },
    json: async () => JSON.parse(new TextDecoder().decode(bytes)),
    arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer,
    body: null,
  };
}

const json = (status: number, value: unknown) => reply(status, JSON.stringify(value));

/**
 * Faux Supabase, sans réseau. `POST /rest/v1/rpc/<fn>` exécute la vraie fonction SQL des migrations
 * dans PGlite, sous le rôle `service_role` et dans une transaction (comme PostgREST) ; l'API Storage
 * est un dictionnaire en mémoire. Une clé absente ou fausse reçoit 401, comme le vrai service.
 * Sans `db`, toute fonction SQL répond 404.
 */
export function fakeSupabase(db?: TestDb): FakeSupabase {
  const fake: FakeSupabase = {
    calls: [],
    files: new Map(),
    intercept: () => undefined,
    fetch: async (url: string, init?: SupabaseInit) => {
      if (!url.startsWith(`${FAKE_URL}/`)) throw new Error(`appel hors du faux Supabase : ${url}`);
      const path = url.slice(FAKE_URL.length);
      const headers = Object.fromEntries(Object.entries(init?.headers ?? {}).map(([k, v]) => [k.toLowerCase(), v]));
      const call: FakeCall = { method: init?.method ?? 'GET', path, headers, body: init?.body, signal: init?.signal };
      fake.calls.push(call);
      const forced = fake.intercept(call);
      if (forced?.hang) {
        await new Promise((_, reject) => {
          if (init?.signal?.aborted) reject(init.signal.reason);
          init?.signal?.addEventListener('abort', () => reject(init.signal!.reason));
        });
      }
      if (forced?.error) throw forced.error;
      if (forced) return forced.text !== undefined ? reply(forced.status ?? 200, forced.text, 'text/html') : json(forced.status ?? 200, forced.json ?? {});
      if (init?.signal?.aborted) throw init.signal.reason;
      if (headers.apikey !== FAKE_KEY || headers.authorization !== `Bearer ${FAKE_KEY}`) return json(401, { message: 'Invalid API key' });

      const fn = /^\/rest\/v1\/rpc\/([a-z_]+)$/.exec(path)?.[1];
      if (fn && call.method === 'POST') {
        if (!db) return json(404, { code: 'PGRST202', message: `Could not find the function public.${fn}` });
        try {
          return json(200, await rpc(db, fn, JSON.parse(String(init?.body ?? '{}'))));
        } catch (e) {
          const code = (e as { code?: string }).code;
          const status = code === '42501' ? 403 : code === '42883' ? 404 : 400;
          return json(status, { code: code ?? 'XX000', message: (e as Error).message });
        }
      }

      const object = /^\/storage\/v1\/object\/(.+)$/.exec(path)?.[1];
      if (object) {
        const key = object.split('/').map(decodeURIComponent).join('/');
        if (call.method === 'POST') {
          if (!(init?.body instanceof Uint8Array)) return json(400, { message: 'corps binaire attendu' });
          if (fake.files.has(key) && headers['x-upsert'] !== 'true') return json(409, { message: 'The resource already exists' });
          fake.files.set(key, { bytes: new Uint8Array(init.body), contentType: headers['content-type'] ?? '' });
          return json(200, { Key: key });
        }
        if (call.method === 'GET') {
          const file = fake.files.get(key);
          return file ? reply(200, file.bytes, file.contentType) : json(404, { message: 'Object not found' });
        }
        if (call.method === 'DELETE') {
          const { prefixes } = JSON.parse(String(init?.body ?? '{}')) as { prefixes: string[] };
          for (const p of prefixes) fake.files.delete(`${key}/${p}`);
          return json(200, []);
        }
      }
      return json(404, { message: 'route inconnue' });
    },
  };
  return fake;
}
