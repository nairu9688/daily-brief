import { describe, expect, it } from 'vitest';
import type { RawArticle } from '@daily-brief/schema';
import { detectLang, dropWrongLanguage } from '../../collect/language';

const EN = 'The government demands effective regulation of AI to protect women and minors. The minister said that the plan was presented on Tuesday and that it will be debated by the parliament, which has to approve it before the end of the year.';
const ES = 'El Gobierno exige una regulación eficaz de la IA para proteger a las mujeres y a los menores. La ministra explicó que el plan se presentó el martes y que será debatido por el Congreso, que lo tiene que aprobar antes de que acabe el año.';
const FR = 'Le gouvernement exige une régulation efficace de l’IA pour protéger les femmes et les mineurs. La ministre a expliqué que le plan a été présenté mardi et qu’il sera débattu au Parlement, qui doit l’adopter avant la fin de l’année.';

const art = (lang: string, title: string, text: string | null, description: string | null = null): RawArticle => ({
  id: `${lang}-${title}`,
  url: `https://democrata.es/${title}`,
  outlet: 'Demócrata',
  title,
  description,
  lang,
  publishedAt: null,
  origin: 'exa',
  text,
});

describe('detectLang', () => {
  it('reconnaît un texte anglais, espagnol ou français', () => {
    expect(detectLang(EN)).toBe('en');
    expect(detectLang(ES)).toBe('es');
    expect(detectLang(FR)).toBe('fr');
  });

  it('ne tranche pas sur un texte trop court ou ambigu', () => {
    expect(detectLang('Ibex 35')).toBeUndefined();
    expect(detectLang('Pedro Sánchez, Alberto Núñez Feijóo')).toBeUndefined();
    expect(detectLang('')).toBeUndefined();
  });
});

describe('dropWrongLanguage', () => {
  it('écarte un article dont le texte est dans une autre langue que celle annoncée (democrata.es /en/ annoncé es)', () => {
    const list = [art('es', 'Spain calls for regulating AI to protect women and minors', EN), art('es', 'El Gobierno pide regular la IA', ES), art('en', 'AI rules', EN), art('fr', 'Régulation de l’IA', FR)];
    const { kept, dropped } = dropWrongLanguage(list);
    expect(kept.map((a) => a.title)).toEqual(['El Gobierno pide regular la IA', 'AI rules', 'Régulation de l’IA']);
    expect(dropped.map((a) => a.title)).toEqual(['Spain calls for regulating AI to protect women and minors']);
  });

  it('sans texte, juge sur le titre et le chapô ; garde l’article quand la langue est incertaine', () => {
    const list = [art('es', 'Strong fall of the Ibex 35', null, EN), art('es', 'Ibex 35', null), art('fr', 'Biden', null, null)];
    const { kept, dropped } = dropWrongLanguage(list);
    expect(kept.map((a) => a.title)).toEqual(['Ibex 35', 'Biden']);
    expect(dropped).toHaveLength(1);
  });

  it('garde une langue sans liste de mots (de, it…) : rien n’est écarté', () => {
    expect(dropWrongLanguage([art('de', 'Titel', EN)]).dropped).toHaveLength(0);
  });
});
