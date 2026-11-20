import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { pickPhoto, pickRelevantPhoto } from '../../render/commons';
import { findPlaces } from '../../lib/places';
import { assessCandidate, queryProfile } from '../../render/relevance';
import { repoPath } from '../helpers';

/** Réponses réelles de l'API Commons, enregistrées le 20/11/2026 (métadonnées ObjectName, ImageDescription, Categories comprises). */
const iowa = JSON.parse(readFileSync(repoPath('fixtures/api/commons-debate-iowa.json'), 'utf8'));
const parliament = JSON.parse(readFileSync(repoPath('fixtures/api/commons-spain-parliament.json'), 'utf8'));

const ids = (places: ReturnType<typeof findPlaces>) => places.map((p) => `${p.country}:${p.id}`).sort();

describe('findPlaces', () => {
  it('pays, adjectifs (sur demande), États, villes ; le nom le plus long d’abord', () => {
    expect(ids(findPlaces('Spanish Parliament building', { demonyms: true }))).toEqual(['ES:spain']);
    expect(findPlaces('Spanish Parliament building', { demonyms: false })).toEqual([]);
    expect(ids(findPlaces('Albuquerque, New Mexico', { demonyms: true }))).toEqual(['US:new mexico']);
    expect(ids(findPlaces('broadcast by Iowa Public Television', { demonyms: false }))).toEqual(['US:iowa']);
    expect(ids(findPlaces('Congreso de los Diputados, Madrid (España)', { demonyms: false }))).toEqual(['ES:madrid', 'ES:spain']);
  });

  it('ignore les noms ambigus : Sierra Nevada, montaña, Georgia', () => {
    expect(findPlaces('Sierra Nevada, Granada', { demonyms: true }).map((p) => p.country)).toEqual([]);
    expect(findPlaces('Paisaje de montaña', { demonyms: true })).toEqual([]);
    expect(findPlaces('Atlanta skyline, Georgia', { demonyms: true }).map((p) => p.id)).toEqual(['atlanta']);
  });
});

describe('queryProfile', () => {
  it('mots significatifs (sans mots vides, au singulier) et lieux d’ancrage', () => {
    expect(queryProfile('television studio cameras debate')).toMatchObject({ terms: ['television', 'studio', 'camera', 'debate'], anchors: [] });
    const p = queryProfile('spain parliament building madrid');
    expect(p.terms).toEqual(['parliament', 'building']);
    expect(ids(p.anchors)).toEqual(['ES:madrid', 'ES:spain']);
  });
});

describe('le cas « pancartes de l’Iowa pour un débat espagnol » (20/11/2026)', () => {
  it('avant : la première photo libre de la réponse était prise, sans regarder ce qu’elle montre', () => {
    expect(pickPhoto(iowa)?.pageUrl).toBe('https://commons.wikimedia.org/wiki/File:10.26.2010_-scenes_from_a_rally-_284_365_(5120602428).jpg');
  });

  it('après : refusée dans les trois éditions, avec la requête d’origine comme avec une requête qui nomme l’Espagne', () => {
    for (const lang of ['es', 'fr', 'en'] as const) expect(pickRelevantPhoto(iowa, 'television studio cameras debate', lang), lang).toBeNull();
    expect(pickRelevantPhoto(iowa, 'television debate studio spain', 'es')).toBeNull();
  });

  it('les raisons : Iowa hors du pays attendu (ou dans une requête sans lieu) ; Espagne absente de la photo', () => {
    const page = iowa.query.pages[0];
    for (const lang of ['es', 'fr'] as const) {
      expect(assessCandidate(page, queryProfile('television studio cameras debate'), lang), lang).toMatchObject({ ok: false, reason: expect.stringMatching(/iowa/) });
    }
    expect(assessCandidate(page, queryProfile('debate spain'), 'es')).toMatchObject({ ok: false, reason: expect.stringMatching(/spain/) });
  });
});

