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
const causeCode = (e: unknown): string | undefined => {
  const code = (e as { cause?: { code?: unknown } } | null)?.cause?.code;
  return typeof code === 'string' ? code : undefined;
};

/** Message d'une erreur quelconque ; le code de la cause réseau s'y ajoute (« fetch failed (ECONNREFUSED) »). */
export const messageOf = (e: unknown): string => {
  if (!(e instanceof Error)) return String(e);
  const code = causeCode(e);
  return code ? `${e.message} (${code})` : e.message;
};

const UNDICI_TIMEOUTS = new Set(['UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_HEADERS_TIMEOUT', 'UND_ERR_BODY_TIMEOUT']);

export function isTimeout(e: unknown): boolean {
  if (!(e instanceof Error)) return false;
  if (e.name === 'TimeoutError' || e.name === 'AbortError') return true;
  const code = causeCode(e);
  return code !== undefined && UNDICI_TIMEOUTS.has(code);
}

/** Signal qui expire après `timeoutMs`, ou plus tôt si `parent` est interrompu. */
export function deadline(timeoutMs: number, parent?: AbortSignal): AbortSignal {
  const t = AbortSignal.timeout(timeoutMs);
  return parent ? AbortSignal.any([t, parent]) : t;
}

/** Taille maximale par défaut d'une réponse JSON d'API (octets). */
export const MAX_JSON_BYTES = 5_000_000;

/**
 * Appel JSON borné dans le temps et en taille : lève HttpError si le statut n'est pas 2xx, BodyError
 * si le corps dépasse `maxBytes` (lecture par `readCapped`, jamais de `res.json()` non borné).
 */
export async function fetchJson(fetch: HttpFetch, url: string, init: HttpInit & { timeoutMs: number; maxBytes?: number }): Promise<unknown> {
  const { timeoutMs, maxBytes = MAX_JSON_BYTES, ...rest } = init;
  const signal = deadline(timeoutMs, rest.signal);
  const res = await fetch(url, { ...rest, signal });
  if (!res.ok) {
    await res.body?.cancel().catch(() => {});
    throw new HttpError(res.status, url);
  }
  return JSON.parse(new TextDecoder().decode(await readCapped(res, maxBytes)));
}

/**
 * Lit un corps d'au plus `maxBytes` octets : en-tête `content-length` d'abord, puis taille réelle.
 * Un corps en flux est lu morceau par morceau et abandonné dès que la limite est dépassée.
 */
export async function readCapped(res: HttpResponse, maxBytes: number): Promise<Buffer> {
  const declared = Number(res.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > maxBytes) {
    await res.body?.cancel().catch(() => {});
    throw new BodyError(`corps trop lourd (${declared} octets)`);
  }
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

/**
 * Décode un corps texte. Un BOM UTF-8 l'emporte ; sinon le `charset` de l'en-tête ; sinon la déclaration
 * `<?xml encoding>` ou `<meta charset>` / `http-equiv` des 1024 premiers octets ; sinon UTF-8 (aussi si le jeu est inconnu).
 */
export function decodeBody(buf: Buffer, contentType: string | null): string {
  const bom = buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf;
  const head = buf.subarray(0, 1024).toString('latin1');
  const sniffed = /<\?xml[^>]*?encoding=["']([\w-]+)["']/i.exec(head)?.[1] ?? /<meta[^>]*?charset=["']?([\w-]+)/i.exec(head)?.[1];
  // Un « utf-16 » lu dans le contenu ne peut pas être vrai (le contenu est lu en octets ASCII) : WHATWG le lit comme utf-8.
  const fromContent = sniffed && /^utf-?16/i.test(sniffed) ? 'utf-8' : sniffed;
  const charset = bom
    ? 'utf-8'
    : buf[0] === 0xff && buf[1] === 0xfe
      ? 'utf-16le'
      : buf[0] === 0xfe && buf[1] === 0xff
        ? 'utf-16be'
        : (/charset=["']?([\w-]+)/i.exec(contentType ?? '')?.[1] ?? fromContent);
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
