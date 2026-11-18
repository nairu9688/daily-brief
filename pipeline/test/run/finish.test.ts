import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { LANGS } from '@daily-brief/schema';
import { finishSteps, runFinish, type FinishStep, type StepRunner } from '../../run/finish';
import { fixtureEdition } from '../helpers';

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

describe('runFinish (revue du lot 7)', () => {
  it('masque les secrets dans les erreurs de routine-report.json', async () => {
    const outDir = mkdtempSync(join(tmpdir(), 'finish-'));
    const s = steps({ publish: new Error('HTTP 401 pour sb_secret_TEMOIN_0123 sur https://x.supabase.co/rest?apikey=AUTRE') });
    const r = await runFinish({ outDir, date: DAY, steps: s.steps, now: NOW, secrets: ['sb_secret_TEMOIN_0123'] });
    expect(r.report.steps[2].error).toBe('HTTP 401 pour *** sur https://x.supabase.co/rest?apikey=***');
    const written = readFileSync(join(outDir, DAY, 'routine-report.json'), 'utf8');
    expect(written).not.toMatch(/TEMOIN|AUTRE/);
  });

  it('--dry-run : aucun appel extérieur (audio sans clé, rendu sans Pexels ni réseau), « audio désactivé (répétition) »', async () => {
    const outDir = mkdtempSync(join(tmpdir(), 'finish-'));
    mkdirSync(join(outDir, DAY));
    for (const lang of LANGS) writeFileSync(join(outDir, DAY, `${lang}.verified.json`), JSON.stringify(fixtureEdition(lang)));
    const calls: string[] = [];
    const spy = (async (url: string | URL) => {
      calls.push(String(url));
      throw new Error('réseau interdit');
    }) as unknown as typeof fetch;
    const env = { GOOGLE_TTS_API_KEY: 'AIzaTEMOIN', PEXELS_API_KEY: 'pexels-TEMOIN', SUPABASE_URL: 'https://abc.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'sb_secret_TEMOIN' };
    const r = await runFinish({
      outDir,
      date: DAY,
      dryRun: true,
      now: NOW,
      steps: finishSteps({ outDir, date: DAY, dryRun: true, env, fetch: spy, ffmpeg: null, print: async (_html, path) => writeFileSync(path, '%PDF-1.7\n%%EOF\n') }),
    });
    expect(calls).toEqual([]);
    expect(r.report.steps.map((x) => [x.step, x.exitCode])).toEqual([['audio', 0], ['render', 0]]);
    expect(JSON.parse(readFileSync(join(outDir, DAY, 'audio-report.json'), 'utf8')).status).toBe('disabled');
    expect(r.report.notification.message).toContain('audio désactivé (répétition)');
    expect(r.report.notification.message).toMatch(/^Répétition sans publication : 10 sujets/);
  });

  it('finishSteps hors répétition : publish reçoit les variables, audio la clé', async () => {
    const outDir = mkdtempSync(join(tmpdir(), 'finish-'));
    const s = finishSteps({ outDir, date: DAY, env: {}, fetch: (async () => { throw new Error('non'); }) as unknown as typeof fetch, ffmpeg: null });
    expect(Object.keys(s)).toEqual(['audio', 'render', 'publish']);
    expect((await s.publish()).exitCode).toBe(2);
  });
});
