import { z } from 'zod';
import { Breaker } from '../collect/breaker';
import { BodyError, deadline, HttpError, isTimeout, messageOf, readCapped, type HttpFetch, type HttpResponse } from '../collect/http';
import { stripSecrets } from '../lib/redact';
import type { DayFile } from './files';

export type DriveConfig = { url: string; token: string };

export const MISSING_DRIVE = 'APPS_SCRIPT_URL ou APPS_SCRIPT_TOKEN absente';
/** Le jeton est comparé par Code.gs, qui refuse tout jeton de moins de 32 caractères. */
export const MIN_TOKEN_LENGTH = 32;
/** Hôtes d'Apps Script : l'application web, puis l'hôte vers lequel elle redirige la réponse. */
export const APPS_SCRIPT_HOSTS = ['script.google.com', 'script.googleusercontent.com'];
/** Délai d'un dépôt (octets envoyés, exécution du script, lecture de la réponse). */
export const DRIVE_TIMEOUT_MS = 180_000;
/** Taille maximale d'un fichier envoyé : 30 Mo, soit 40 Mo en base64 (limite contrôlée aussi par Code.gs). */
export const MAX_DRIVE_BYTES = 30 * 1024 * 1024;
const MAX_REDIRECTS = 3;
const MAX_RESPONSE_BYTES = 64_000;

/**
 * Configuration du dépôt Drive tirée de l'environnement. L'URL doit être celle d'une application
 * web Apps Script (`https://script.google.com/macros/s/<id>/exec`) : le jeton n'est envoyé qu'à Google.
 */
export function driveConfig(env: Record<string, string | undefined>, hosts: string[] = APPS_SCRIPT_HOSTS): { ok: true; config: DriveConfig } | { ok: false; error: string } {
  const url = env.APPS_SCRIPT_URL?.trim();
  const token = env.APPS_SCRIPT_TOKEN?.trim();
  if (!url || !token) return { ok: false, error: MISSING_DRIVE };
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { ok: false, error: 'APPS_SCRIPT_URL invalide : URL attendue (https://script.google.com/macros/s/…/exec)' };
  }
  if (!allowed(parsed, hosts) || parsed.username || parsed.password) return { ok: false, error: 'APPS_SCRIPT_URL invalide : application web Apps Script attendue (https://script.google.com/macros/s/…/exec)' };
  if (token.length < MIN_TOKEN_LENGTH) return { ok: false, error: `APPS_SCRIPT_TOKEN trop court : ${MIN_TOKEN_LENGTH} caractères au moins` };
  return { ok: true, config: { url: parsed.href, token } };
}

/** https vers un hôte permis ; http n'est accepté que vers la machine locale (tests). */
function allowed(u: URL, hosts: string[]): boolean {
  if (!hosts.includes(u.host)) return false;
  return u.protocol === 'https:' || (u.protocol === 'http:' && (u.hostname === '127.0.0.1' || u.hostname === 'localhost'));
}

const ResponseSchema = z.union([z.object({ ok: z.literal(true), ids: z.record(z.string(), z.string().min(1)) }), z.object({ ok: z.literal(false), error: z.string() })]);

/** Erreur du dépôt Drive. `fatal` : inutile de réessayer pendant ce passage (jeton refusé). */
export class DriveError extends Error {
  constructor(
    message: string,
    readonly fatal = false,
  ) {
    super(message);
    this.name = 'DriveError';
  }
}

export type DriveClient = {
  /** Dépose un fichier dans « Daily Brief/AAAA/MM - Mois » ; renvoie son id Drive. */
  send(date: string, file: DayFile, bytes: Uint8Array, opts?: { signal?: AbortSignal }): Promise<string>;
  readonly breaker: Breaker;
};

export type DriveOptions = { timeoutMs?: number; signal?: AbortSignal; /** Hôtes permis pour l'URL et ses redirections (tests : serveur local). */ hosts?: string[] };

