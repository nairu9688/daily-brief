import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { RUBRIC_KEYS } from '@daily-brief/schema';
import { RequestBudget } from '../../collect/budget';
import { CollectConfigSchema, loadCollectConfig } from '../../collect/config';
import { loadRubriques, searchOf } from '../../collect/rubriques';
import { readDailyUsage, utcDay, writeDailyUsage } from '../../collect/usage-ledger';
import { lookupDomain, loadWhitelist } from '../../lib/whitelist';
import { repoPath, WHITELIST_PATH } from '../helpers';

const CONFIG_PATH = repoPath('pipeline/config/collect.json');

describe('collect.json', () => {
  it('se charge et respecte le budget de la spec §4.1 (FR 25, EN 20, ES 20, similar 25, total 90)', () => {
    const c = loadCollectConfig(CONFIG_PATH);
    expect(c.primary).toBe('thenewsapi');
    expect(c.lightThreshold).toBe(15);
    expect(c.thenewsapi.budget).toEqual({ total: 90, fr: 25, en: 20, es: 20, similar: 25 });
  });

  it('refuse un total au-delà de 90, des postes qui dépassent le total et une clé inconnue', () => {
    const raw = JSON.parse(readFileSync(CONFIG_PATH, 'utf8'));
    const over = structuredClone(raw);
    over.thenewsapi.budget.total = 95;
    expect(CollectConfigSchema.safeParse(over).success).toBe(false);
    const sum = structuredClone(raw);
    sum.thenewsapi.budget.similar = 40;
    expect(CollectConfigSchema.safeParse(sum).success).toBe(false);
    expect(CollectConfigSchema.safeParse({ ...raw, primery: 'exa' }).success).toBe(false);
  });

  it('R1 : Exa ne demande le texte que sur des domaines au statut full', () => {
    const wl = loadWhitelist(WHITELIST_PATH);
    const c = loadCollectConfig(CONFIG_PATH);
    for (const domains of Object.values(c.exa.fullDomains)) {
      for (const d of domains) expect(lookupDomain(wl, `https://${d}/`)?.status, d).toBe('full');
    }
  });
});

describe('rubriques.json', () => {
  it('couvre les 9 rubriques dans les 3 langues', () => {
    const r = loadRubriques(repoPath('pipeline/editorial/rubriques.json'));
    expect(Object.keys(r).sort()).toEqual([...RUBRIC_KEYS].sort());
    for (const k of RUBRIC_KEYS) for (const l of ['fr', 'en', 'es'] as const) expect(r[k].keywords[l].length).toBeGreaterThan(0);
  });

  it('construit le paramètre search en OU, expressions entre guillemets', () => {
    const r = loadRubriques(repoPath('pipeline/editorial/rubriques.json'));
    expect(searchOf(r.pol, 'fr')).toBeNull();
    expect(searchOf(r.dro, 'fr')).toBe('justice | tribunal | procès | "Conseil constitutionnel" | loi | "Cour de cassation"');
  });
});

describe('budget de requêtes', () => {
  it('plafonne chaque poste et le total', () => {
    const b = new RequestBudget({ fr: 2, similar: 5 }, 3);
    expect([b.take('fr'), b.take('fr'), b.take('fr')]).toEqual([true, true, false]);
    expect(b.remaining('similar')).toBe(1);
    expect([b.take('similar'), b.take('similar')]).toEqual([true, false]);
    expect(b.usage()).toEqual({ fr: 2, similar: 1 });
    expect(b.spentTotal).toBe(3);
  });
});

describe('compteur quotidien TheNewsAPI', () => {
  it('reprend le compte du jour, repart de zéro le lendemain, se ferme si le fichier est illisible', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ledger-'));
    const path = join(dir, 'thenewsapi-usage.json');
    expect(readDailyUsage(path, '2026-11-06', 90)).toEqual({ used: 0 });
    writeDailyUsage(path, '2026-11-06', 42);
    expect(readDailyUsage(path, '2026-11-06', 90)).toEqual({ used: 42 });
    expect(readDailyUsage(path, '2026-11-07', 90)).toEqual({ used: 0 });
    writeFileSync(path, '{');
    const broken = readDailyUsage(path, '2026-11-06', 90);
    expect(broken.used).toBe(90);
    expect(broken.error).toMatch(/illisible/);
    expect(utcDay(new Date('2026-11-06T04:13:00+01:00'))).toBe('2026-11-06');
  });
});
