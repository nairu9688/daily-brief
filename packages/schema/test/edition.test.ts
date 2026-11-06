import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { BriefSchema, parseBrief, parseEdition, type Brief, type Edition } from '../src';

const fixture: Brief = JSON.parse(
  readFileSync(new URL('../../../fixtures/brief-2026-11-06.json', import.meta.url), 'utf8'),
);
const edition = (lang: 'fr' | 'en' | 'es'): Edition => structuredClone(fixture.editions.find((e) => e.lang === lang)!);

describe('schéma Edition', () => {
  it('valide la fixture réelle du 06/11/2026', () => {
    const r = parseBrief(fixture);
    if (!r.success) throw new Error(r.errors.join('\n'));
    expect(r.data.editions).toHaveLength(3);
  });

  it('exige exactement 5 infos dans le Morning Brief', () => {
    const e = edition('fr');
    e.morningBrief.pop();
    const r = parseEdition(e);
    expect(r.success).toBe(false);
    if (!r.success) expect(r.errors.join()).toMatch(/exactement 5/);
  });

  it('refuse une grille de 3 chiffres', () => {
    const e = edition('fr');
    e.sections[0].stories[0].stats.pop();
    const r = parseEdition(e);
    expect(r.success).toBe(false);
    if (!r.success) expect(r.errors.join()).toMatch(/0 ou 4/);
  });

  it('accepte une grille vide', () => {
    const e = edition('fr');
    e.sections[0].stories[0].stats = [];
    expect(parseEdition(e).success).toBe(true);
  });

  it('refuse un vocabulaire pour FR et un vocabulaire de 5 mots pour EN', () => {
    const fr = edition('fr');
    fr.vocab = structuredClone(edition('en').vocab);
    const rfr = parseEdition(fr);
    expect(rfr.success).toBe(false);
    if (!rfr.success) expect(rfr.errors.join()).toMatch(/vocab/);
    const en = edition('en');
    en.vocab!.items.pop();
    const ren = parseEdition(en);
    expect(ren.success).toBe(false);
    if (!ren.success) expect(ren.errors.join()).toMatch(/vocab/);
  });

  it('refuse une projection inconnue et un code pays non alpha-3', () => {
    const e = edition('fr');
    const v = e.sections[0].stories[0].visual;
    if (v.type !== 'map') throw new Error('la fixture doit commencer par une carte');
    v.map.focus = ['FR'];
    const rf = parseEdition(e);
    expect(rf.success).toBe(false);
    if (!rf.success) expect(rf.errors.join()).toMatch(/alpha-3/);
    v.map.focus = ['FRA'];
    (v.map as { projection: string }).projection = 'mercator';
    expect(parseEdition(e).success).toBe(false);
  });

  it('refuse un sujet sans source et un id de sujet en double', () => {
    const e = edition('fr');
    e.sections[0].stories[0].sources = [];
    const rs = parseEdition(e);
    expect(rs.success).toBe(false);
    if (!rs.success) expect(rs.errors.join()).toMatch(/au moins une source/);
    const d = edition('fr');
    d.sections[1].stories[0].id = d.sections[0].stories[0].id;
    const rd = parseEdition(d);
    expect(rd.success).toBe(false);
    if (!rd.success) expect(rd.errors.join()).toMatch(/id de sujet en double/);
  });

  it('refuse les URL non http(s)', () => {
    for (const url of ['javascript:alert(1)', 'ftp://x.org/a']) {
      const e = edition('fr');
      e.sections[0].stories[0].sources[0].url = url;
      expect(parseEdition(e).success).toBe(false);
    }
  });

  it('refuse une date impossible', () => {
    const e = edition('fr');
    e.date = '2026-13-45';
    expect(parseEdition(e).success).toBe(false);
  });

  it('refuse une clé mal orthographiée (objets stricts)', () => {
    const e = edition('fr');
    (e.morningBrief[0] as Record<string, unknown>).storyID = 'x';
    expect(parseEdition(e).success).toBe(false);
  });

  it('refuse une rubrique en double', () => {
    const e = edition('fr');
    e.sections[1].key = e.sections[0].key;
    const r = parseEdition(e);
    expect(r.success).toBe(false);
    if (!r.success) expect(r.errors.join()).toMatch(/rubrique en double/);
  });

  it('parseEdition(null) renvoie une erreur à la racine', () => {
    const r = parseEdition(null);
    expect(r.success).toBe(false);
    if (!r.success) expect(r.errors[0]).toMatch(/^\(racine\)/);
  });
});

describe('schéma Brief', () => {
  it('refuse une langue en double', () => {
    const b = structuredClone(fixture);
    b.editions[1].lang = 'fr';
    const r = BriefSchema.safeParse(b);
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues.map((i) => i.message).join()).toMatch(/éditions fr, en et es/);
  });

  it('refuse une date d’édition différente de celle du brief', () => {
    const b = structuredClone(fixture);
    b.editions[0].date = '2026-11-05';
    const r = BriefSchema.safeParse(b);
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues.map((i) => i.message).join()).toMatch(/date d’édition incohérente/);
  });
});
