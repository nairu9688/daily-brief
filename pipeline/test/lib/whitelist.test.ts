import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { canReadFull, loadWhitelist, lookupDomain } from '../../lib/whitelist';
import { WHITELIST_PATH } from '../helpers';

const wl = loadWhitelist(WHITELIST_PATH);

describe('liste blanche (R1)', () => {
  it('autorise le texte intégral des domaines « full », sous-domaines compris', () => {
    expect(canReadFull(wl, 'https://fr.euronews.com/2026/11/06/x')).toBe(true);
    expect(canReadFull(wl, 'https://www.sudradio.fr/societe/x')).toBe(true);
    expect(canReadFull(wl, 'https://www.pbs.org/newshour/x')).toBe(true);
  });

  it('refuse les domaines « feed », « meta » et inconnus', () => {
    expect(canReadFull(wl, 'https://www.npr.org/x')).toBe(false);
    expect(canReadFull(wl, 'https://news.sky.com/story/x')).toBe(false);
    expect(canReadFull(wl, 'https://www.lemonde.fr/x')).toBe(false);
    expect(canReadFull(wl, 'https://www.bbc.co.uk/news/x')).toBe(false);
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
