import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { runCli } from '../run-cli';
import { DAY, makeDay } from './day';

const SERVICE_KEY = 'clé-de-service-de-test-0123456789';
const DRIVE_TOKEN = 'jeton-drive-de-test-0123456789-abcdef';
/** Port 9 (discard) de la machine locale : connexion refusée, aucun appel hors de la machine. */
const UNREACHABLE = 'http://127.0.0.1:9';

/** Lance le CLI sur un dossier du jour préparé (`--out` absolu : le CLI tourne dans un dossier vide). */
function publishCli(env: Record<string, string> = {}, files?: Record<string, string>) {
  const { outDir, dayDir } = makeDay();
  const r = runCli('pipeline/publish/cli.ts', ['--date', DAY, '--out', outDir], env, { files });
  return { ...r, dayDir };
}

describe('CLI brief:publish', () => {
  it('sans configuration : code 2, rapport écrit, messages lisibles', () => {
    const r = publishCli();
    expect(r.status).toBe(2);
    expect(r.stdout).toBe(
      'brief:publish 2026-11-06\n' +
        '[error] SUPABASE_URL ou SUPABASE_SERVICE_ROLE_KEY absente : rien n’est publié dans Supabase\n' +
        '[warning] APPS_SCRIPT_URL ou APPS_SCRIPT_TOKEN absente : dépôt Drive ignoré\n' +
        '[error] aucune édition publiée\n' +
        'FR : non publiée\n' +
        'EN : non publiée\n' +
        'ES : non publiée\n' +
        'Drive : skipped\n' +
        'Erreur : aucune édition publiée.\n',
    );
    const report = JSON.parse(readFileSync(join(r.dayDir, 'publish-report.json'), 'utf8'));
    expect([report.exitCode, report.status, report.runSaved]).toEqual([2, 'failed', false]);
  }, 30_000);

  it('Supabase injoignable : code 2, et aucun secret n’est affiché ni écrit', () => {
    const r = publishCli({ SUPABASE_URL: UNREACHABLE, SUPABASE_SERVICE_ROLE_KEY: `  ${SERVICE_KEY}  `, APPS_SCRIPT_URL: 'https://exemple.fr/exec', APPS_SCRIPT_TOKEN: DRIVE_TOKEN });
    expect(r.status).toBe(2);
    expect(r.stdout).toContain('[error] APPS_SCRIPT_URL invalide : application web Apps Script attendue');
    expect(r.stdout).toContain('[error] FR édition non publiée : Supabase publish_edition : ');
    expect(r.stdout).toContain('Erreur : aucune édition publiée.');
    const everything = r.stdout + r.stderr + readFileSync(join(r.dayDir, 'publish-report.json'), 'utf8');
    for (const secret of [SERVICE_KEY, DRIVE_TOKEN]) expect(everything).not.toContain(secret);
  }, 30_000);

  it('lit les variables dans .env, sans écraser celles du processus ; une variable blanche compte pour absente', () => {
    const dotenv = `SUPABASE_URL=${UNREACHABLE}\nSUPABASE_SERVICE_ROLE_KEY=${SERVICE_KEY}\n`;
    const fromFile = publishCli({ SUPABASE_URL: '   ' }, { '.env': dotenv });
    expect(fromFile.stdout).toContain('Supabase publish_edition : ');
    expect(fromFile.stdout).not.toContain('SUPABASE_URL ou SUPABASE_SERVICE_ROLE_KEY absente');
    const processWins = publishCli({ SUPABASE_URL: 'http://projet.supabase.co' }, { '.env': dotenv });
    expect(processWins.stdout).toContain('[error] SUPABASE_URL invalide : https obligatoire (http seulement pour localhost) : rien n’est publié dans Supabase');
  }, 60_000);

  it('date invalide : code 2', () => {
    const r = runCli('pipeline/publish/cli.ts', ['--date', '2026-02-30']);
    expect(r.status).toBe(2);
    expect(r.stdout).toContain('[error] date incorrecte : « 2026-02-30 »');
    expect(existsSync(join(r.cwd, 'out'))).toBe(false);
  }, 30_000);

  it('un message d’erreur de haut niveau ne cite aucun secret', () => {
    const r = runCli('pipeline/publish/cli.ts', [`--${SERVICE_KEY}`], { SUPABASE_URL: UNREACHABLE, SUPABASE_SERVICE_ROLE_KEY: SERVICE_KEY, APPS_SCRIPT_TOKEN: DRIVE_TOKEN });
    expect(r.status).toBe(2);
    expect(r.stderr).toContain('brief:publish :');
    expect(r.stderr).not.toContain(SERVICE_KEY);
  }, 30_000);

  it('le script npm brief:publish pointe sur ce CLI', () => {
    const pkg = JSON.parse(readFileSync(new URL('../../../package.json', import.meta.url), 'utf8'));
    expect(pkg.scripts['brief:publish']).toBe('tsx pipeline/publish/cli.ts');
  });
});
