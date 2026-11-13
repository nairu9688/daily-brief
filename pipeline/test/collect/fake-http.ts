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
  /** Corps en flux (`ReadableStream`) par morceaux de 64 octets ; `stall` : après le dernier morceau, attend l'interruption du signal. */
  stream?: boolean | 'stall';
};

export type Call = { url: string; method: string; headers?: Record<string, string>; body?: string; redirect?: string };

/** Faux `fetch` : associe le plus long préfixe d'URL à une réponse (ou à une fonction) et enregistre les appels. */
export function fakeHttp(routes: Record<string, Reply | ((url: string, init?: HttpInit) => Reply)>) {
  const calls: Call[] = [];
  /** URL dont le corps en flux a été annulé par l'appelant. */
  const cancelled: string[] = [];
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
    let body: ReadableStream<Uint8Array> | undefined;
    if (reply.stream) {
      let offset = 0;
      body = new ReadableStream<Uint8Array>({
        async pull(controller) {
          if (offset < bytes.length) {
            controller.enqueue(bytes.slice(offset, offset + 64));
            offset += 64;
            return;
          }
          if (reply.stream === 'stall') {
            await new Promise((_, reject) => {
              if (init?.signal?.aborted) reject(init.signal.reason);
              init?.signal?.addEventListener('abort', () => reject(init.signal!.reason));
            });
          }
          controller.close();
        },
        cancel() {
          cancelled.push(url);
        },
      });
    }
    return {
      ok: status >= 200 && status < 300,
      status,
      headers: { get: (n: string) => headers[n.toLowerCase()] ?? null },
      json: async () => (reply.json !== undefined ? reply.json : JSON.parse(reply.body ?? '')),
      arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer,
      body,
    };
  };
  return { fetch, calls, cancelled };
}
