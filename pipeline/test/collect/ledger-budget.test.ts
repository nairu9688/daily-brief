import { existsSync, mkdtempSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { RequestBudget } from '../../collect/budget';
import { readDailyUsage, recordDailyUsage, writeDailyUsage } from '../../collect/usage-ledger';

const tmp = () => join(mkdtempSync(join(tmpdir(), 'ledger-')), 'u.json');

describe('compteur quotidien : écriture atomique et fichier ancien', () => {
  it('écrit via un fichier temporaire renommé (aucun .tmp ne reste)', () => {
    const p = tmp();
    writeDailyUsage(p, '2026-11-06', 5);
    expect(existsSync(`${p}.tmp`)).toBe(false);
    expect(readDailyUsage(p, '2026-11-06', 90)).toEqual({ used: 5 });
    recordDailyUsage(p, '2026-11-06', 7);
    expect(existsSync(`${p}.tmp`)).toBe(false);
    expect(readDailyUsage(p, '2026-11-06', 90)).toEqual({ used: 7 });
  });

  it('un fichier illisible daté d’un jour UTC antérieur compte 0 (avertissement), daté d’aujourd’hui compte 90', () => {
    for (const content of ['', '{"day":"2026-11-0']) {
      const p = tmp();
      writeFileSync(p, content);
      const yesterday = new Date('2026-11-05T12:00:00Z');
      utimesSync(p, yesterday, yesterday);
      const old = readDailyUsage(p, '2026-11-06', 90);
      expect(old.used).toBe(0);
      expect(old.error).toBeUndefined();
      expect(old.warning).toMatch(/remis à zéro/);
      const today = new Date('2026-11-06T03:00:00Z');
      utimesSync(p, today, today);
      const cur = readDailyUsage(p, '2026-11-06', 90);
      expect(cur.used).toBe(90);
      expect(cur.error).toMatch(/illisible/);
      expect(cur.warning).toBeUndefined();
    }
  });

  it('recordDailyUsage ne fait jamais baisser le compte du même jour', () => {
    const p = tmp();
    recordDailyUsage(p, '2026-11-06', 10);
    recordDailyUsage(p, '2026-11-06', 4);
    expect(readDailyUsage(p, '2026-11-06', 90)).toEqual({ used: 10 });
    recordDailyUsage(p, '2026-11-06', 12);
    expect(readDailyUsage(p, '2026-11-06', 90)).toEqual({ used: 12 });
    recordDailyUsage(p, '2026-11-07', 1);
    expect(readDailyUsage(p, '2026-11-07', 90)).toEqual({ used: 1 });
    writeFileSync(p, '{');
    recordDailyUsage(p, '2026-11-07', 3);
    expect(readDailyUsage(p, '2026-11-07', 90)).toEqual({ used: 3 });
  });
});

describe('budget : rappel et refus', () => {
  it('onTake reçoit le total après chaque réservation réussie seulement', () => {
    const seen: number[] = [];
    const b = new RequestBudget({ fr: 2 }, 5, (n) => seen.push(n));
    b.take('fr');
    b.take('fr');
    b.take('fr');
    expect(seen).toEqual([1, 2]);
  });

  it('remaining vaut 0 (pas NaN) si la limite ou le total n’est pas fini', () => {
    expect(new RequestBudget({ fr: Number.NaN }, 5).remaining('fr')).toBe(0);
    expect(new RequestBudget({ fr: 2 }, Number.NaN).remaining('fr')).toBe(0);
    expect(new RequestBudget({ fr: 2 }, 5).remaining('xx' as 'fr')).toBe(0);
    expect(new RequestBudget({ fr: 2 }, 5).remaining('fr')).toBe(2);
  });

  it('refuse un poste inconnu et une limite non finie', () => {
    const b = new RequestBudget({ fr: Number.NaN } as Record<string, number>, 5);
    expect(b.take('fr')).toBe(false);
    expect(b.take('xx')).toBe(false);
    expect(new RequestBudget({ fr: 2 }, Number.NaN).take('fr')).toBe(false);
    expect(b.spentTotal).toBe(0);
  });
});
