import type { FetchLike } from '../../render/http';

type Reply = { status?: number; json?: unknown; body?: Uint8Array; type?: string };

/** Faux `fetch` : associe un préfixe d'URL à une réponse et enregistre les appels. */
export function fakeFetch(routes: Record<string, Reply | (() => never)>) {
  const calls: { url: string; headers?: Record<string, string> }[] = [];
  const fetch: FetchLike = async (url, init) => {
    calls.push({ url, headers: init?.headers });
    const key = Object.keys(routes).find((k) => url.startsWith(k));
    if (!key) return { ok: false, status: 404, headers: { get: () => null }, json: async () => ({}), arrayBuffer: async () => new ArrayBuffer(0) };
    const r = routes[key];
    if (typeof r === 'function') r();
    const reply = r as Reply;
    const status = reply.status ?? 200;
    const body = reply.body ?? new Uint8Array();
    return {
      ok: status < 400,
      status,
      headers: { get: (n: string) => (n.toLowerCase() === 'content-type' ? reply.type ?? 'application/json' : null) },
      json: async () => reply.json,
      arrayBuffer: async () => body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength) as ArrayBuffer,
    };
  };
  return { fetch, calls };
}
