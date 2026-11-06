import type { FetchLike } from '../../render/http';

type Reply = { status?: number; json?: unknown; body?: Uint8Array; type?: string | null; length?: string; hang?: boolean };

/** Faux `fetch` : associe un préfixe d'URL à une réponse et enregistre les appels. */
export function fakeFetch(routes: Record<string, Reply | (() => never)>) {
  const calls: { url: string; headers?: Record<string, string> }[] = [];
  const fetch: FetchLike = async (url, init) => {
    calls.push({ url, headers: init?.headers });
    const hangKey = Object.keys(routes).find((k) => url.startsWith(k));
    if (hangKey && (routes[hangKey] as Reply).hang) {
      await new Promise((_, reject) => {
        if (init?.signal?.aborted) reject(init.signal.reason);
        init?.signal?.addEventListener('abort', () => reject(init.signal!.reason));
      });
    }
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
      headers: {
        get: (n: string) => {
          const k = n.toLowerCase();
          return k === 'content-type' ? ('type' in reply ? (reply.type ?? null) : 'application/json') : k === 'content-length' ? (reply.length ?? null) : null;
        },
      },
      json: async () => reply.json,
      arrayBuffer: async () => body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength) as ArrayBuffer,
    };
  };
  return { fetch, calls };
}
