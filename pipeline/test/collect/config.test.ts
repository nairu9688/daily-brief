import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { RUBRIC_KEYS } from '@daily-brief/schema';
import { RequestBudget } from '../../collect/budget';
import { CollectConfigSchema, loadCollectConfig } from '../../collect/config';
import { loadRubriques, RubriquesSchema, searchOf } from '../../collect/rubriques';
import { readDailyUsage, utcDay, writeDailyUsage } from '../../collect/usage-ledger';
import { lookupDomain, loadWhitelist, outletOf } from '../../lib/whitelist';
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

describe('diversité des médias lisibles en entier (R3)', () => {
  it('chaque édition puise dans au moins 6 médias full distincts (flux RSS ou Exa), pour qu’aucun ne dépasse ~30 %', () => {
    const wl = loadWhitelist(WHITELIST_PATH);
    const c = loadCollectConfig(CONFIG_PATH);
    const feeds = JSON.parse(readFileSync(repoPath('pipeline/config/feeds.json'), 'utf8')).feeds as { url: string; lang: 'fr' | 'en' | 'es' }[];
    for (const lang of ['fr', 'en', 'es'] as const) {
      const domains = new Set<string>();
      for (const d of c.exa.fullDomains[lang]) domains.add(lookupDomain(wl, `https://${d}/`)!.domain);
      for (const f of feeds.filter((x) => x.lang === lang)) {
        const e = lookupDomain(wl, f.url);
        if (e?.status === 'full') domains.add(e.domain);
      }
      expect(domains.size, `${lang} : ${[...domains].join(', ')}`).toBeGreaterThanOrEqual(6);
    }
  });

  it('les médias vérifiés les 19 et 20/11/2026 sont lisibles en entier ; payants ou fermés à l’agent ne le sont pas', () => {
    const wl = loadWhitelist(WHITELIST_PATH);
    for (const d of ['franceinfo.fr', '20minutes.fr', 'huffingtonpost.fr', 'theconversation.com', 'bbc.co.uk', 'theguardian.com', 'npr.org', '20minutos.es', 'europapress.es', 'elconfidencial.com']) {
      expect(lookupDomain(wl, `https://www.${d}/x`)?.status, d).toBe('full');
    }
    for (const d of ['france24.com', 'rfi.fr', 'publicsenat.fr', 'tf1info.fr', 'basta.media', 'lavanguardia.com', 'newtral.es', 'cadenaser.com']) {
      expect(lookupDomain(wl, `https://www.${d}/x`)?.status, d).toBe('full');
    }
    for (const d of ['ouest-france.fr', 'lemonde.fr', 'liberation.fr', 'leparisien.fr', 'humanite.fr', 'elpais.com', 'elmundo.es', 'abc.es', 'infolibre.es']) {
      expect(lookupDomain(wl, `https://www.${d}/x`)?.status, d).toBe('meta');
    }
  });

  it('au moins 9 médias full distincts en FR et en ES (identité normalisée : franceinfo.fr et francetvinfo.fr comptent pour un)', () => {
    const wl = loadWhitelist(WHITELIST_PATH);
    const c = loadCollectConfig(CONFIG_PATH);
    const feeds = JSON.parse(readFileSync(repoPath('pipeline/config/feeds.json'), 'utf8')).feeds as { url: string; lang: 'fr' | 'en' | 'es' }[];
    for (const lang of ['fr', 'es'] as const) {
      const keys = new Set<string>();
      for (const d of c.exa.fullDomains[lang]) keys.add(outletOf(wl, `https://${d}/`).key);
      for (const f of feeds.filter((x) => x.lang === lang)) if (lookupDomain(wl, f.url)?.status === 'full') keys.add(outletOf(wl, f.url).key);
      expect(keys.size, `${lang} : ${[...keys].join(', ')}`).toBeGreaterThanOrEqual(9);
    }
  });
});

describe('rubriques.json', () => {
  it('couvre les 9 rubriques dans les 3 langues', () => {
    const r = loadRubriques(repoPath('pipeline/editorial/rubriques.json'));
    expect(Object.keys(r).sort()).toEqual([...RUBRIC_KEYS].sort());
    for (const k of RUBRIC_KEYS) for (const l of ['fr', 'en', 'es'] as const) expect(r[k].keywords[l].length).toBeGreaterThan(0);
  });

  it('R2 : chaque requête Exa nomme le périmètre de son édition (US et UK en EN, España en ES)', () => {
    const r = loadRubriques(repoPath('pipeline/editorial/rubriques.json'));
    for (const k of RUBRIC_KEYS) {
      expect(r[k].exaQuery.en, k).toMatch(/\bUS and UK\b/);
      expect(r[k].exaQuery.es, k).toMatch(/España/);
    }
  });

  it('refuse plus de 10 mots-clés ou un mot-clé en double ; chaque paramètre search tient sous 300 caractères', () => {
    const raw = JSON.parse(readFileSync(repoPath('pipeline/editorial/rubriques.json'), 'utf8'));
    expect(RubriquesSchema.safeParse(raw).success).toBe(true);
    const dup = structuredClone(raw);
    dup.rubrics.eco.keywords.fr.push('Inflation');
    expect(RubriquesSchema.safeParse(dup).error?.issues[0].message).toBe('mot-clé en double');
    const long = structuredClone(raw);
    long.rubrics.eco.keywords.fr = Array.from({ length: 11 }, (_, i) => `mot${i}`);
    expect(RubriquesSchema.safeParse(long).success).toBe(false);
    const r = loadRubriques(repoPath('pipeline/editorial/rubriques.json'));
    for (const k of RUBRIC_KEYS) for (const l of ['fr', 'en', 'es'] as const) expect((searchOf(r[k], l) ?? '').length, `${k} ${l}`).toBeLessThan(300);
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
