import { describe, expect, it } from 'vitest';
import { billedChars, chunkScript, MAX_CHUNK_BYTES, normalizeScript, TTS_MAX_REQUEST_BYTES, utf8Bytes } from '../../audio/chunk';
import { fixtureEdition } from '../helpers';

/** Propriétés de tout découpage : sous la limite, rien de perdu, aucun mot coupé. */
function expectSound(text: string, chunks: string[], max: number) {
  for (const c of chunks) {
    expect(utf8Bytes(c)).toBeLessThanOrEqual(max);
    expect(c).toBe(c.trim());
    expect(c).not.toBe('');
  }
  expect(chunks.join(' ')).toBe(normalizeScript(text));
}

describe('normalizeScript', () => {
  it('ramène toute suite d’espaces (insécables, fines, retours à la ligne) à une espace', () => {
    expect(normalizeScript('  Bonjour !\n\n« Daily\tBrief »  ')).toBe('Bonjour ! « Daily Brief »');
  });

  it('compose les accents (NFC)', () => {
    expect(normalizeScript('été')).toBe('été');
  });
});

describe('chunkScript', () => {
  it('limite de l’API : 5 000 octets ; morceaux de 4 500 octets au plus', () => {
    expect([TTS_MAX_REQUEST_BYTES, MAX_CHUNK_BYTES]).toEqual([5000, 4500]);
    expect(() => chunkScript('Bonjour.', 6000)).toThrow(/au-dessus de celle de l'API/);
  });

  it('un script court donne un seul morceau ; un script vide aucun', () => {
    expect(chunkScript('Bonjour. Voici le brief.')).toEqual(['Bonjour. Voici le brief.']);
    expect(chunkScript(' \n ')).toEqual([]);
  });

  it('les scripts de la fixture tiennent chacun en un morceau', () => {
    for (const lang of ['fr', 'en', 'es'] as const) {
      const script = fixtureEdition(lang).audioScript;
      const chunks = chunkScript(script);
      expect(chunks).toHaveLength(1);
      expectSound(script, chunks, MAX_CHUNK_BYTES);
    }
  });

  it('coupe aux fins de phrase : aucune phrase coupée quand chacune tient', () => {
    const sentences = Array.from({ length: 40 }, (_, i) => `Phrase numéro ${i + 1}, qui parle d’économie et de société.`);
    const text = sentences.join(' ');
    const chunks = chunkScript(text, 300);
    expect(chunks.length).toBeGreaterThan(5);
    expectSound(text, chunks, 300);
    for (const c of chunks) expect(c).toMatch(/\.$/);
    expect(chunks.flatMap((c) => c.match(/Phrase numéro \d+, qui parle d’économie et de société\./g) ?? [])).toEqual(sentences);
  });

  it('ne coupe pas après une abréviation ni une initiale', () => {
    const text = 'M. Macron a reçu J. D. Vance. Les EE. UU. ont répondu. Dr. Smith a signé.';
    expect(chunkScript(text, 40)).toEqual(['M. Macron a reçu J. D. Vance.', 'Les EE. UU. ont répondu.', 'Dr. Smith a signé.']);
  });

  it('une phrase trop longue est coupée aux virgules, puis entre les mots', () => {
    const text = `${'alpha beta gamma, '.repeat(20)}fin. Puis ${'mot '.repeat(60)}final.`;
    const chunks = chunkScript(text, 100);
    expectSound(text, chunks, 100);
    expect(chunks[0]).toMatch(/,$/);
  });

  it('garde les guillemets français et la ponctuation espagnole avec leur mot', () => {
    const fr = '« Nous ne céderons pas » , a-t-il dit . Puis : « Jamais ! »';
    const es = '¿ Qué pasará mañana ? ¡ Nadie lo sabe ! El Gobierno , sin embargo , confía .';
    for (const [text, max] of [
      [fr, 30],
      [es, 25],
    ] as const) {
      const chunks = chunkScript(text, max);
      expectSound(text, chunks, max);
      for (const c of chunks) expect(c).not.toMatch(/^[»!?,.:;]|[«¿¡]$/);
    }
    expect(chunkScript(es, 25)).toEqual(['¿ Qué pasará mañana ?', '¡ Nadie lo sabe !', 'El Gobierno ,', 'sin embargo , confía .']);
  });

  it('compte les octets UTF-8, pas les caractères', () => {
    const text = 'é'.repeat(30) + ' ' + 'é'.repeat(30);
    expect(chunkScript(text, 70)).toEqual(['é'.repeat(30), 'é'.repeat(30)]);
  });

  it('refuse un mot plus long que la limite plutôt que de le couper', () => {
    expect(() => chunkScript(`Début ${'x'.repeat(50)} fin.`, 40)).toThrow(/mot de 50 octets/);
  });

  it('un script de 450 mots se découpe sous la limite réelle sans rien perdre', () => {
    const text = Array.from({ length: 45 }, (_, i) => `Le sujet ${i} évoque la réforme « des retraites », le budget et l’Europe.`).join(' ');
    const chunks = chunkScript(text);
    expectSound(text, chunks, MAX_CHUNK_BYTES);
    expect(billedChars(chunks.join(' '))).toBe(billedChars(normalizeScript(text)));
  });

  it('billedChars compte les points de code', () => {
    expect(billedChars('été 😀')).toBe(5);
  });
});
