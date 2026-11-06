import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { isKnownPrepaSubject, parseProgrammeSubjects } from '../../verify/prepa';
import { fixtureBrief, PROGRAMME_PATH } from '../helpers';

const subjects = parseProgrammeSubjects(readFileSync(PROGRAMME_PATH, 'utf8'));

describe('matières prépa (R9)', () => {
  it('lit titres et alias', () => {
    expect(subjects.get('cg')).toBe('Culture générale');
    expect(subjects.get('éco')).toBe('Éco-droit');
    expect(subjects.get('anglais lv1')).toBe('Anglais LV1');
  });

  it('reconnaît toutes les matières de la fixture', () => {
    const all = fixtureBrief().editions.flatMap((e) =>
      e.sections.flatMap((s) => s.stories.flatMap((st) => (st.prepa ? [st.prepa.subject] : []))),
    );
    expect(all.length).toBeGreaterThan(0);
    for (const s of all) expect(isKnownPrepaSubject(s, subjects), s).toBe(true);
  });

  it('refuse une matière hors programme', () => {
    expect(isKnownPrepaSubject('Physique', subjects)).toBe(false);
    expect(isKnownPrepaSubject('Anglais LV1 · Physique', subjects)).toBe(false);
    expect(isKnownPrepaSubject(' · ', subjects)).toBe(false);
  });

  it('tolère les fins de ligne CRLF', () => {
    const s = parseProgrammeSubjects('## Culture générale\r\nAlias : CG\r\n');
    expect(s.get('cg')).toBe('Culture générale');
  });

  it('reconnaît une matière en Unicode décomposé', () => {
    expect(isKnownPrepaSubject('E\u0301co', subjects)).toBe(true);
    expect(parseProgrammeSubjects('## E\u0301co-droit\n').get('éco-droit')).toBe('Éco-droit');
  });
});
