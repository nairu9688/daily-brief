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

  it('ne signale aucune carte des fixtures (R11)', () => {
    for (const lang of ['fr', 'en', 'es'] as const) {
      const r = verifyEdition(fixtureEdition(lang), ctx);
      expect(r.issues.filter((i) => i.rule === 'R11'), lang).toEqual([]);
    }
  });

  it('retire un lieu hors cadre et l’arc qui y mène (R11)', () => {
    const e = fixtureEdition('fr');
    const fr1 = e.sections.flatMap((s) => s.stories).find((s) => s.id === '2026-11-06-fr-1')!;
    if (fr1.visual.type !== 'map') throw new Error('fr-1 doit être une carte');
    fr1.visual.map.places.push({ name: 'Kyiv', lon: 30.5, lat: 50.45 });
    fr1.visual.map.arc = ['Paris', 'Kyiv'];
    const r = verifyEdition(e, ctx);
    const out = r.edition!.sections.flatMap((s) => s.stories).find((s) => s.id === '2026-11-06-fr-1')!;
    if (out.visual.type !== 'map') throw new Error('fr-1 doit rester une carte');
    expect(out.visual.map.places.map((p) => p.name)).toEqual(['Paris', 'Lyon']);
    expect(out.visual.map.arc).toBeUndefined();
    expect(r.issues).toContainEqual(expect.objectContaining({ rule: 'R11', level: 'fixed', storyId: '2026-11-06-fr-1', message: expect.stringContaining('Kyiv') }));
    expect(r.issues).toContainEqual(expect.objectContaining({ rule: 'R11', storyId: '2026-11-06-fr-1', message: expect.stringMatching(/^arc retiré/) }));
  });

  it('retire un code pays inconnu (R11)', () => {
    const e = fixtureEdition('fr');
    const fr1 = e.sections.flatMap((s) => s.stories).find((s) => s.id === '2026-11-06-fr-1')!;
    if (fr1.visual.type !== 'map') throw new Error('fr-1 doit être une carte');
    fr1.visual.map.focus = ['FRA', 'XXX'];
    fr1.visual.map.highlight = ['QQQ'];
    const r = verifyEdition(e, ctx);
    const out = r.edition!.sections.flatMap((s) => s.stories).find((s) => s.id === '2026-11-06-fr-1')!;
    if (out.visual.type !== 'map') throw new Error('fr-1 doit rester une carte');
    expect(out.visual.map.focus).toEqual(['FRA']);
    expect(out.visual.map.highlight).toEqual([]);
    const r11 = r.issues.filter((i) => i.rule === 'R11');
    expect(r11.map((i) => i.message)).toEqual([expect.stringContaining('XXX'), expect.stringContaining('QQQ')]);
  });

  it('retire un lieu en double sans bloquer l’édition, de façon idempotente (R11)', () => {
    const e = fixtureEdition('fr');
    const fr1 = e.sections.flatMap((s) => s.stories).find((s) => s.id === '2026-11-06-fr-1')!;
    if (fr1.visual.type !== 'map') throw new Error('fr-1 doit être une carte');
    fr1.visual.map.places.push({ name: 'Paris', lon: 5.37, lat: 43.3 });
    fr1.visual.map.arc = ['Lyon', 'Paris'];
    const r = verifyEdition(e, ctx);
    expect(r.edition).not.toBeNull();
    const out = r.edition!.sections.flatMap((s) => s.stories).find((s) => s.id === '2026-11-06-fr-1')!;
    if (out.visual.type !== 'map') throw new Error('fr-1 doit rester une carte');
    expect(out.visual.map.places.map((p) => [p.name, p.lon])).toEqual([['Paris', 2.35], ['Lyon', 4.84]]);
    expect(out.visual.map.arc).toEqual(['Lyon', 'Paris']);
    expect(r.issues).toContainEqual(expect.objectContaining({ rule: 'R11', level: 'fixed', storyId: '2026-11-06-fr-1', message: 'lieu en double retiré : Paris' }));
    const again = verifyEdition(r.edition, ctx);
    expect(again.issues.filter((i) => i.level === 'fixed')).toEqual([]);
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

  it('retire les chiffres dont la source n’est pas lue en entier après R2 (Infobae en ES)', () => {
    const url = 'https://www.infobae.com/espana/2026/11/06/x';
    const e = fixtureEdition('es');
    const story = e.sections.flatMap((s) => s.stories).find((s) => s.id === '2026-11-06-es-9')!;
    story.sources.push({ outlet: 'Infobae', title: 'Titre', url, lang: 'es', readFull: true });
    story.stats = story.stats.map((s) => ({ ...s, sourceUrl: url }));
    const texts = buildSourceTexts(
      [...fixtureArticles(), { url, text: '69 fallecidos en Urda. 2.ª tragedia en 9 meses. 197 escaños PP + Vox. 29N elecciones generales.' }],
      [],
    );
    const r = verifyEdition(e, { ...ctx, texts });
    const out = r.edition!.sections.flatMap((s) => s.stories).find((s) => s.id === '2026-11-06-es-9')!;
    expect(out.stats).toEqual([]);
    expect(r.issues).toContainEqual(expect.objectContaining({ rule: 'R2', storyId: story.id }));
    expect(r.issues).toContainEqual(expect.objectContaining({ rule: 'R6', storyId: story.id, level: 'fixed' }));
  });

  it('retire une citation dont la source est repassée en « titre + lien » par R1', () => {
    const url = 'https://www.lemonde.fr/politique/x';
    const e = fixtureEdition('fr');
    const story = e.sections.flatMap((s) => s.stories).find((s) => s.id === '2026-11-06-fr-1')!;
    story.sources.push({ outlet: 'Le Monde', title: 'Titre', url, lang: 'fr', readFull: true });
    story.quote = { text: 'nous irons jusqu’au bout de cette mobilisation sociale', speaker: 'Sophie Binet', translation: null, sourceUrl: url };
    const texts = buildSourceTexts(
      [...fixtureArticles(), { url, text: 'Sophie Binet a déclaré : « nous irons jusqu’au bout de cette mobilisation sociale ».' }],
      [],
    );
    const r = verifyEdition(e, { ...ctx, texts });
    const out = r.edition!.sections.flatMap((s) => s.stories).find((s) => s.id === story.id)!;
    expect(out.quote).toBeNull();
    expect(r.issues).toContainEqual(expect.objectContaining({ rule: 'R1', storyId: story.id }));
    expect(r.issues).toContainEqual(expect.objectContaining({ rule: 'R5', storyId: story.id, message: expect.stringContaining('pas lue en entier') }));
  });

  it('vérifie que le repli de requête photo est lui-même valide (M1)', () => {
    const e = fixtureEdition('fr');
    e.sections.flatMap((s) => s.stories).find((s) => s.id === '2026-11-06-fr-1')!.quote!.speaker = 'Jane Stadium';
    const spo = e.sections.find((s) => s.key === 'spo')!;
    spo.stories.push(e.sections.find((s) => s.key === 'eco')!.stories.splice(0, 1)[0]);
    spo.stories[0].visual = { type: 'photo', query: 'Stadium crowd' };
    const r = verifyEdition(e, ctx);
    expect(r.edition!.sections.find((s) => s.key === 'spo')!.stories[0].visual).toEqual({ type: 'photo', query: 'newspaper' });
  });

  it('est idempotent : contrôler une édition déjà contrôlée ne corrige plus rien', () => {
    const first = verifyEdition(fixtureEdition('fr'), ctx);
    const second = verifyEdition(first.edition, ctx);
    expect(second.issues.filter((i) => i.level === 'fixed')).toEqual([]);
  });

  it('ne laisse qu’une fois une URL dans les brèves, y compris après rétrogradation (M3)', () => {
    const url = 'https://www.lemonde.fr/eco/x';
    const e = fixtureEdition('fr');
    const eco = e.sections.find((s) => s.key === 'eco')!;
    eco.stories[0].sources = [{ outlet: 'Le Monde', title: 'Titre Le Monde', url, lang: 'fr', readFull: true }];
    eco.briefs.push({ outlet: 'Le Monde', title: 'Déjà là', url: 'https://lemonde.fr/eco/x/', lang: 'fr', readFull: false });
    const r = verifyEdition(e, ctx);
    const out = r.edition!.sections.find((s) => s.key === 'eco')!;
    expect(out.briefs.filter((b) => b.url.includes('lemonde.fr/eco/x'))).toHaveLength(1);
    expect(out.briefs.find((b) => b.url.includes('lemonde.fr/eco/x'))!.title).toBe('Déjà là');
  });
});
