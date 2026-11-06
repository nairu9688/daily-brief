import type { MapSpec } from '@daily-brief/schema';
import { describe, expect, it } from 'vitest';
import { mapDiagnostics, placesInFrame } from '../src';

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
});
