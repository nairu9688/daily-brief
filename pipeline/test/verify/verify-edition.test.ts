import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { loadWhitelist } from '../../lib/whitelist';
import { parseProgrammeSubjects } from '../../verify/prepa';
import { buildSourceTexts } from '../../verify/sources';
import { verifyEdition, type VerifyContext } from '../../verify/verify-edition';
import { fixtureArticles, fixtureEdition, PROGRAMME_PATH, WHITELIST_PATH } from '../helpers';

const ctx: VerifyContext = {
  texts: buildSourceTexts(fixtureArticles(), []),
  whitelist: loadWhitelist(WHITELIST_PATH),
  prepaSubjects: parseProgrammeSubjects(readFileSync(PROGRAMME_PATH, 'utf8')),
  openThreads: [],
};

describe('verifyEdition', () => {
  it('renvoie une erreur de schéma sans édition', () => {
    const e = fixtureEdition('fr');
    e.morningBrief = [];
    const r = verifyEdition(e, ctx);
    expect(r.edition).toBeNull();
    expect(r.issues[0]).toMatchObject({ rule: 'SCHEMA', level: 'error' });
  });

  it('garde la citation et les chiffres vérifiés du sujet fr-1', () => {
    const r = verifyEdition(fixtureEdition('fr'), ctx);
    const story = r.edition!.sections.flatMap((s) => s.stories).find((s) => s.id === '2026-11-06-fr-1')!;
    expect(story.quote?.speaker).toBe('Sophie Binet · CGT');
    expect(story.stats).toHaveLength(4);
    expect(story.divergences).toHaveLength(2);
  });

  it('retire citation et chiffres invérifiables, sans retirer le sujet', () => {
    const r = verifyEdition(fixtureEdition('fr'), ctx);
    const fr3 = r.edition!.sections.flatMap((s) => s.stories).find((s) => s.id === '2026-11-06-fr-3')!;
    expect(fr3.quote).toBeNull();
    expect(r.issues).toContainEqual(expect.objectContaining({ rule: 'R5', storyId: '2026-11-06-fr-3', level: 'fixed' }));
    expect(r.issues).toContainEqual(expect.objectContaining({ rule: 'R6', storyId: '2026-11-06-fr-2', level: 'fixed' }));
  });

  it('rétrograde en brève un sujet dont la seule source lue est hors liste blanche (R1 puis R4)', () => {
    const e = fixtureEdition('fr');
    const eco = e.sections.find((s) => s.key === 'eco')!;
    eco.stories[0].sources = [{ outlet: 'Le Monde', title: 'Titre Le Monde', url: 'https://www.lemonde.fr/eco/x', lang: 'fr', readFull: true }];
    const r = verifyEdition(e, ctx);
    const out = r.edition!.sections.find((s) => s.key === 'eco')!;
    expect(out.stories).toHaveLength(0);
    expect(out.briefs).toContainEqual(expect.objectContaining({ url: 'https://www.lemonde.fr/eco/x', readFull: false }));
    expect(r.issues.map((i) => i.rule)).toEqual(expect.arrayContaining(['R1', 'R4']));
  });

  it('retire les brèves Infobae de l’édition ES (R2)', () => {
    const r = verifyEdition(fixtureEdition('es'), ctx);
    const urls = r.edition!.sections.flatMap((s) => [...s.briefs, ...s.stories.flatMap((st) => st.sources)]).map((s) => s.url);
    expect(urls.some((u) => u.includes('infobae.com'))).toBe(false);
    expect(r.issues.filter((i) => i.rule === 'R2' && i.level === 'fixed').length).toBeGreaterThan(0);
  });

  it('remplace une requête photo qui nomme une personne (R11)', () => {
    const e = fixtureEdition('fr');
    const eco = e.sections.find((s) => s.key === 'eco')!;
    eco.stories[0].visual = { type: 'photo', query: 'binet speech' };
    const r = verifyEdition(e, ctx);
    const v = r.edition!.sections.find((s) => s.key === 'eco')!.stories[0].visual;
    expect(v).toEqual({ type: 'photo', query: 'city skyline' });
  });

  it('remet les libellés officiels des rubriques et retire les rubriques vides', () => {
    const e = fixtureEdition('fr');
    e.sections[0].title = 'Politique';
    e.sections.find((s) => s.key === 'dro')!.briefs = [];
    const r = verifyEdition(e, ctx);
    expect(r.edition!.sections[0].title).toBe('Politique & société');
    expect(r.edition!.sections.some((s) => s.key === 'dro')).toBe(false);
  });

  it('ne modifie pas l’objet reçu', () => {
    const e = fixtureEdition('fr');
    const before = JSON.stringify(e);
    verifyEdition(e, ctx);
    expect(JSON.stringify(e)).toBe(before);
  });
});
