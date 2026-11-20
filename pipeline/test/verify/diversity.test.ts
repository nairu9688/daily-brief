import { describe, expect, it } from 'vitest';
import type { Edition, SourceRef } from '@daily-brief/schema';
import { loadWhitelist } from '../../lib/whitelist';
import { displayOutlet, diversitySummary, formatDiversity, outletShares, storyOutletCount } from '../../verify/diversity';
import { fixtureEdition, WHITELIST_PATH } from '../helpers';

const wl = loadWhitelist(WHITELIST_PATH);
const src = (url: string, outlet = 'x'): SourceRef => ({ outlet, title: 't', url, lang: 'fr', readFull: true });

/** Édition FR du fixture dont les sources sont remplacées : un sujet par liste. */
function edition(stories: SourceRef[][], briefs: SourceRef[] = []): Edition {
  const ed = fixtureEdition('fr');
  const section = ed.sections[0];
  const model = section.stories[0];
  section.stories = stories.map((sources, i) => ({ ...structuredClone(model), id: `s${i}`, sources }));
  section.briefs = briefs;
  ed.sections = [section];
  return ed;
}

describe('R3 : un média = une clé normalisée', () => {
  it('deux domaines du même média ne font qu’un média par sujet (20/11/2026)', () => {
    const one = (urls: string[]) => storyOutletCount({ sources: urls.map((u) => src(u)) }, wl);
    expect(one(['https://www.bbc.com/news/a', 'https://www.bbc.co.uk/news/b'])).toBe(1);
    expect(one(['https://www.franceinfo.fr/a', 'https://www.francetvinfo.fr/b'])).toBe(1);
    expect(one(['https://www.eldiario.es/a', 'https://eldiario.es/b'])).toBe(1);
    expect(one(['https://fr.euronews.com/a', 'https://www.euronews.com/b'])).toBe(1);
    expect(one(['https://www.franceinfo.fr/a', 'https://www.rfi.fr/b'])).toBe(2);
  });

  it('les parts sont comptées par média, sous son nom affiché', () => {
    const ed = edition([[src('https://www.bbc.com/a'), src('https://www.bbc.co.uk/b'), src('https://www.npr.org/c')]], [src('https://feeds.bbci.co.uk/d')]);
    expect(outletShares(ed, wl)).toEqual([
      { key: 'bbc.co.uk', outlet: 'BBC News', sources: 3, share: 0.75 },
      { key: 'npr.org', outlet: 'NPR', sources: 1, share: 0.25 },
    ]);
  });
});

describe('displayOutlet', () => {
  it('un seul nom par média, en gardant un complément après un séparateur', () => {
    expect(displayOutlet(wl, 'eldiario.es', 'https://www.eldiario.es/x')).toBe('elDiario.es');
    expect(displayOutlet(wl, 'franceinfo.fr', 'https://www.francetvinfo.fr/x')).toBe('franceinfo');
    expect(displayOutlet(wl, 'bbc.com', 'https://www.bbc.com/x')).toBe('BBC News');
    expect(displayOutlet(wl, 'pbs.org', 'https://www.pbs.org/newshour/x')).toBe('PBS NewsHour');
    expect(displayOutlet(wl, 'Sud Radio · AFP', 'https://www.sudradio.fr/x')).toBe('Sud Radio · AFP');
    expect(displayOutlet(wl, 'sud radio · AFP', 'https://www.sudradio.fr/x')).toBe('Sud Radio · AFP');
    expect(displayOutlet(wl, 'Sud Radios', 'https://www.sudradio.fr/x')).toBe('Sud Radio');
    expect(displayOutlet(wl, 'La Libre Belgique', 'https://www.lalibre.be/x')).toBe('La Libre Belgique');
  });
});

describe('bilan R3 par édition', () => {
  it('sources, médias, médias en tête et sujets à un seul média', () => {
    const ed = edition(
      [
        [src('https://www.franceinfo.fr/a'), src('https://www.francetvinfo.fr/b')],
        [src('https://www.franceinfo.fr/c'), src('https://www.rfi.fr/d')],
        [src('https://www.france24.com/e'), src('https://www.lalibre.be/f')],
      ],
      [src('https://www.franceinfo.fr/g'), src('https://www.publicsenat.fr/h')],
    );
    const d = diversitySummary(ed, wl);
    expect(d).toEqual({
      sources: 8,
      outlets: 5,
      top: [
        { outlet: 'franceinfo', sources: 4, share: 0.5 },
        { outlet: 'France 24', sources: 1, share: 0.13 },
        { outlet: 'lalibre.be', sources: 1, share: 0.13 },
      ],
      overCap: ['franceinfo'],
      singleOutletStories: ['s0'],
    });
    expect(formatDiversity('fr', d)).toBe('R3 FR : 8 sources, 5 médias ; en tête : franceinfo 50 %, France 24 13 %, lalibre.be 13 % ; au-delà de 30 % : franceinfo ; 1 sujet à un seul média (s0)');
  });
});
