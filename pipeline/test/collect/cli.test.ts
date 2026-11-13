import { existsSync, mkdtempSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { runCli } from '../run-cli';

describe('CLI brief:collect', () => {
  it('sort avec le code 2 sur une option inconnue', () => {
    const r = runCli('pipeline/collect/cli.ts', ['--dat', '2026-11-06']);
    expect(r.status).toBe(2);
    expect(r.stderr).toContain('brief:collect :');
  }, 30_000);

  it('sort avec le code 2 sur une date invalide, sans rien écrire', () => {
    const out = mkdtempSync(join(tmpdir(), 'collect-cli-'));
    const r = runCli('pipeline/collect/cli.ts', ['--date', '2026-02-30', '--out', out]);
    expect(r.status).toBe(2);
    expect(r.stdout).toContain('[error] date incorrecte : « 2026-02-30 »');
    expect(existsSync(join(out, '2026-02-30'))).toBe(false);
  }, 30_000);

  const PRELOAD = 'pipeline/test/fake-fetch-preload.ts';

  it('chemin de succès avec un faux réseau : raw.json et rapport écrits, code 0', () => {
    const r = runCli('pipeline/collect/cli.ts', ['--out', 'sortie'], {}, { preload: PRELOAD });
    expect(r.status, r.stdout + r.stderr).toBe(0);
    expect(r.stdout).toMatch(/raw\.json : \d+ articles/);
    expect(r.stdout).toContain('THENEWSAPI_KEY absente');
    const days = readdirSync(join(r.cwd, 'sortie'));
    expect(days).toHaveLength(1);
    expect(existsSync(join(r.cwd, 'sortie', days[0], 'raw.json'))).toBe(true);
    expect(existsSync(join(r.cwd, 'sortie', days[0], 'collect-report.json'))).toBe(true);
  }, 30_000);

  it('une variable secrète définie mais vide laisse .env la remplir', () => {
    const log = join(mkdtempSync(join(tmpdir(), 'fakelog-')), 'urls.txt');
    const r = runCli('pipeline/collect/cli.ts', ['--out', 'sortie'], { THENEWSAPI_KEY: '', FAKE_FETCH_LOG: log }, { preload: PRELOAD, files: { '.env': 'THENEWSAPI_KEY=tna-depuis-dotenv\n' } });
    expect(r.status, r.stdout + r.stderr).toBe(0);
    expect(readFileSync(log, 'utf8')).toContain('api_token=tna-depuis-dotenv');
    expect(r.stdout).not.toContain('THENEWSAPI_KEY absente');
    expect(r.stdout + r.stderr).not.toContain('tna-depuis-dotenv');
  }, 30_000);
});
