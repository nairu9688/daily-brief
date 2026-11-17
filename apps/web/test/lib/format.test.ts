import { describe, expect, it } from 'vitest';
import { addDays, headerDate, isIsoDate, longDateFr, monthFr, parisTime, parisToday, shortDate } from '@/lib/dates';
import { CHIP_LABELS, favColor, initials, T, uniqueOutlets } from '@/lib/i18n';

describe('dates', () => {
  it('formate comme la maquette', () => {
    expect(headerDate('2026-11-06')).toBe('VEN 06.11.26');
    expect(shortDate('2026-11-06', 'fr')).toBe('Ven. 6 nov.');
    expect(shortDate('2026-11-05', 'en')).toBe('Thu 5 Nov');
    expect(shortDate('2026-11-03', 'es')).toBe('Mar 3 nov');
    expect(longDateFr('2026-11-06')).toBe('vendredi 6 novembre 2026');
    expect(monthFr('2026-11')).toBe('novembre 2026');
  });

  it('prend la date et l’heure de Paris, pas celles du serveur', () => {
    expect(parisToday(new Date('2026-11-06T23:30:00Z'))).toBe('2026-11-07');
    expect(parisTime('2026-11-06T04:41:00Z')).toBe('05:41');
  });

  it('valide et décale les dates civiles', () => {
    expect(isIsoDate('2026-11-06')).toBe(true);
    expect(isIsoDate('2026-02-30')).toBe(false);
    expect(isIsoDate('06/11/2026')).toBe(false);
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
  });
});

describe('libellés', () => {
  it('reprend les pastilles et initiales du prototype', () => {
    expect(favColor('Sud Radio · AFP')).toBe('#8A2E62');
    expect(favColor('Euronews')).toBe('#B8860B');
    expect(favColor('Sud Radio')).toBe('#0F3B85');
    expect(initials('Sud Radio · AFP')).toBe('SR');
    expect(initials('elDiario.es')).toBe('E');
    expect(uniqueOutlets([{ outlet: 'A' }, { outlet: 'B' }, { outlet: 'A' }])).toEqual(['A', 'B']);
  });

  it('a les libellés des trois éditions et des neuf puces', () => {
    expect(T.fr.subjects(1)).toBe('1 sujet');
    expect(T.en.subjects(2)).toBe('2 stories');
    expect(T.es.episodes(3)).toBe('3 episodios');
    for (const lang of ['fr', 'en', 'es'] as const) expect(Object.keys(CHIP_LABELS[lang])).toHaveLength(9);
  });
});
