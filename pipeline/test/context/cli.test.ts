import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { readSupabaseEnv } from '../../context/supabase-env';
import { runCli } from '../run-cli';

describe('CLI brief:context', () => {
  it('sans Supabase : code 2, rapport écrit, pas de context.json', () => {
    const r = runCli('pipeline/context/cli.ts', ['--date', '2026-11-06']);
    expect(r.status).toBe(2);
    expect(r.stdout).toBe(
      'brief:context 2026-11-06 (store indisponible)\n' +
        '[error] store indisponible : SUPABASE_URL ou SUPABASE_SERVICE_ROLE_KEY absente (--allow-empty pour un contexte vide en développement local)\n' +
        'Erreur : context.json non écrit.\n',
    );
    expect(existsSync(join(r.cwd, 'out/2026-11-06/context.json'))).toBe(false);
    expect(JSON.parse(readFileSync(join(r.cwd, 'out/2026-11-06/context-report.json'), 'utf8')).exitCode).toBe(2);
  }, 30_000);

  it('sans Supabase, avec --allow-empty : contexte vide, avertissement, code 0', () => {
    const r = runCli('pipeline/context/cli.ts', ['--date', '2026-11-06', '--allow-empty']);
    expect(r.status).toBe(0);
    expect(r.stdout).toBe(
      'brief:context 2026-11-06 (store vide)\n' +
        '[warning] SUPABASE_URL ou SUPABASE_SERVICE_ROLE_KEY absente : contexte vide (aucun Thread ouvert, aucun sujet de la veille)\n' +
        'context.json : 0 Threads ouverts, 0 sujets de la veille, 0 Threads fermés (R12)\n',
    );
    expect(JSON.parse(readFileSync(join(r.cwd, 'out/2026-11-06/context.json'), 'utf8'))).toEqual({ date: '2026-11-06', openThreads: [], yesterdayTopics: [] });
  }, 30_000);

  it('sort avec le code 2 sur une date invalide', () => {
    const r = runCli('pipeline/context/cli.ts', ['--date', '2026-02-30']);
    expect(r.status).toBe(2);
    expect(r.stdout).toContain('[error] date incorrecte : « 2026-02-30 »');
  }, 30_000);

  it('rogne la clé de service : une clé blanche compte pour absente, même dans l’environnement du processus', () => {
    const blank = runCli('pipeline/context/cli.ts', ['--date', '2026-11-06'], { SUPABASE_URL: 'http://127.0.0.1:9', SUPABASE_SERVICE_ROLE_KEY: '   ' });
    expect(blank.status).toBe(2);
    expect(blank.stdout).toContain('SUPABASE_URL ou SUPABASE_SERVICE_ROLE_KEY absente');
  }, 30_000);

  it('Supabase injoignable : code 2, et la clé n’est ni affichée ni écrite', () => {
    // Port 9 (discard) de la machine locale : connexion refusée, aucun appel hors de la machine.
    const r = runCli('pipeline/context/cli.ts', ['--date', '2026-11-06'], { SUPABASE_URL: 'http://127.0.0.1:9', SUPABASE_SERVICE_ROLE_KEY: '  clé-secrète-de-test  ' });
    expect(r.status).toBe(2);
    expect(r.stdout).toContain('brief:context 2026-11-06 (store supabase)');
    expect(r.stdout).toContain('[error] store supabase : Supabase close_stale_threads : ');
    expect(r.stdout + r.stderr).not.toContain('clé-secrète-de-test');
    expect(readFileSync(join(r.cwd, 'out/2026-11-06/context-report.json'), 'utf8')).not.toContain('clé-secrète-de-test');
    expect(existsSync(join(r.cwd, 'out/2026-11-06/context.json'))).toBe(false);
  }, 30_000);

  it('SUPABASE_URL invalide : code 2 même avec --allow-empty', () => {
    const r = runCli('pipeline/context/cli.ts', ['--date', '2026-11-06', '--allow-empty'], { SUPABASE_URL: 'http://projet.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'clé-secrète-de-test' });
    expect(r.status).toBe(2);
    expect(r.stdout).toContain('[error] store indisponible : SUPABASE_URL invalide : https obligatoire (http seulement pour localhost)');
  }, 30_000);

  it('un message d’erreur de haut niveau ne cite jamais la clé de service', () => {
    const r = runCli('pipeline/context/cli.ts', ['--clé-secrète-9876'], { SUPABASE_URL: 'https://x.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'clé-secrète-9876' });
    expect(r.status).toBe(2);
    expect(r.stderr).toContain('brief:context :');
    expect(r.stderr).not.toContain('clé-secrète-9876');
  }, 30_000);

  it('readSupabaseEnv rogne les valeurs et traite une valeur blanche comme absente', () => {
    expect(readSupabaseEnv({ SUPABASE_URL: ' https://x.supabase.co ', SUPABASE_SERVICE_ROLE_KEY: '  clé  ' })).toEqual({ url: 'https://x.supabase.co', serviceKey: 'clé' });
    expect(readSupabaseEnv({ SUPABASE_URL: 'https://x', SUPABASE_SERVICE_ROLE_KEY: '   ' })).toEqual({ url: 'https://x', serviceKey: undefined });
    expect(readSupabaseEnv({})).toEqual({ url: undefined, serviceKey: undefined });
  });
});
