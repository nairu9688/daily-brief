import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { announcedMp3, loadPublishInputs } from '../../publish/inputs';
import { audioReport, DAY, makeDay, MP3_BYTES } from './day';
import { stepReports } from './reports';

const mp3 = (dayDir: string, lang: string) => writeFileSync(join(dayDir, `Daily Brief ${DAY} ${lang}.mp3`), MP3_BYTES);
const langsOf = (dayDir: string) => loadPublishInputs(dayDir, DAY).audio.map((a) => a.lang);

describe('MP3 annoncés par audio-report.json (consigne du lot 5 : ancien fichier audio)', () => {
  it('ne prend que les MP3 que le rapport du passage annonce ; un ancien MP3 resté dans le dossier est ignoré', () => {
    const { dayDir } = makeDay({ audio: ['fr'] });
    mp3(dayDir, 'ES');
    const r = loadPublishInputs(dayDir, DAY);
    expect(r.audio.map((a) => a.lang)).toEqual(['fr']);
    expect(r.issues).toEqual([{ level: 'warning', lang: 'es', message: `Daily Brief ${DAY} ES.mp3 : non annoncé par audio-report.json de ce passage — édition publiée sans lecteur` }]);
  });

  it('sans audio-report.json : aucun MP3 publié, un avertissement par MP3 présent', () => {
    const { dayDir } = makeDay({ audio: ['fr', 'en'], audioReport: false });
    const r = loadPublishInputs(dayDir, DAY);
    expect(r.audio).toEqual([]);
    expect(r.issues.map((i) => i.lang)).toEqual(['fr', 'en']);
  });

  it('brief:audio en « invalid » (ancien fichier impossible à supprimer) : aucun MP3 publié', () => {
    const { dayDir } = makeDay({ audio: ['fr', 'en', 'es'], audioReport: false });
    writeFileSync(join(dayDir, 'audio-report.json'), audioReport(DAY, [], { exitCode: 2, status: 'invalid', issues: [{ level: 'error', message: `ancien fichier audio impossible à supprimer : Daily Brief ${DAY} FR.mp3 (EACCES)` }] }));
    expect(langsOf(dayDir)).toEqual([]);
  });

  it.each([
    ['d’une autre date', audioReport('2026-11-05', ['fr']), 'audio-report.json est celui du 2026-11-05 : MP3 ignorés'],
    ['illisible', '{ tronqué', /^audio-report\.json illisible \(/],
    ['antérieur au dernier brief:verify', audioReport(DAY, ['fr'], { generatedAt: `${DAY}T04:00:00.000Z` }), 'audio-report.json est antérieur au dernier brief:verify (ancien passage) : MP3 ignorés'],
  ])('rapport %s : MP3 ignorés avec un avertissement', (_label, text, message) => {
    const { dayDir } = makeDay({ audio: ['fr'], audioReport: false, extra: { ...stepReports(), 'audio-report.json': text } });
    const r = announcedMp3(dayDir, DAY);
    expect([...r.langs]).toEqual([]);
    expect(r.issues).toEqual([{ level: 'warning', message: typeof message === 'string' ? message : expect.stringMatching(message) }]);
    expect(langsOf(dayDir)).toEqual([]);
  });

  it('MP3 annoncé mais absent : avertissement, édition sans lecteur', () => {
    const { dayDir } = makeDay({ extra: { 'audio-report.json': audioReport(DAY, ['fr']) } });
    const r = loadPublishInputs(dayDir, DAY);
    expect(r.audio).toEqual([]);
    expect(r.issues).toEqual([{ level: 'warning', lang: 'fr', message: `Daily Brief ${DAY} FR.mp3 : annoncé par audio-report.json mais absent — édition publiée sans lecteur` }]);
  });

  it('rapport postérieur au contrôle et statut « degraded » : les MP3 annoncés sont pris', () => {
    const { dayDir } = makeDay({ audio: ['fr', 'es'], audioReport: false, extra: { ...stepReports(), 'audio-report.json': audioReport(DAY, ['fr', 'es'], { status: 'degraded' }) } });
    expect(langsOf(dayDir)).toEqual(['fr', 'es']);
  });
});
