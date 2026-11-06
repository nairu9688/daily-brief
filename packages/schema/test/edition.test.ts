import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseBrief, parseEdition, type Brief, type Edition } from '../src';

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
    expect(parseEdition(e).success).toBe(false);
  });

  it('accepte une grille vide', () => {
    const e = edition('fr');
    e.sections[0].stories[0].stats = [];
    expect(parseEdition(e).success).toBe(true);
  });

  it('refuse un vocabulaire pour FR et un vocabulaire de 5 mots pour EN', () => {
    const fr = edition('fr');
    fr.vocab = structuredClone(edition('en').vocab);
    expect(parseEdition(fr).success).toBe(false);
    const en = edition('en');
    en.vocab!.items.pop();
    expect(parseEdition(en).success).toBe(false);
  });

  it('refuse une projection inconnue et un code pays non alpha-3', () => {
    const e = edition('fr');
    const v = e.sections[0].stories[0].visual;
    if (v.type !== 'map') throw new Error('la fixture doit commencer par une carte');
    v.map.focus = ['FR'];
    expect(parseEdition(e).success).toBe(false);
    v.map.focus = ['FRA'];
    (v.map as { projection: string }).projection = 'mercator';
    expect(parseEdition(e).success).toBe(false);
  });

  it('refuse un sujet sans source et un id de sujet en double', () => {
    const e = edition('fr');
    e.sections[0].stories[0].sources = [];
    expect(parseEdition(e).success).toBe(false);
    const d = edition('fr');
    d.sections[1].stories[0].id = d.sections[0].stories[0].id;
    expect(parseEdition(d).success).toBe(false);
  });
});
