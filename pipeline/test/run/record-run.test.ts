import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { recordRun } from '../../run/record-run';
import { DAY, makeDay } from '../publish/day';
import { stepReports } from '../publish/reports';
import { FAKE_KEY, FAKE_URL, fakeSupabase } from '../supabase/fake-supabase';
import { createTestDb, resetData, rows, type TestDb } from '../supabase/pg';

let db: TestDb;
beforeAll(async () => {
  db = await createTestDb();
}, 60_000);
afterAll(async () => {
  await db.close();
});
beforeEach(async () => {
  await resetData(db);
});

const env = { SUPABASE_URL: FAKE_URL, SUPABASE_SERVICE_ROLE_KEY: FAKE_KEY };
const runs = () => rows<{ status: string; notes: string; steps: Record<string, { status: string }> }>(db, 'select status, notes, steps from public.runs');

describe('recordRun (brief:notify --record, arrêt précoce de la routine)', () => {
  it('écrit une ligne runs « failed » avec le message et le bilan des rapports présents', async () => {
    const collect = JSON.parse(stepReports()['collect-report.json']);
    const { dayDir } = makeDay({ extra: { 'context-report.json': stepReports()['context-report.json'], 'collect-report.json': JSON.stringify({ ...collect, exitCode: 2 }) } });
    const r = await recordRun({ dayDir, date: DAY, message: 'Brief incomplet : collecte impossible : aucun article', env, fetch: fakeSupabase(db).fetch });
    expect(r).toEqual({ saved: true });
    const [run] = await runs();
    expect([run.status, run.notes]).toEqual(['failed', 'Brief incomplet : collecte impossible : aucun article']);
    expect(run.steps.collect.status).toBe('failed');
    expect(run.steps.verify.status).toBe('missing');
  });

  it('sans variables Supabase : rien n’est écrit, la raison est rendue sans valeur', async () => {
    const { dayDir } = makeDay();
    const r = await recordRun({ dayDir, date: DAY, message: 'm', env: {}, fetch: fakeSupabase(db).fetch });
    expect(r.saved).toBe(false);
    expect(r.error).toMatch(/SUPABASE/);
    expect(await runs()).toEqual([]);
  });

  it('Supabase en erreur : saved false, secrets masqués', async () => {
    const { dayDir } = makeDay();
    const fake = fakeSupabase(db);
    fake.intercept = () => ({ error: new Error(`refusé : ${FAKE_KEY}`) });
    const r = await recordRun({ dayDir, date: DAY, message: 'm', env, fetch: fake.fetch });
    expect(r.saved).toBe(false);
    expect(r.error).not.toContain(FAKE_KEY);
  });
});
