import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { repoPath } from './helpers';

/** Variables jamais transmises aux CLI testés : aucun test ne doit atteindre une vraie API. */
const SECRET_VARS = ['THENEWSAPI_KEY', 'EXA_API_KEY', 'WEBZ_TOKEN', 'PEXELS_API_KEY', 'SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY'];

/**
 * Lance un script TypeScript du dépôt avec tsx, depuis un dossier vide (aucun `.env` n'y est lu)
 * et sans les variables secrètes ; `env` en ajoute d'autres. `files` crée des fichiers dans ce dossier (un `.env`, par exemple) ;
 * `preload` est un module du dépôt chargé avant le script (un faux `fetch`, par exemple).
 */
export function runCli(script: string, args: string[], env: Record<string, string> = {}, opts: { files?: Record<string, string>; preload?: string } = {}): { status: number | null; stdout: string; stderr: string; cwd: string } {
  const cwd = mkdtempSync(join(tmpdir(), 'cli-'));
  for (const [name, text] of Object.entries(opts.files ?? {})) writeFileSync(join(cwd, name), text);
  const base = { ...process.env };
  for (const k of SECRET_VARS) delete base[k];
  const r = spawnSync(process.execPath, ['--import', repoPath('node_modules/tsx/dist/loader.mjs'), ...(opts.preload ? ['--import', repoPath(opts.preload)] : []), repoPath(script), ...args], {
    cwd,
    env: { ...base, ...env },
    encoding: 'utf8',
    timeout: 30_000,
  });
  return { status: r.status, stdout: r.stdout, stderr: r.stderr, cwd };
}
