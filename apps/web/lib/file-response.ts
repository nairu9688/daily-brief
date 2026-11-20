import 'server-only';
import type { FileTarget } from './data/types';

/**
 * Réponse d'une route de fichier : redirection 307 vers l'URL signée (jamais mise en cache, jamais
 * transmise en Referer) ou octets servis directement (mode fixture).
 */
export function fileResponse(target: FileTarget | null): Response {
  const base = { 'Cache-Control': 'private, no-store', 'Referrer-Policy': 'no-referrer' };
  if (!target) return new Response('Fichier introuvable', { status: 404, headers: base });
  if (target.kind === 'redirect') return new Response(null, { status: 307, headers: { ...base, Location: target.url } });
  return new Response(target.body as BodyInit, { status: 200, headers: { ...base, 'Content-Type': target.contentType, 'Content-Length': String(target.body.byteLength) } });
}