describe('pickRelevantPhoto sur une vraie réponse (« spain parliament building madrid »)', () => {
  it('retient le bâtiment du Parlement espagnol, en tête d’un classement par pertinence', () => {
    const photo = pickRelevantPhoto(parliament, 'spain parliament building madrid', 'es');
    expect(photo?.pageUrl).toBe('https://commons.wikimedia.org/wiki/File:Spanish_Parliament_building_.jpg');
    // Même requête dans l'édition EN : les lieux de la requête l'emportent sur les pays implicites (US, UK).
    expect(pickRelevantPhoto(parliament, 'spain parliament building madrid', 'en')?.pageUrl).toBe(photo?.pageUrl);
  });

  it('écarte la photo d’un élu (catégorie « Politicians ») même prise devant le Parlement', () => {
    const page = parliament.query.pages.find((p: { title: string }) => p.title.includes('Zamarrón'));
    expect(assessCandidate(page, queryProfile('spain parliament building madrid'), 'es')).toMatchObject({ ok: false, reason: expect.stringMatching(/personne/) });
  });

  it('sans lieu dans la requête : pays implicite de l’édition ES ; aucun en FR, donc une photo située ailleurs est refusée', () => {
    expect(pickRelevantPhoto(parliament, 'parliament building', 'es')?.pageUrl).toBe('https://commons.wikimedia.org/wiki/File:Spanish_Parliament_building_.jpg');
    expect(pickRelevantPhoto(parliament, 'parliament building', 'fr')).toBeNull();
    expect(pickRelevantPhoto(parliament, 'parliament building france', 'fr')).toBeNull();
  });
});

describe('classement', () => {
  /** Page minimale au format de l'API (formatversion 2). */
  const page = (index: number, title: string, categories: string, description = '') => ({
    index,
    title: `File:${title}.jpg`,
    imageinfo: [
      {
        mime: 'image/jpeg', width: 2000, height: 1300, size: 500_000,
        url: `https://upload.wikimedia.org/wikipedia/commons/a/ab/${index}.jpg`,
        descriptionurl: `https://commons.wikimedia.org/wiki/File:${index}.jpg`,
        extmetadata: {
          Artist: { value: 'Auteur' }, LicenseShortName: { value: 'CC BY-SA 4.0' },
          ObjectName: { value: title }, Categories: { value: categories }, ImageDescription: { value: description },
        },
      },
    ],
  });

  it('préfère une vue neutre (bâtiment) à une scène d’événement (manifestation), même mieux classée par le moteur', () => {
    const json = { query: { pages: [page(1, 'Protest rally in front of the Spanish parliament', 'Protests in Madrid'), page(2, 'Spanish parliament building facade', 'Palacio de las Cortes')] } };
    expect(pickRelevantPhoto(json, 'spain parliament', 'es')?.pageUrl).toBe('https://commons.wikimedia.org/wiki/File:2.jpg');
  });

  it('sans aucun mot de la requête dans le titre ni les catégories : refusée, même si la description en contient', () => {
    const json = { query: { pages: [page(1, 'Scenes from a rally', 'Senate campaign, 2010', 'Supporters outside the studios before the television debate.')] } };
    expect(assessCandidate(json.query.pages[0], queryProfile('television studio debate'), 'fr')).toMatchObject({ ok: false, reason: expect.stringMatching(/titre ni les catégories/) });
    expect(pickRelevantPhoto(json, 'television studio debate', 'fr')).toBeNull();
  });

  it('refuse un portrait (catégorie au nom de la personne), un schéma ou une carte', () => {
    const person = page(1, 'Paloma Gázquez', 'Paloma Gázquez|July 2019 in Madrid', 'Paloma Gázquez leaves the Parliament building in Madrid.');
    expect(assessCandidate(person, queryProfile('spain parliament building madrid'), 'es')).toMatchObject({ ok: false, reason: expect.stringMatching(/personne/) });
    const map = page(2, 'Localización del edificio del Banco Hispano Americano (Madrid)', 'Maps of Madrid', 'Building in Madrid, Spain');
    expect(assessCandidate(map, queryProfile('bank building madrid'), 'es')).toMatchObject({ ok: false, reason: expect.stringMatching(/carte/) });
    const palace = page(3, 'Palacio de las Cortes (Madrid)', 'Palacio de las Cortes (Madrid)|Exterior of Palacio de las Cortes', 'The building of the Palacio de las Cortes in Madrid, the lower house of the Spanish Parliament');
    expect(assessCandidate(palace, queryProfile('spain parliament building madrid'), 'es')).toMatchObject({ ok: true });
  });

  it('refuse un pays différent nommé dans le titre ou les catégories, même si les mots correspondent', () => {
    const json = { query: { pages: [page(1, 'Parliament building in Lisbon', 'Assembleia da República, Portugal')] } };
    expect(pickRelevantPhoto(json, 'parliament building', 'es')).toBeNull();
    expect(pickRelevantPhoto(json, 'parliament building portugal', 'es')?.pageUrl).toBe('https://commons.wikimedia.org/wiki/File:1.jpg');
  });
});
