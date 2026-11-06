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

describe('speakerSurname (particules)', () => {
  it('garde les particules du nom', () => {
    expect(speakerSurname('Marine Le Pen')).toBe('Le Pen');
    expect(speakerSurname('Ursula von der Leyen')).toBe('von der Leyen');
    expect(speakerSurname('Charles de Gaulle')).toBe('de Gaulle');
  });
});

describe('checkQuote (R5) : régressions', () => {
  const Q = 'the party would need to listen more closely to working families';
  const isOk = (text: string, source: string, speaker: string) => checkQuote({ text, speaker }, source).ok;

  it('rejette une paraphrase quand des guillemets ouverts traînent dans d’autres paragraphes', () => {
    const src = `"We will rebuild...\n\n"It starts tomorrow," Vance said.\n\nVance told reporters ${Q}.\n\nThune called it "a tough night".`;
    expect(isOk(Q, src, 'J.D. Vance')).toBe(false);
  });

  it('rejette une paraphrase quand un guillemet droit sert de symbole de pouces', () => {
    const src = `Vance, who stands 6'2" tall, said ${Q}. Thune said "we lost".`;
    expect(isOk(Q, src, 'J.D. Vance')).toBe(false);
  });

  it('ne confond pas « Vance » et « advance »', () => {
    const src = '"We had a tough night, no question about it," Thune said in advance of the vote.';
    expect(isOk('We had a tough night, no question about it', src, 'J.D. Vance')).toBe(false);
  });

  it('ne confond pas « Le Pen » et « pendant »', () => {
    const src = '« Nous avons mené une campagne très difficile », a dit un élu pendant la soirée.';
    expect(isOk('Nous avons mené une campagne très difficile', src, 'Marine Le Pen')).toBe(false);
  });

  it('compare mot entier : un fragment de mots est rejeté', () => {
    const src = '« Je ne suis pas d\'accord avec la réforme », dit Dupont.';
    const r = checkQuote({ text: "s pas d'accord avec la réforme", speaker: 'Dupont' }, src);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/introuvable/);
  });

  it('ignore les guillemets droits collés à une lettre ou un chiffre (pouces)', () => {
    expect(isOk(Q, `Vance, who stands 6'2" tall, said ${Q}, standing by a 12" screen.`, 'J.D. Vance')).toBe(false);
    expect(isOk(Q, `A 55" TV. Vance said ${Q}. Thune said "we lost" and "fine`, 'J.D. Vance')).toBe(false);
  });

  it('exige le nom complet quand le nom de famille est trop court', () => {
    const src = '« Nous avons mené une campagne très difficile », a dit un élu.';
    expect(isOk('Nous avons mené une campagne très difficile', src, 'Kim Jong Un')).toBe(false);
  });

  it('rejette une citation trop courte ou vide', () => {
    const r = checkQuote({ text: '“ ”', speaker: 'Dupont' }, '« Je ne suis pas d\'accord », dit Dupont.');
    expect(r).toEqual({ ok: false, reason: 'citation trop courte (3 mots et 15 caractères minimum)' });
  });

  it('accepte une vraie citation avec orateur à particule', () => {
    const src = '« Nous avons mené une campagne très difficile », a dit Marine Le Pen.';
    expect(isOk('Nous avons mené une campagne très difficile', src, 'Marine Le Pen')).toBe(true);
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
