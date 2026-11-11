import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { runCli } from '../run-cli';

describe('CLI brief:context', () => {
  it('sans Supabase : contexte vide, avertissement, code 0', () => {
    const r = runCli('pipeline/context/cli.ts', ['--date', '2026-11-06']);
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

  it('rogne la clé de service : une clé blanche compte pour absente, une clé entourée d’espaces pour présente', () => {
    const blank = runCli('pipeline/context/cli.ts', ['--date', '2026-11-06'], { SUPABASE_URL: 'https://x.supabase.co', SUPABASE_SERVICE_ROLE_KEY: '   ' });
    expect(blank.stdout).toContain('SUPABASE_URL ou SUPABASE_SERVICE_ROLE_KEY absente');
    const padded = runCli('pipeline/context/cli.ts', ['--date', '2026-11-06'], { SUPABASE_URL: 'https://x.supabase.co', SUPABASE_SERVICE_ROLE_KEY: '  clé-secrète  ' });
    expect(padded.stdout).toContain('store Supabase pas encore disponible (lot 4)');
    expect(padded.stdout).not.toContain('clé-secrète');
  }, 30_000);
});
