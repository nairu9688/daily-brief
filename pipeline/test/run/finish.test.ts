import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { runFinish, type FinishStep, type StepRunner } from '../../run/finish';

const DAY = '2026-11-06';
const NOW = () => new Date('2026-11-06T04:50:00.000Z');

function steps(codes: Partial<Record<FinishStep, number | Error>> = {}) {
  const calls: FinishStep[] = [];
  const make = (s: FinishStep): StepRunner => async () => {
    calls.push(s);
    const c = codes[s] ?? 0;
    if (c instanceof Error) throw c;
    return { exitCode: c };
  };
  return { calls, steps: { audio: make('audio'), render: make('render'), publish: make('publish') } };
}

describe('runFinish', () => {
  it('lance audio → rendu → publication, dans cet ordre, même quand une étape échoue', async () => {
    const outDir = mkdtempSync(join(tmpdir(), 'finish-'));
    const s = steps({ audio: 1, render: new Error('Chromium absent') });
    const r = await runFinish({ outDir, date: DAY, steps: s.steps, now: NOW });
    expect(s.calls).toEqual(['audio', 'render', 'publish']);
    expect(r.report.steps).toEqual([
      { step: 'audio', exitCode: 1, error: null },
      { step: 'render', exitCode: null, error: 'Chromium absent' },
      { step: 'publish', exitCode: 0, error: null },
    ]);
    expect(r.exitCode).toBe(2);
    expect(r.report.notification.message).toBe('Brief incomplet : rédaction ou contrôle non faits (contexte indisponible : Threads non rattachés ; newsletters non lues ; audio non lancé)');
    expect(JSON.parse(readFileSync(join(outDir, DAY, 'routine-report.json'), 'utf8'))).toEqual(JSON.parse(JSON.stringify(r.report)));
  });

  it('répétition : pas de publication', async () => {
    const outDir = mkdtempSync(join(tmpdir(), 'finish-'));
    const s = steps();
    const r = await runFinish({ outDir, date: DAY, steps: s.steps, dryRun: true, now: NOW });
    expect(s.calls).toEqual(['audio', 'render']);
    expect(r.report.dryRun).toBe(true);
  });

  it('date incorrecte : aucune étape, code 2, pas de rapport', async () => {
    const outDir = mkdtempSync(join(tmpdir(), 'finish-'));
    const s = steps();
    const r = await runFinish({ outDir, date: '06/11/2026', steps: s.steps, now: NOW });
    expect([s.calls, r.exitCode, r.reportWritten, r.report.notification.message]).toEqual([[], 2, false, 'Brief incomplet : date incorrecte (« 06/11/2026 »)']);
    expect(existsSync(join(outDir, '06'))).toBe(false);
  });
});
