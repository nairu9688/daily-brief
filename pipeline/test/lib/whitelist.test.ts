import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { canReadFull, loadWhitelist, lookupDomain, outletOf } from '../../lib/whitelist';
import { WHITELIST_PATH } from '../helpers';

const wl = loadWhitelist(WHITELIST_PATH);

describe('liste blanche (R1)', () => {
  it('autorise le texte intégral des domaines « full », sous-domaines compris', () => {
    expect(canReadFull(wl, 'https://fr.euronews.com/2026/11/06/x')).toBe(true);
    expect(canReadFull(wl, 'https://www.sudradio.fr/societe/x')).toBe(true);
    expect(canReadFull(wl, 'https://www.pbs.org/newshour/x')).toBe(true);
  });

  it('refuse les domaines « feed », « meta » et inconnus', () => {
    expect(canReadFull(wl, 'https://thehill.com/x')).toBe(false);
    expect(canReadFull(wl, 'https://news.sky.com/story/x')).toBe(false);
    expect(canReadFull(wl, 'https://www.lemonde.fr/x')).toBe(false);
    expect(canReadFull(wl, 'https://elpais.com/espana/x')).toBe(false);
    expect(canReadFull(wl, 'https://inconnu.example/x')).toBe(false);
  });

  it('choisit l’entrée la plus spécifique', () => {
    expect(lookupDomain(wl, 'https://news.sky.com/x')?.status).toBe('feed');
    expect(lookupDomain(wl, 'https://www.infobae.com/x')?.country).toBe('AR');
  });
});

describe('robustesse', () => {
  it('traite une URL malformée comme inconnue, sans lever', () => {
    expect(canReadFull(wl, 'not a url')).toBe(false);
    expect(lookupDomain(wl, '')).toBeUndefined();
  });

  it('valide le fichier à la lecture', () => {
    const dir = mkdtempSync(join(tmpdir(), 'wl-'));
    const bad = join(dir, 'bad.json');
    writeFileSync(bad, JSON.stringify({ checkedAt: '2026-11-06', domains: [{ domain: 'x.com', country: 'fr', status: 'full' }] }));
    expect(() => loadWhitelist(bad)).toThrow();
    writeFileSync(bad, JSON.stringify({ checkedAt: '2026-11-06', domains: [{ domain: 'x.com', country: 'FR', status: 'oui' }] }));
    expect(() => loadWhitelist(bad)).toThrow();
  });
});

describe('identité des médias (R3, affichage)', () => {
  it('ramène les doublons du 20/11/2026 à un seul média, avec un nom affiché', () => {
    const same = (urls: string[], key: string, name: string) => {
      for (const u of urls) expect(outletOf(wl, u), u).toEqual({ key, name, known: true });
    };
    same(['https://www.eldiario.es/politica/x', 'https://eldiario.es/y'], 'eldiario.es', 'elDiario.es');
    same(['https://www.franceinfo.fr/x', 'https://www.francetvinfo.fr/y'], 'franceinfo.fr', 'franceinfo');
    same(['https://www.bbc.co.uk/news/x', 'https://www.bbc.com/news/y', 'https://feeds.bbci.co.uk/news/rss.xml'], 'bbc.co.uk', 'BBC News');
    same(['https://www.pbs.org/newshour/x'], 'pbs.org', 'PBS NewsHour');
    same(['https://fr.euronews.com/x', 'https://www.euronews.com/y'], 'euronews.com', 'Euronews');
    same(['https://www.aljazeera.com/x'], 'aljazeera.com', 'Al Jazeera');
    same(['https://www.sudradio.fr/x'], 'sudradio.fr', 'Sud Radio');
  });

  it('sameAs ne change jamais le statut R1 : bbci.co.uk reste « feed »', () => {
    expect(lookupDomain(wl, 'https://feeds.bbci.co.uk/x')?.status).toBe('feed');
    expect(canReadFull(wl, 'https://feeds.bbci.co.uk/x')).toBe(false);
  });

  it('hors liste : domaine enregistrable ; URL illisible : sans lever', () => {
    expect(outletOf(wl, 'https://www.lalibre.be/international/x')).toEqual({ key: 'lalibre.be', name: 'lalibre.be', known: false });
    expect(outletOf(wl, 'https://news.example.co.uk/x').key).toBe('example.co.uk');
    expect(outletOf(wl, 'pas une url')).toEqual({ key: 'pas une url', name: 'pas une url', known: false });
  });

  it('chaque domaine full ou feed a un nom de média ; aucun domaine en double', () => {
    for (const e of wl.domains) if (e.status !== 'meta' && !e.sameAs) expect(e.outlet, e.domain).toBeTruthy();
    expect(new Set(wl.domains.map((e) => e.domain)).size).toBe(wl.domains.length);
  });

  it('refuse un sameAs inconnu, en chaîne ou vers soi-même, et un domaine en double', () => {
    const dir = mkdtempSync(join(tmpdir(), 'wl-'));
    const file = join(dir, 'wl.json');
    const load = (domains: unknown[]) => {
      writeFileSync(file, JSON.stringify({ checkedAt: '2026-11-20', domains }));
      return () => loadWhitelist(file);
    };
    const a = { domain: 'a.fr', country: 'FR', status: 'full', outlet: 'A' };
    expect(load([a, { domain: 'b.fr', country: 'FR', status: 'full', sameAs: 'a.fr' }])).not.toThrow();
    expect(load([a, { domain: 'b.fr', country: 'FR', status: 'full', sameAs: 'z.fr' }])).toThrow(/sameAs/);
    expect(load([a, { domain: 'b.fr', country: 'FR', status: 'full', sameAs: 'b.fr' }])).toThrow(/sameAs/);
    expect(load([{ ...a, sameAs: 'b.fr' }, { domain: 'b.fr', country: 'FR', status: 'full', sameAs: 'c.fr' }, { domain: 'c.fr', country: 'FR', status: 'full' }])).toThrow(/sameAs/);
    expect(load([a, a])).toThrow(/double/);
  });
});
