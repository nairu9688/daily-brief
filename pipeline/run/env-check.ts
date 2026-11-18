import { existsSync, readFileSync, statSync } from 'node:fs';
import { parseEnv } from 'node:util';

/** Variables sans lesquelles `brief:context` et `brief:publish` sortent avec le code 2. */
export const REQUIRED_ENV = ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY'] as const;
/** Variables dont l'absence dégrade le brief (source, photos, audio ou Drive coupés), sans le bloquer. */
export const OPTIONAL_ENV = ['THENEWSAPI_KEY', 'EXA_API_KEY', 'WEBZ_TOKEN', 'PEXELS_API_KEY', 'GOOGLE_TTS_API_KEY', 'APPS_SCRIPT_URL', 'APPS_SCRIPT_TOKEN'] as const;
const KNOWN = new Set<string>([...REQUIRED_ENV, ...OPTIONAL_ENV, 'FFMPEG_PATH']);

export type EnvCheck = {
  exitCode: 0 | 2;
  /** Une ligne par variable : nom et état, jamais la valeur. */
  lines: string[];
};

/**
 * `npm run env:check` : contrôle le `.env` écrit par la routine (pipeline/run/env-from-vault.md)
 * sans jamais afficher une valeur. Code 0 si les variables obligatoires sont là, 2 sinon.
 */
export function checkEnvFile(path = '.env'): EnvCheck {
  if (!existsSync(path)) return { exitCode: 2, lines: [`${path} absent : suivre pipeline/run/env-from-vault.md`] };
  let vars: Record<string, string>;
  try {
    vars = parseEnv(readFileSync(path, 'utf8')) as Record<string, string>;
  } catch (e) {
    return { exitCode: 2, lines: [`${path} illisible (${(e as NodeJS.ErrnoException).code ?? 'erreur de lecture'})`] };
  }
  const state = (name: string) => (vars[name] === undefined ? 'absente' : vars[name].trim() === '' ? 'vide' : 'présente');
  const lines: string[] = [];
  let missing = 0;
  for (const name of REQUIRED_ENV) {
    const s = state(name);
    if (s !== 'présente') missing++;
    lines.push(`${s === 'présente' ? 'ok ' : 'ERREUR'} ${name} : ${s}${s === 'présente' ? '' : ' (obligatoire)'}`);
  }
  for (const name of OPTIONAL_ENV) {
    const s = state(name);
    lines.push(`${s === 'présente' ? 'ok ' : 'avertissement'} ${name} : ${s}`);
  }
  const url = vars.SUPABASE_URL?.trim();
  if (url && !/^https:\/\/[a-z0-9]+\.supabase\.co\/?$/.test(url)) lines.push('avertissement SUPABASE_URL : forme inattendue (https://<référence>.supabase.co attendu)');
  for (const name of Object.keys(vars)) if (!KNOWN.has(name)) lines.push(`avertissement ${name} : variable inconnue du pipeline`);
  if (process.platform !== 'win32' && (statSync(path).mode & 0o077) !== 0) lines.push(`avertissement ${path} : lisible par d'autres comptes (chmod 600 ${path})`);
  return { exitCode: missing > 0 ? 2 : 0, lines };
}
