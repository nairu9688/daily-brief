/**
 * Contrôle « aucun secret dans le code envoyé au navigateur » : construit l'appli avec des valeurs
 * témoins dans les variables serveur, puis cherche dans .next/static (seuls fichiers servis au
 * navigateur) ces valeurs, les noms des variables serveur et `service_role`.
 * Commande : npm run web:check-bundle (code 0 : propre ; 1 : fuite ; 2 : build impossible).
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const WEB = fileURLToPath(new URL('..', import.meta.url));

export const CANARIES = {
  SUPABASE_SERVICE_ROLE_KEY: 'canary-service-role-7f3a9c',
  ALLOWED_EMAIL: 'canary-allowed-7f3a9c@example.invalid',
  SITE_URL: 'https://canary-site-7f3a9c.example.invalid',
};

/** Ce qui ne doit jamais apparaître côté navigateur. */
export const NEEDLES = ['service_role', 'sb_secret_', ...Object.keys(CANARIES), ...Object.values(CANARIES), 'fixtures/brief-2026-11-06.json'];

/** Fichiers de `dir` contenant l'une des aiguilles : [fichier, aiguille][]. */
export function scanBundle(dir: string, needles: string[] = NEEDLES): [string, string][] {
  const hits: [string, string][] = [];
  const walk = (d: string) => {
    for (const f of readdirSync(d)) {
      const p = join(d, f);
      if (statSync(p).isDirectory()) walk(p);
      else {
        const text = readFileSync(p, 'latin1');
        for (const n of needles) if (text.includes(n)) hits.push([relative(dir, p), n]);
      }
    }
  };
  walk(dir);
  return hits;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try {
    execFileSync('npx', ['next', 'build'], {
      cwd: WEB,
      stdio: 'inherit',
      env: { ...process.env, ...CANARIES, FIXTURE: '', NEXT_TELEMETRY_DISABLED: '1', NEXT_PUBLIC_SUPABASE_URL: 'https://canary.supabase.co', NEXT_PUBLIC_SUPABASE_ANON_KEY: 'sb_publishable_canary' },
    });
  } catch {
    console.error('Build impossible.');
    process.exit(2);
  }
  const dir = join(WEB, '.next/static');
  if (!existsSync(dir)) {
    console.error('.next/static absent.');
    process.exit(2);
  }
  const hits = scanBundle(dir);
  for (const [file, needle] of hits) console.error(`fuite : « ${needle} » dans .next/static/${file}`);
  console.log(hits.length ? `${hits.length} fuite(s) dans le code du navigateur.` : 'Aucun secret ni nom de variable serveur dans le code du navigateur.');
  process.exit(hits.length ? 1 : 0);
}
