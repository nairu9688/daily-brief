import type { HttpFetch, HttpInit } from '../../collect/http';

export type Reply = {
  status?: number;
  json?: unknown;
  /** Corps texte (HTML, XML) ; encodé en UTF-8. */
  body?: string;
  type?: string | null;
  headers?: Record<string, string>;
  /** Ne répond jamais : seul le signal d'interruption termine l'appel. */
  hang?: boolean;
  /** L'appel lève cette erreur (erreur réseau). */
  error?: Error;
};

export type Call = { url: string; method: string; headers?: Record<string, string>; body?: string; redirect?: string };

/** Faux `fetch` : associe le plus long préfixe d'URL à une réponse (ou à une fonction) et enregistre les appels. */
export function fakeHttp(routes: Record<string, Reply | ((url: string, init?: HttpInit) => Reply)>) {
  const calls: Call[] = [];
  const keys = Object.keys(routes).sort((a, b) => b.length - a.length);
  const fetch: HttpFetch = async (url, init) => {
    calls.push({ url, method: init?.method ?? 'GET', headers: init?.headers, body: init?.body, redirect: init?.redirect });
    const key = keys.find((k) => url.startsWith(k));
    const route = key === undefined ? { status: 404 } : routes[key];
    const reply = typeof route === 'function' ? route(url, init) : route;
    if (reply.hang) {
      await new Promise((_, reject) => {
        if (init?.signal?.aborted) reject(init.signal.reason);
        init?.signal?.addEventListener('abort', () => reject(init.signal!.reason));
      });
    }
    if (reply.error) throw reply.error;
    const status = reply.status ?? 200;
    const bytes = new TextEncoder().encode(reply.body ?? (reply.json === undefined ? '' : JSON.stringify(reply.json)));
    const headers: Record<string, string> = {};
    const type = 'type' in reply ? reply.type : reply.body !== undefined ? 'text/html; charset=utf-8' : 'application/json';
    if (type) headers['content-type'] = type;
    for (const [k, v] of Object.entries(reply.headers ?? {})) headers[k.toLowerCase()] = v;
    return {
      ok: status >= 200 && status < 300,
      status,
      headers: { get: (n: string) => headers[n.toLowerCase()] ?? null },
      json: async () => (reply.json !== undefined ? reply.json : JSON.parse(reply.body ?? '')),
      arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer,
    };
  };
  return { fetch, calls };
}
