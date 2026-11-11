import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ContextSchema } from '@daily-brief/schema';
import { MemoryContextStore, type StoredThread } from '../../context/memory-store';
import { runContext } from '../../context/run-context';
import { selectStore } from '../../context/select-store';
import { EmptyContextStore, type ContextStore } from '../../context/store';

const DAY = '2026-11-06';
const NOW = new Date('2026-11-06T04:13:00Z');
const read = (p: string) => JSON.parse(readFileSync(p, 'utf8'));

const thread = (id: string, lang: 'fr' | 'en' | 'es', updatedAt: string, events: string[]): StoredThread => ({
  id,
  slug: id,
  title: `Thread ${id}`,
  lang,
  updatedAt,
  status: 'open',
  events,
});

function setup() {
  const outDir = mkdtempSync(join(tmpdir(), 'context-'));
  return { outDir, dayDir: join(outDir, DAY) };
}

describe('runContext', () => {
  it('ferme les Threads périmés (R12) puis écrit context.json trié et le rapport', async () => {
    const { outDir, dayDir } = setup();
    const store = new MemoryContextStore({
      threads: [
        thread('es-1', 'es', '2026-11-05T10:00:00Z', ['2026-11-05']),
        thread('fr-ancien', 'fr', '2026-10-01T10:00:00Z', ['2026-10-01']),
        thread('fr-b', 'fr', '2026-11-04T10:00:00Z', ['2026-11-04']),
        thread('fr-a', 'fr', '2026-11-05T09:00:00+01:00', ['2026-11-05']),
        thread('en-1', 'en', '2026-11-02T10:00:00Z', ['2026-11-02']),
      ],
      topics: [
        { date: '2026-11-05', lang: 'es', title: 'Presupuestos' },
        { date: '2026-11-05', lang: 'fr', title: 'Budget au Sénat' },
        { date: '2026-11-05', lang: 'fr', title: 'Retraites' },
      ],
    });
    const r = await runContext({ outDir, date: DAY, store, now: NOW });
    expect(r.exitCode).toBe(0);
    const ctx = ContextSchema.parse(read(join(dayDir, 'context.json')));
    expect(ctx.openThreads.map((t) => t.id)).toEqual(['fr-a', 'fr-b', 'en-1', 'es-1']);
    expect(ctx.yesterdayTopics.map((t) => t.title)).toEqual(['Budget au Sénat', 'Retraites', 'Presupuestos']);
    expect(read(join(dayDir, 'context-report.json'))).toEqual({
      date: DAY,
      generatedAt: '2026-11-06T04:13:00.000Z',
      exitCode: 0,
      store: 'mémoire',
      staleDays: 21,
      closedThreads: ['fr-ancien'],
      openThreads: 4,
      yesterdayTopics: 3,
      issues: [],
    });
    expect(store.threads.find((t) => t.id === 'fr-ancien')!.status).toBe('closed');
  });

  it('store vide : contexte vide écrit avec l’avertissement, code 0', async () => {
    const { outDir, dayDir } = setup();
    const { store, warning } = selectStore({});
    const r = await runContext({ outDir, date: DAY, store, warnings: [warning], now: NOW });
    expect(r.exitCode).toBe(0);
    expect(read(join(dayDir, 'context.json'))).toEqual({ date: DAY, openThreads: [], yesterdayTopics: [] });
    expect(r.report.issues).toEqual([{ level: 'warning', message: 'SUPABASE_URL ou SUPABASE_SERVICE_ROLE_KEY absente : contexte vide (aucun Thread ouvert, aucun sujet de la veille)' }]);
    expect(selectStore({ SUPABASE_URL: 'https://x.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'k' }).warning).toBe('store Supabase pas encore disponible (lot 4) : contexte vide');
  });

  it('retire les éléments invalides, en double ou fermés, avec un avertissement', async () => {
    const { outDir, dayDir } = setup();
    const store: ContextStore = {
      name: 'test',
      closeStaleThreads: async () => ['ferme'],
      openThreads: async () =>
        [
          { id: 'ok', slug: 'ok', title: 'OK', lang: 'fr', updatedAt: '2026-11-05T10:00:00Z' },
          { id: 'ok', slug: 'ok', title: 'OK', lang: 'fr', updatedAt: '2026-11-05T10:00:00Z' },
          { id: 'ferme', slug: 'f', title: 'Fermé', lang: 'fr', updatedAt: '2026-11-05T10:00:00Z' },
          { id: 'de', slug: 'de', title: 'Allemand', lang: 'de', updatedAt: '2026-11-05T10:00:00Z' },
        ] as never,
      yesterdayTopics: async () => [{ lang: 'fr', title: '  ' }, { lang: 'en', title: 'Midterms' }] as never,
    };
    const r = await runContext({ outDir, date: DAY, store, now: NOW });
    expect(r.exitCode).toBe(0);
    const ctx = read(join(dayDir, 'context.json'));
    expect(ctx.openThreads.map((t: { id: string }) => t.id)).toEqual(['ok']);
    expect(ctx.yesterdayTopics).toEqual([{ lang: 'en', title: 'Midterms' }]);
    expect(r.report.issues.map((i) => i.message)).toEqual([
      'Thread ok en double, ignoré',
      'Thread ferme fermé mais encore listé ouvert, ignoré',
      expect.stringMatching(/^Thread n° 4 invalide, ignoré : lang /),
      'sujet de la veille n° 1 invalide, ignoré',
    ]);
  });

  it('store en erreur ou muet : pas de context.json, ancien fichier supprimé, code 2, aucun secret', async () => {
    const { outDir, dayDir } = setup();
    mkdirSync(dayDir, { recursive: true });
    writeFileSync(join(dayDir, 'context.json'), '{"périmé":true}');
    const failing: ContextStore = {
      name: 'supabase',
      openThreads: async () => {
        throw new Error('JWT invalide : service-SECRET-KEY');
      },
      yesterdayTopics: async () => [],
      closeStaleThreads: async () => [],
    };
    const r = await runContext({ outDir, date: DAY, store: failing, secrets: ['service-SECRET-KEY'], now: NOW });
    expect(r.exitCode).toBe(2);
    expect(existsSync(join(dayDir, 'context.json'))).toBe(false);
    const report = readFileSync(join(dayDir, 'context-report.json'), 'utf8');
    expect(report).not.toContain('service-SECRET-KEY');
    expect(JSON.parse(report).issues).toEqual([{ level: 'error', message: 'store supabase : JWT invalide : ***' }]);

    const mute: ContextStore = { ...failing, openThreads: () => new Promise(() => {}) };
    const t0 = Date.now();
    const m = await runContext({ outDir, date: DAY, store: mute, timeoutMs: 30, now: NOW });
    expect(Date.now() - t0).toBeLessThan(2000);
    expect(m.exitCode).toBe(2);
    expect(m.report.issues[0].message).toBe('store supabase : Threads ouverts : délai dépassé (30 ms)');
  });

  it('refuse une date invalide sans rien écrire', async () => {
    const { outDir } = setup();
    const r = await runContext({ outDir, date: '../2026-13-45', store: new EmptyContextStore(), now: NOW });
    expect(r.exitCode).toBe(2);
    expect(r.report.issues).toEqual([{ level: 'error', message: 'date incorrecte : « ../2026-13-45 »' }]);
    expect(existsSync(join(outDir, '2026-13-45'))).toBe(false);
  });
});
