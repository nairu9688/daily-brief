import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { LANGUAGE_CODES, loadVoices, VOICES_PATH } from '../../audio/voices';

const base = {
  confirmed: true,
  fr: { languageCode: 'fr-FR', name: 'fr-FR-Chirp3-HD-Aoede' },
  en: { languageCode: 'en-GB', name: 'en-GB-Chirp3-HD-Charon', speakingRate: 1.1 },
  es: { languageCode: 'es-ES', name: 'es-ES-Chirp3-HD-Kore' },
};

function write(cfg: unknown): string {
  const path = join(mkdtempSync(join(tmpdir(), 'voices-')), 'voices.json');
  writeFileSync(path, typeof cfg === 'string' ? cfg : JSON.stringify(cfg));
  return path;
}

describe('voices.json', () => {
  it('le fichier du dépôt est valide : une voix Chirp 3 HD par édition, non encore confirmée', () => {
    const v = loadVoices();
    expect(VOICES_PATH).toMatch(/pipeline\/config\/voices\.json$/);
    expect(v.confirmed).toBe(false);
    for (const lang of ['fr', 'en', 'es'] as const) {
      expect(LANGUAGE_CODES[lang]).toContain(v[lang].languageCode);
      expect(v[lang].name).toMatch(new RegExp(`^${v[lang].languageCode}-Chirp3-HD-`));
    }
  });

  it('accepte en-US ou en-GB pour l’anglais, et un débit de parole', () => {
    expect(loadVoices(write(base)).en).toEqual({ languageCode: 'en-GB', name: 'en-GB-Chirp3-HD-Charon', speakingRate: 1.1 });
  });

  it('refuse une variante régionale non prévue, une voix d’une autre langue ou d’une autre famille', () => {
    expect(() => loadVoices(write({ ...base, fr: { languageCode: 'fr-CA', name: 'fr-CA-Chirp3-HD-Aoede' } }))).toThrow(/fr\.languageCode fr : fr-FR attendu/);
    expect(() => loadVoices(write({ ...base, es: { languageCode: 'es-ES', name: 'es-US-Chirp3-HD-Kore' } }))).toThrow(/es\.name es : la voix doit être de es-ES/);
    expect(() => loadVoices(write({ ...base, fr: { languageCode: 'fr-FR', name: 'fr-FR-Neural2-A' } }))).toThrow(/voix Chirp 3 HD attendue/);
  });

  it('refuse un débit hors bornes, une clé inconnue, un champ manquant ou un JSON illisible', () => {
    expect(() => loadVoices(write({ ...base, fr: { ...base.fr, speakingRate: 3 } }))).toThrow(/voices\.json invalide : fr\.speakingRate/);
    expect(() => loadVoices(write({ ...base, de: base.fr }))).toThrow(/voices\.json invalide/);
    expect(() => loadVoices(write({ fr: base.fr, en: base.en, es: base.es }))).toThrow(/confirmed/);
    expect(() => loadVoices(write('{ pas du json'))).toThrow(/voices\.json illisible/);
  });
});
