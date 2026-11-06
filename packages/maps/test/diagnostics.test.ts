import type { MapSpec } from '@daily-brief/schema';
import { describe, expect, it } from 'vitest';
import { countryByAlpha3, mapDiagnostics, placesInFrame, renderMap } from '../src';

describe('mapDiagnostics', () => {
  it('ne signale rien pour une carte saine', () => {
    const spec: MapSpec = { projection: 'conic-france', focus: ['FRA'], places: [{ name: 'Paris', lon: 2.35, lat: 48.86 }] };
    expect(mapDiagnostics(spec)).toEqual([]);
  });

  it('signale un lieu hors cadre, un code inconnu, un arc orphelin et un nom en double', () => {
    const spec: MapSpec = {
      projection: 'conic-france',
      focus: ['FRA', 'XXX'],
      highlight: ['ZZZ'],
      arc: ['Paris', 'Berlin'],
      places: [
        { name: 'Paris', lon: 2.35, lat: 48.86 },
        { name: 'Kyiv', lon: 30.5, lat: 50.45 },
        { name: 'Paris', lon: 5.37, lat: 43.3 },
      ],
    };
    const d = mapDiagnostics(spec);
    expect(d).toContainEqual(expect.stringMatching(/hors cadre.*Kyiv/));
    expect(d).toContainEqual(expect.stringMatching(/code pays inconnu.*XXX/));
    expect(d).toContainEqual(expect.stringMatching(/code pays inconnu.*ZZZ/));
    expect(d).toContainEqual(expect.stringMatching(/arc.*Berlin/));
    expect(d).toContainEqual(expect.stringMatching(/en double.*Paris/));
    expect(d).toHaveLength(5);
  });

  it('placesInFrame garde les lieux visibles', () => {
    const spec: MapSpec = {
      projection: 'albers-usa',
      places: [{ name: 'DC', lon: -77, lat: 38.9 }, { name: 'Paris', lon: 2.35, lat: 48.86 }],
    };
    expect(placesInFrame(spec).map((p) => p.name)).toEqual(['DC']);
  });

  it('signale un pays cité entièrement hors du cadre', () => {
    const europe = mapDiagnostics({ projection: 'conic-europe', highlight: ['USA', 'FRA'], places: [] });
    expect(europe).toEqual(['pays cité hors du cadre : USA']);
    expect(mapDiagnostics({ projection: 'conic-france', focus: ['FIN', 'DEU'], places: [] })).toEqual(['pays cité hors du cadre : FIN']);
    expect(mapDiagnostics({ projection: 'albers-usa', focus: ['USA', 'MEX'], places: [] })).toEqual(['pays cité hors du cadre : MEX']);
    // En projection monde, tout ce qui est cité est cadré.
    expect(mapDiagnostics({ projection: 'world', highlight: ['USA', 'NZL'], places: [] })).toEqual([]);
  });

  it('distingue un code inconnu d’un pays absent de l’atlas', () => {
    expect(mapDiagnostics({ projection: 'conic-europe', focus: ['QQQ', 'GIB'], places: [] })).toEqual([
      'code pays inconnu : QQQ',
      'pays absent de l’atlas (non dessiné) : GIB',
    ]);
    expect(mapDiagnostics({ projection: 'world', highlight: ['TUV'], places: [] })).toEqual(['pays absent de l’atlas (non dessiné) : TUV']);
  });

  it('dessine les régions d’outre-mer comme la France', () => {
    for (const code of ['GUF', 'REU', 'MYT', 'GLP', 'MTQ']) {
      expect(countryByAlpha3(code), code).toBe(countryByAlpha3('FRA'));
      expect(mapDiagnostics({ projection: 'world', focus: [code], places: [] }), code).toEqual([]);
    }
    // Un focus sur la Guyane surligne donc la France entière.
    const svg = renderMap({ projection: 'conic-france', focus: ['GUF'], places: [] }, 'x');
    expect((svg.match(/class="land focus-soft"/g) ?? []).length).toBe(1);
  });
});
