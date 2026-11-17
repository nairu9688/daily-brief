import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { loadCodeGs } from '../apps-script/fake-google';

export const DRIVE_TOKEN = 'jeton-drive-de-test-0123456789-abcdef';

export type ServerMode =
  | 'ok'
  /** Répond 200 directement, sans redirection. */
  | 'direct'
  /** Page HTML d'erreur d'Apps Script (HTTP 200). */
  | 'html'
  /** Redirection vers la connexion Google : application non publique. */
  | 'login'
  /** Redirections sans fin. */
  | 'loop'
  | 'http-500'
  /** Ne répond jamais. */
  | 'hang'
  /** Répond `{ ok: true, ids: {} }` : l'id du fichier manque. */
  | 'no-id'
  /** Réponse JSON d'une autre forme. */
  | 'odd';

export type Hit = { method: string; path: string; body: string };

/**
 * Faux Apps Script sur 127.0.0.1 : `POST /macros/s/test/exec` exécute le vrai `Code.gs` (faux
 * Drive en mémoire) puis répond 302 vers `/macros/echo?user_content_key=…`, que le client doit lire
 * par GET — le comportement d'une application web Apps Script. Aucun appel hors de la machine.
 */
export async function startAppsScript(token: string = DRIVE_TOKEN) {
  const google = loadCodeGs({ TOKEN: token });
  const hits: Hit[] = [];
  const pending = new Map<string, string>();
  const state = { mode: 'ok' as ServerMode, seq: 0 };
  const hanging = new Set<import('node:http').ServerResponse>();

  const server: Server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      const body = Buffer.concat(chunks).toString('utf8');
      const path = req.url ?? '';
      hits.push({ method: req.method ?? '', path, body });
      const send = (status: number, text: string, headers: Record<string, string> = {}) => {
        res.writeHead(status, { 'content-type': 'application/json', ...headers });
        res.end(text);
      };
      if (state.mode === 'hang') {
        hanging.add(res);
        return;
      }
      if (state.mode === 'http-500') return send(500, 'erreur interne');
      if (state.mode === 'loop') return send(302, '', { location: `/macros/echo?user_content_key=k${++state.seq}` });
      if (req.method === 'POST' && path === '/macros/s/test/exec') {
        if (state.mode === 'login') return send(302, '', { location: 'https://accounts.google.com/ServiceLogin?continue=x' });
        if (state.mode === 'html') return send(200, '<!DOCTYPE html><html><body>TypeError: jeton interne</body></html>', { 'content-type': 'text/html' });
        const out = state.mode === 'no-id' ? '{"ok":true,"ids":{}}' : state.mode === 'odd' ? '{"status":"fine"}' : google.gs.doPost({ postData: { contents: body } }).text;
        if (state.mode === 'direct') return send(200, out);
        const key = `k${++state.seq}`;
        pending.set(key, out);
        return send(302, '', { location: `/macros/echo?user_content_key=${key}` });
      }
      const key = /^\/macros\/echo\?user_content_key=(k\d+)$/.exec(path)?.[1];
      if (req.method === 'GET' && key && pending.has(key)) return send(200, pending.get(key)!);
      return send(404, 'introuvable');
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const host = `127.0.0.1:${(server.address() as AddressInfo).port}`;
  return {
    google,
    hits,
    state,
    host,
    url: `http://${host}/macros/s/test/exec`,
    close: async () => {
      for (const r of hanging) r.destroy();
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
    },
  };
}
