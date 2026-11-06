import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { fixtureBrief, repoPath } from '../helpers';

const DAY = '2026-11-06';

function runCli(args: string[]): { status: number; stdout: string; stderr: string } {
  try {
    const stdout = execFileSync(process.execPath, ['--import', 'tsx', 'pipeline/verify/cli.ts', ...args], {
      cwd: repoPath(''),
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { status: 0, stdout, stderr: '' };
  } catch (e: any) {
    return { status: e.status, stdout: String(e.stdout ?? ''), stderr: String(e.stderr ?? '') };
  }
}

function setup(): { out: string; dayDir: string } {
  const out = mkdtempSync(join(tmpdir(), 'brief-cli-'));
  const dayDir = join(out, DAY);
  mkdirSync(dayDir, { recursive: true });
  for (const e of fixtureBrief().editions) writeFileSync(join(dayDir, `${e.lang}.json`), JSON.stringify(e, null, 2));
  return { out, dayDir };
}

describe('CLI brief:verify (bout en bout)', () => {
  it('corrige la fixture et sort avec le code 1', () => {
    const { out } = setup();
    const r = runCli(['--date', DAY, '--out', out]);
    expect(r.status).toBe(1);
    expect(r.stdout).toContain('Infobae : média non espagnol (AR)');
  }, 20_000);

  it('sort avec le code 2 sur une option inconnue', () => {
    const { out } = setup();
    const r = runCli(['--dat', DAY, '--out', out]);
    expect(r.status).toBe(2);
    expect(r.stderr).toContain('brief:verify :');
  }, 20_000);

  it('sort avec le code 0 au second passage sur les fichiers vérifiés', () => {
    const { out, dayDir } = setup();
    expect(runCli(['--date', DAY, '--out', out]).status).toBe(1);
    for (const lang of ['fr', 'en', 'es']) copyFileSync(join(dayDir, `${lang}.verified.json`), join(dayDir, `${lang}.json`));
    const r = runCli(['--date', DAY, '--out', out]);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('OK : aucune violation.');
  }, 20_000);
});
