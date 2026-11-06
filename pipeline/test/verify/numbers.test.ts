import { describe, expect, it } from 'vitest';
import { checkStat } from '../../verify/numbers';
import { fixtureEdition, sourceText } from '../helpers';

const ok = (value: string, text: string) => checkStat({ value }, text).ok;

describe('checkStat (R6)', () => {
  it('valide les quatre chiffres du sujet fr-1 contre la dépêche Sud Radio', () => {
    const text = sourceText('sudradio-grogne-sociale.txt');
    for (const stat of fixtureEdition('fr').sections[0].stories[0].stats) {
      expect(checkStat(stat, text), stat.value).toEqual({ ok: true });
    }
  });

  it.each([
    ['575\u00a0000', 'on compte 575\u202f000 manifestants'],
    ['575 000', 'on compte 575,000 people'],
    ['65 000', 'dont 65.000 à Paris'],
    ['1,6 million', 'about 1.6 million marchers'],
    ['9 nov.', 'lundi 9 novembre'],
    ['+0,7 %', 'une hausse de 0,7 % sur le mois'],
    ['52 %', 'soit 52% des voix'],
    ['−20 %', 'une baisse de 20 pour cent'],
    ['70+', 'au moins 70 personnes évacuées'],
    ['285 mm', 'jusqu’à 285 mm à Conca'],
    ['+1,50 m', 'le Vidourle est monté de 1,50 mètre'],
    ['320 km/h', 'à 320 km/h en pointe'],
    ['176 Md€', '176 milliards d’euros'],
    ['14,6 M', '14,6 millones de pasajeros'],
    ['24.000', 'unos 24 000 empleos'],
    ['2.ª', 'la 2.ª dimisión'],
    ['$5bn', '$5bn in aid'],
    ['5 Md€', '5 milliards d’euros'],
  ])('trouve « %s » dans « %s »', (value, text) => {
    expect(ok(value, text)).toBe(true);
  });

  it.each([
    ['193', 'des cortèges dans tout le pays'],
    ['3 %', 'une hausse de 13 % du chiffre'],
    ['65 000', 'dont 650 000 au total'],
    ['9 nov.', 'lundi 9 décembre'],
    ['1,6 million', 'environ 16 millions'],
    ['2,5 %', 'soit 25 %'],
    ['1,50 m', 'un mur de 150 m'],
    ['500', '1 500 manifestants'],
    ['265 000', '1 265 000 électeurs'],
    ['6 millions', '1,6 million'],
    ['3 %', '0,3 %'],
    ['65', '65,5 %'],
    ['5 Md€', '5 milliards de dollars'],
  ])('rejette « %s » absent de « %s »', (value, text) => {
    expect(ok(value, text)).toBe(false);
  });

  it('rejette tout chiffre sans texte source', () => {
    expect(checkStat({ value: '43' }, undefined)).toEqual({ ok: false, reason: 'texte source indisponible' });
  });
});
