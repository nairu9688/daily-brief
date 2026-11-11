import { redactUrl } from './redact';

export type HttpResponse = {
  ok: boolean;
  status: number;
  headers: { get(name: string): string | null };
  json(): Promise<unknown>;
  arrayBuffer(): Promise<ArrayBuffer>;
  /** Corps en flux (fetch de Node) : permet d'arrêter la lecture dès que la taille maximale est dépassée. */
  body?: ReadableStream<Uint8Array> | null;
};

export type HttpInit = {
  method?: 'GET' | 'POST';
  headers?: Record<string, string>;
  body?: string;
  signal?: AbortSignal;
  /** `manual` : la redirection est renvoyée telle quelle (statut 3xx et en-tête `location`). */
  redirect?: 'follow' | 'manual';
};

/** Agent des requêtes vers les médias (flux et pages) : identifié, sans aucune donnée personnelle. */
export const USER_AGENT = 'Mozilla/5.0 (compatible; DailyBrief/1.0)';
/** En-têtes Accept tolérants : le type joker final (toute réponse acceptée) évite les 406 de certains serveurs. */
export const ACCEPT_FEED = 'application/rss+xml, application/atom+xml, application/xml;q=0.9, text/xml;q=0.9, */*;q=0.8';
export const ACCEPT_HTML = 'text/html, application/xhtml+xml;q=0.9, */*;q=0.8';

/** Sous-ensemble de `fetch` utilisé par la collecte : injectable dans les tests, aucun appel réseau réel. */
export type HttpFetch = (url: string, init?: HttpInit) => Promise<HttpResponse>;

/** Réponse HTTP en erreur ; le message ne contient que l'URL masquée (jamais de jeton). */
export class HttpError extends Error {
  constructor(
    readonly status: number,
    url: string,
  ) {
    super(`HTTP ${status} (${redactUrl(url)})`);
    this.name = 'HttpError';
  }
}

/** Corps trop lourd ou type de contenu refusé. */
export class BodyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BodyError';
  }
}

/** Message d'une erreur quelconque. */
export const messageOf = (e: unknown): string => (e instanceof Error ? e.message : String(e));

export function isTimeout(e: unknown): boolean {
  return e instanceof Error && (e.name === 'TimeoutError' || e.name === 'AbortError');
}

/** Signal qui expire après `timeoutMs`, ou plus tôt si `parent` est interrompu. */
export function deadline(timeoutMs: number, parent?: AbortSignal): AbortSignal {
  const t = AbortSignal.timeout(timeoutMs);
  return parent ? AbortSignal.any([t, parent]) : t;
}

/** Appel JSON borné dans le temps : lève HttpError si le statut n'est pas 2xx. */
export async function fetchJson(fetch: HttpFetch, url: string, init: HttpInit & { timeoutMs: number }): Promise<unknown> {
  const { timeoutMs, ...rest } = init;
  const signal = deadline(timeoutMs, rest.signal);
  const res = await fetch(url, { ...rest, signal });
  if (!res.ok) throw new HttpError(res.status, url);
  return await res.json();
}

/**
 * Lit un corps d'au plus `maxBytes` octets : en-tête `content-length` d'abord, puis taille réelle.
 * Un corps en flux est lu morceau par morceau et abandonné dès que la limite est dépassée.
 */
export async function readCapped(res: HttpResponse, maxBytes: number): Promise<Buffer> {
  const declared = Number(res.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > maxBytes) throw new BodyError(`corps trop lourd (${declared} octets)`);
  if (res.body) {
    const reader = res.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) {
        await reader.cancel().catch(() => {});
        throw new BodyError(`corps trop lourd (plus de ${maxBytes} octets)`);
      }
      chunks.push(value);
    }
    return Buffer.concat(chunks);
  }
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > maxBytes) throw new BodyError(`corps trop lourd (${buf.length} octets)`);
  return buf;
}

/** Décode un corps texte selon le `charset` de l'en-tête (UTF-8 par défaut ou si le jeu est inconnu). */
export function decodeBody(buf: Buffer, contentType: string | null): string {
  const charset = /charset=["']?([\w-]+)/i.exec(contentType ?? '')?.[1];
  try {
    return new TextDecoder(charset ?? 'utf-8').decode(buf);
  } catch {
    return new TextDecoder('utf-8').decode(buf);
  }
}

/** Type MIME sans paramètres, en minuscules. */
export function mimeOf(res: HttpResponse): string {
  return (res.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
}
