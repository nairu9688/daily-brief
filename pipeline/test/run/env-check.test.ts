import { chmodSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { checkEnvFile } from '../../run/env-check';
import { runCli } from '../run-cli';

const SECRET = 'sb_secret_TEMOIN_0123456789';
function envFile(text: string, mode = 0o600) {
  const path = join(mkdtempSync(join(tmpdir(), 'env-')), '.env');
  writeFileSync(path, text);
  chmodSync(path, mode);
  return path;
}

describe('checkEnvFile', () => {
  it('variables obligatoires présentes : code 0, les valeurs ne sont jamais affichées', () => {
    const path = envFile(`SUPABASE_URL=https://abcdefgh.supabase.co\nSUPABASE_SERVICE_ROLE_KEY=${SECRET}\nGOOGLE_TTS_API_KEY=AIzaTEMOIN\nEXA_API_KEY=\n`);
    const r = checkEnvFile(path);
    expect(r.exitCode).toBe(0);
    expect(r.lines).toContain('ok  SUPABASE_SERVICE_ROLE_KEY : présente');
    expect(r.lines).toContain('avertissement EXA_API_KEY : vide');
    expect(r.lines).toContain('avertissement THENEWSAPI_KEY : absente');
    expect(r.lines.join('\n')).not.toMatch(/sb_secret|AIza|abcdefgh/);
  });

  it('PEXELS_API_KEY n’est plus attendue : signalée comme retirée, jamais comme manquante', () => {
    const absent = checkEnvFile(envFile(`SUPABASE_URL=https://abcdefgh.supabase.co\nSUPABASE_SERVICE_ROLE_KEY=${SECRET}\n`));
    expect(absent.lines.join('\n')).not.toMatch(/PEXELS/);
    const left = checkEnvFile(envFile(`SUPABASE_URL=https://abcdefgh.supabase.co\nSUPABASE_SERVICE_ROLE_KEY=${SECRET}\nPEXELS_API_KEY=pexels-TEMOIN\n`));
    expect(left.exitCode).toBe(0);
    expect(left.lines).toContain('avertissement PEXELS_API_KEY : plus utilisée (photos Wikimedia Commons, sans clé), à retirer de Vault');
    expect(left.lines.join('\n')).not.toMatch(/TEMOIN/);
  });

  it('clé de service absente : code 2 ; nom inconnu, URL inattendue et droits trop larges signalés', () => {
    const r = checkEnvFile(envFile('SUPABASE_URL=http://localhost:54321\nSUPABASE_KEY=x\n', 0o644));
    expect(r.exitCode).toBe(2);
    expect(r.lines).toEqual(expect.arrayContaining([
      'ERREUR SUPABASE_SERVICE_ROLE_KEY : absente (obligatoire)',
      'avertissement SUPABASE_URL : forme inattendue (https://<référence>.supabase.co attendu)',
      'avertissement SUPABASE_KEY : variable inconnue du pipeline',
      expect.stringMatching(/lisible par d'autres comptes \(chmod 600 /),
    ]));
  });

  it('un nom hors de la forme ^[A-Z][A-Z0-9_]*$ n’est jamais affiché : « ligne N inattendue »', () => {
    const r = checkEnvFile(envFile(`SUPABASE_URL=https://abcdefgh.supabase.co\nSUPABASE_SERVICE_ROLE_KEY=${SECRET}\nsk_live_TEMOIN=1\n# commentaire\nexport  BAD-NAME=2\nOTHER_NAME=3\n`));
    expect(r.exitCode).toBe(0);
    expect(r.lines).toEqual(expect.arrayContaining(['avertissement ligne 3 inattendue', 'avertissement ligne 5 inattendue', 'avertissement OTHER_NAME : variable inconnue du pipeline']));
    expect(r.lines.join('\n')).not.toMatch(/sk_live|BAD-NAME/);
  });

  it('fichier absent : code 2', () => {
    expect(checkEnvFile(join(tmpdir(), 'inexistant', '.env'))).toEqual({ exitCode: 2, lines: [expect.stringMatching(/absent : suivre pipeline\/run\/env-from-vault\.md$/)] });
  });

  it('CLI : npm run env:check lit le .env du dossier courant sans afficher de valeur', () => {
    const r = runCli('pipeline/run/env-check-cli.ts', [], {}, { files: { '.env': `SUPABASE_URL=https://abcdefgh.supabase.co\nSUPABASE_SERVICE_ROLE_KEY=${SECRET}\n` } });
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('.env prêt.');
    expect(r.stdout + r.stderr).not.toContain(SECRET);
  });
});
