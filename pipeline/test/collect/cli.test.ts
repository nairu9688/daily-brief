import { existsSync, mkdtempSync } from 'node:fs';
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
});
