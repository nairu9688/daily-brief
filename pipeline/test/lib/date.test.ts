import { describe, expect, it } from 'vitest';
import { addDays, daysBetween } from '../../lib/date';

describe('calcul de dates', () => {
  it('addDays et daysBetween suivent le calendrier, changement de mois et d’heure compris', () => {
    expect(addDays('2026-11-06', -1)).toBe('2026-11-05');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
    expect(addDays('2026-10-25', 1)).toBe('2026-10-26');
    expect(daysBetween('2026-10-16', '2026-11-06')).toBe(21);
    expect(daysBetween('2026-11-06', '2026-11-05')).toBe(-1);
  });

  it('lève sur une date inexistante ou mal formée', () => {
    expect(() => addDays('2026-02-30', 1)).toThrow('date illisible');
    expect(() => daysBetween('hier', '2026-11-06')).toThrow('date illisible');
  });
});
