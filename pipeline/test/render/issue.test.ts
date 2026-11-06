import { describe, expect, it } from 'vitest';
import { issueNumber, pdfFileName } from '../../render/issue';

describe('numéro et nom du PDF', () => {
  it('numérote depuis le lancement du 06/11/2026', () => {
    expect(issueNumber('2026-11-06')).toBe('001');
    expect(issueNumber('2026-11-07')).toBe('002');
    expect(issueNumber('2027-11-06')).toBe('366');
    expect(() => issueNumber('2026-11-05')).toThrow(/antérieure/);
  });

  it('nomme le PDF comme la spec §8.5', () => {
    expect(pdfFileName('2026-11-06')).toBe('Daily Brief 2026-11-06.pdf');
  });
});
