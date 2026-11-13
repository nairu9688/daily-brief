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
        thread('fr-c', 'fr', '2026-11-05T08:00:00Z', ['2026-11-05']),
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
    expect(ctx.openThreads.map((t) => t.id)).toEqual(['fr-a', 'fr-c', 'fr-b', 'en-1', 'es-1']);
    expect(ctx.yesterdayTopics.map((t) => t.title)).toEqual(['Budget au Sénat', 'Retraites', 'Presupuestos']);
    expect(read(join(dayDir, 'context-report.json'))).toEqual({
      date: DAY,
      generatedAt: '2026-11-06T04:13:00.000Z',
      exitCode: 0,
      store: 'mémoire',
      staleDays: 21,
      closedThreads: ['fr-ancien'],
      openThreads: 5,
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

  it('retire les doublons, Threads fermés et sujets invalides avec un avertissement', async () => {
    const { outDir, dayDir } = setup();
    const store: ContextStore = {
      name: 'test',
      closeStaleThreads: async () => ['ferme'],
      openThreads: async () =>
        [
          { id: 'ok', slug: 'ok', title: 'OK', lang: 'fr', updatedAt: '2026-11-05T10:00:00Z' },
          { id: 'ok', slug: 'ok', title: 'OK', lang: 'fr', updatedAt: '2026-11-05T10:00:00Z' },
          { id: 'ferme', slug: 'f', title: 'Fermé', lang: 'fr', updatedAt: '2026-11-05T10:00:00Z' },
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
      expect.stringMatching(/^sujet de la veille n° 1 invalide, ignoré : title /),
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

  it('un Thread ouvert invalide bloque : code 2, pas de context.json', async () => {
    for (const bad of [
      { id: 'vide', slug: 'v', title: '', lang: 'fr', updatedAt: '2026-11-05T10:00:00Z' },
      { id: 'pg', slug: 'p', title: 'PG', lang: 'fr', updatedAt: '2026-11-05 10:00:00+00' },
    ]) {
      const { outDir, dayDir } = setup();
      const store: ContextStore = {
        name: 'test',
        closeStaleThreads: async () => [],
        openThreads: async () => [{ id: 'ok', slug: 'ok', title: 'OK', lang: 'fr', updatedAt: '2026-11-05T10:00:00Z' }, bad] as never,
        yesterdayTopics: async () => [],
      };
      const r = await runContext({ outDir, date: DAY, store, now: NOW });
      expect(r.exitCode).toBe(2);
      expect(existsSync(join(dayDir, 'context.json'))).toBe(false);
      expect(r.report.issues).toHaveLength(1);
      expect(r.report.issues[0].level).toBe('error');
      expect(r.report.issues[0].message).toMatch(new RegExp(`^Thread ouvert invalide \\(id ${bad.id}\\) : `));
    }
  });

  it('un doublon seul reste un avertissement', async () => {
    const { outDir } = setup();
    const row = { id: 'ok', slug: 'ok', title: 'OK', lang: 'fr' as const, updatedAt: '2026-11-05T10:00:00Z' };
    const store: ContextStore = { name: 'test', closeStaleThreads: async () => [], openThreads: async () => [row, row], yesterdayTopics: async () => [] };
    const r = await runContext({ outDir, date: DAY, store, now: NOW });
    expect(r.exitCode).toBe(0);
    expect(r.report.issues).toEqual([{ level: 'warning', message: 'Thread ok en double, ignoré' }]);
  });

  it('délai sur la fermeture : signal levé avant l’écriture, aucun Thread fermé', async () => {
    const { outDir, dayDir } = setup();
    class Slow extends MemoryContextStore {
      async closeStaleThreads(date: string, days?: number, signal?: AbortSignal) {
        await new Promise((r) => setTimeout(r, 120));
        return super.closeStaleThreads(date, days, signal);
      }
    }
    const store = new Slow({ threads: [thread('vieux', 'fr', '2026-10-01T10:00:00Z', ['2026-10-01'])] });
    const r = await runContext({ outDir, date: DAY, store, timeoutMs: 30, now: NOW });
    expect(r.exitCode).toBe(2);
    expect(r.report.issues).toEqual([{ level: 'error', message: 'store mémoire : résultat de la fermeture inconnu (délai dépassé)' }]);
    await new Promise((res) => setTimeout(res, 250));
    expect(store.threads[0].status).toBe('open');
    expect(existsSync(join(dayDir, 'context.json'))).toBe(false);
  });

  it('échec partiel : fermeture réussie puis openThreads en erreur, Threads fermés listés, code 2', async () => {
    const { outDir, dayDir } = setup();
    const store: ContextStore = {
      name: 'test',
      closeStaleThreads: async () => ['b', 'a'],
      openThreads: async () => {
        throw new Error('panne');
      },
      yesterdayTopics: async () => [],
    };
    const r = await runContext({ outDir, date: DAY, store, now: NOW });
    expect(r.exitCode).toBe(2);
    expect(r.report.closedThreads).toEqual(['a', 'b']);
    expect(read(join(dayDir, 'context-report.json')).closedThreads).toEqual(['a', 'b']);
    expect(existsSync(join(dayDir, 'context.json'))).toBe(false);
  });

  it('résultat de fermeture invalide : message court', async () => {
    const { outDir } = setup();
    const store: ContextStore = { name: 'test', closeStaleThreads: async () => [42] as never, openThreads: async () => [], yesterdayTopics: async () => [] };
    const r = await runContext({ outDir, date: DAY, store, now: NOW });
    expect(r.exitCode).toBe(2);
    expect(r.report.issues).toEqual([{ level: 'error', message: 'store test : résultat de fermeture invalide' }]);
  });

  it('avertit d’un événement daté de plus de 7 jours dans le futur, en nommant le Thread', async () => {
    const { outDir } = setup();
    const store = new MemoryContextStore({
      threads: [thread('futur', 'fr', '2026-11-05T10:00:00Z', ['2026-11-05', '2026-11-20']), thread('proche', 'fr', '2026-11-05T10:00:00Z', ['2026-11-13'])],
    });
    const r = await runContext({ outDir, date: DAY, store, now: NOW });
    expect(r.exitCode).toBe(0);
    expect(r.report.issues).toEqual([{ level: 'warning', message: 'Thread futur : événement daté du 2026-11-20, à plus de 7 jours dans le futur' }]);
  });

  it('masque la clé dans le rapport', async () => {
    const { outDir, dayDir } = setup();
    const store: ContextStore = {
      name: 'supabase',
      closeStaleThreads: async () => {
        throw new Error('401 avec la clé sk-123');
      },
      openThreads: async () => [],
      yesterdayTopics: async () => [],
    };
    const r = await runContext({ outDir, date: DAY, store, secrets: ['sk-123'], now: NOW });
    expect(r.exitCode).toBe(2);
    expect(readFileSync(join(dayDir, 'context-report.json'), 'utf8')).not.toContain('sk-123');
  });

  it('anomalies() ne bloque jamais le contexte : erreur, blocage, null ou entrées invalides', async () => {
    const base = { name: 'test', closeStaleThreads: async () => [], openThreads: async () => [], yesterdayTopics: async () => [] };
    const cases: [string, ContextStore, string][] = [
      ['throw', { ...base, anomalies: async () => { throw new Error('boum'); } }, 'anomalies indisponibles : boum'],
      ['blocage', { ...base, anomalies: () => new Promise<never>(() => {}) }, 'anomalies indisponibles : anomalies : délai dépassé (30 ms)'],
      ['null', { ...base, anomalies: async () => null as never }, 'anomalies indisponibles : résultat invalide'],
      ['invalide', { ...base, anomalies: async () => [{ a: 1 }, 42] as never }, 'anomalies : 2 entrée(s) invalide(s) ignorée(s)'],
    ];
    for (const [, store, message] of cases) {
      const { outDir, dayDir } = setup();
      const r = await runContext({ outDir, date: DAY, store, timeoutMs: 30, now: NOW });
      expect(r.exitCode).toBe(0);
      expect(existsSync(join(dayDir, 'context.json'))).toBe(true);
      expect(r.report.issues).toEqual([{ level: 'warning', message }]);
    }
  });
});
