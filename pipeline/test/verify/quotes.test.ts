import { describe, expect, it } from 'vitest';
import { normalizeForMatch } from '../../verify/normalize';
import { checkQuote, speakerSurname } from '../../verify/quotes';
import { fixtureEdition, sourceText } from '../helpers';

const sudradio = sourceText('sudradio-grogne-sociale.txt');
const pbs = sourceText('pbs-vance.txt');

describe('normalizeForMatch', () => {
  it('unifie apostrophes, guillemets, espaces insécables et espace avant ponctuation', () => {
    expect(normalizeForMatch('c’est pas “gagner ?”')).toBe(normalizeForMatch('c\'est pas "gagner?"'));
    expect(normalizeForMatch('575\u00a0000')).toBe('575 000');
  });
});

describe('speakerSurname', () => {
  it('extrait le nom de famille', () => {
    expect(speakerSurname('Sophie Binet · CGT')).toBe('Binet');
    expect(speakerSurname('J.D. Vance')).toBe('Vance');
    expect(speakerSurname('Aurora Gómez · Tu Nube Seca Mi Río (Espagne)')).toBe('Gómez');
  });
});

describe('checkQuote (R5)', () => {
  it('accepte la citation de Sophie Binet telle qu’écrite dans la fixture', () => {
    const quote = fixtureEdition('fr').sections[0].stories[0].quote!;
    expect(checkQuote(quote, sudradio)).toEqual({ ok: true });
  });

  it('rejette la paraphrase PBS attribuée à J.D. Vance', () => {
    const r = checkQuote(
      { text: 'the party would need to listen more closely to working families', speaker: 'J.D. Vance' },
      pbs,
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/paraphrase/);
  });

  it('rejette une vraie citation attribuée au mauvais orateur', () => {
    const r = checkQuote({ text: 'We had a tough night, no question about it', speaker: 'J.D. Vance' }, pbs);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/Vance/);
  });

  it('accepte la même citation avec le bon orateur', () => {
    expect(checkQuote({ text: 'We had a tough night, no question about it', speaker: 'John Thune · Senate' }, pbs)).toEqual({ ok: true });
  });

  it('rejette une citation retouchée et une source sans texte', () => {
    const touched = checkQuote({ text: 'La question posée aujourd’hui, c’est combien va-t-on gagner', speaker: 'Sophie Binet' }, sudradio);
    expect(touched.ok).toBe(false);
    expect(checkQuote({ text: 'x', speaker: 'y' }, undefined)).toEqual({ ok: false, reason: 'texte source indisponible' });
  });
});