/**
 * Client de l'application web Apps Script (spec §10). Un fichier par requête : chaque envoi reste
 * loin des limites d'Apps Script (6 minutes par exécution) et un échec n'emporte pas les autres.
 * Le POST reçoit une redirection 302 vers script.googleusercontent.com, suivie à la main par un GET :
 * chaque saut est contrôlé (hôte Google en https) et le jeton n'est jamais renvoyé après le POST.
 * Aucun message d'erreur ne contient l'URL de l'application ni le jeton.
 */
export function createDriveClient(config: DriveConfig, fetch: HttpFetch, options: DriveOptions = {}): DriveClient {
  const breaker = new Breaker();
  const hosts = options.hosts ?? APPS_SCRIPT_HOSTS;
  const clean = (m: string) => stripSecrets(m, [config.token, config.url]);

  async function exchange(body: string, signal: AbortSignal): Promise<unknown> {
    let res: HttpResponse = await fetch(config.url, { method: 'POST', headers: { 'content-type': 'application/json' }, body, signal, redirect: 'manual' });
    for (let hop = 0; res.status >= 300 && res.status < 400; hop++) {
      await res.body?.cancel().catch(() => {});
      if (hop >= MAX_REDIRECTS) throw new DriveError('trop de redirections');
      let next: URL;
      try {
        next = new URL(res.headers.get('location') ?? '', config.url);
      } catch {
        throw new DriveError('redirection sans adresse');
      }
      // Une redirection vers la connexion Google signifie que l'application n'est pas publique.
      if (!allowed(next, hosts)) throw new DriveError(`redirection hors d’Apps Script (${next.host}) : l’application web doit être déployée avec l’accès « Tout le monde »`, true);
      res = await fetch(next.href, { method: 'GET', signal, redirect: 'manual' });
    }
    if (!res.ok) {
      await res.body?.cancel().catch(() => {});
      throw new HttpError(res.status, '');
    }
    const text = new TextDecoder().decode(await readCapped(res, MAX_RESPONSE_BYTES));
    try {
      return JSON.parse(text);
    } catch {
      throw new DriveError('réponse non JSON (page d’erreur d’Apps Script ?)');
    }
  }

  return {
    breaker,
    async send(date, file, bytes, opts) {
      if (breaker.open) throw new DriveError(`Drive coupé (${breaker.reason})`, true);
      if (bytes.byteLength === 0) throw new DriveError(`${file.name} : fichier vide`);
      if (bytes.byteLength > MAX_DRIVE_BYTES) throw new DriveError(`${file.name} : trop lourd pour Apps Script (${bytes.byteLength} octets, ${MAX_DRIVE_BYTES} au plus)`);
      const parents = [options.signal, opts?.signal].filter((s): s is AbortSignal => !!s);
      const signal = deadline(options.timeoutMs ?? DRIVE_TIMEOUT_MS, parents.length ? AbortSignal.any(parents) : undefined);
      const body = JSON.stringify({ token: config.token, date, files: [{ name: file.name, mimeType: file.mimeType, base64: Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString('base64') }] });
      try {
        const parsed = ResponseSchema.safeParse(await exchange(body, signal));
        if (!parsed.success) throw new DriveError('réponse inattendue');
        if (!parsed.data.ok) throw new DriveError(`refus d’Apps Script (${parsed.data.error.slice(0, 40)})`, parsed.data.error === 'unauthorized');
        const id = parsed.data.ids[file.name];
        if (!id) throw new DriveError('réponse sans l’id du fichier envoyé');
        breaker.success();
        return id;
      } catch (e) {
        if (e instanceof DriveError && e.fatal) breaker.reason = e.message.startsWith('refus') ? 'jeton refusé' : 'application web non publique';
        else breaker.trip(e);
        if (e instanceof DriveError) throw new DriveError(clean(`Drive ${file.name} : ${e.message}`), e.fatal);
        const what = e instanceof HttpError ? `HTTP ${e.status}` : isTimeout(e) ? 'délai dépassé' : e instanceof BodyError ? e.message : messageOf(e);
        throw new DriveError(clean(`Drive ${file.name} : ${what}`));
      }
    },
  };
}
