import type { MapSpec } from '@daily-brief/schema';
import { describe, expect, it } from 'vitest';
import { framing } from '../src/projections';
import { renderMap } from '../src/render-map';
import { H, W } from '../src/svg';

/** Cas limites relevés par la revue du lot 2 (sondes du relecteur). */

const count = (svg: string, re: RegExp) => (svg.match(re) ?? []).length;
const markers = (svg: string) => [...svg.matchAll(/<circle cx="([^"]+)" cy="([^"]+)" r="3.6" class="marker"/g)].map((m) => [Number(m[1]), Number(m[2])]);
const pathsOf = (svg: string, cls: string) => [...svg.matchAll(new RegExp(`<path d="([^"]+)" class="${cls}"/>`, 'g'))].map((m) => m[1]);
/** Sous-tracés d'un attribut d : listes de points [x, y]. */
const subpaths = (d: string) =>
  d
    .split(/(?=M)/)
    .map((s) => [...s.matchAll(/(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/g)].map((m) => [Number(m[1]), Number(m[2])]));
const inFrame = ([x, y]: number[]) => x >= 0 && x <= W && y >= 0 && y <= H;

describe('cadrage (revue 2)', () => {
  it('monde + Russie : la Russie est dessinée en entier dans le cadre', () => {
    const spec: MapSpec = { projection: 'world', highlight: ['RUS'], places: [] };
    const svg = renderMap(spec, 'x');
    const focus = pathsOf(svg, 'land focus');
    expect(focus).toHaveLength(1);
    for (const sp of subpaths(focus[0])) for (const p of sp) expect(inFrame(p)).toBe(true);
    const { projection } = framing(spec);
    // Kaliningrad mis à part : Moscou, Vladivostok, Anadyr et la pointe de la Tchoukotka (lon < -180).
    for (const lonlat of [[37.6, 55.75], [131.9, 43.1], [177.5, 64.7], [-170, 66]] as [number, number][]) {
      expect(inFrame(projection(lonlat)!), String(lonlat)).toBe(true);
    }
  });

  it('monde : Fidji et Samoa autour de l’antiméridien, arc sans saut', () => {
    const spec: MapSpec = {
      projection: 'world',
      places: [{ name: 'Fidji', lon: 178.4, lat: -18.1 }, { name: 'Samoa', lon: -172, lat: -13.8 }],
      arc: ['Fidji', 'Samoa'],
    };
    const svg = renderMap(spec, 'x');
    expect(markers(svg)).toHaveLength(2);
    const arc = pathsOf(svg, 'arc');
    expect(arc).toHaveLength(1);
    for (const sp of subpaths(arc[0])) {
      for (let i = 1; i < sp.length; i++) expect(Math.abs(sp[i][0] - sp[i - 1][0])).toBeLessThan(W / 2);
    }
    // Les deux îles ne sont pas aux deux bords opposés du monde entier : le cadre est resserré.
    const [[ax], [bx]] = markers(svg);
    expect(Math.abs(ax - bx)).toBeLessThan(W / 2);
  });

  it('monde : un arc près du pôle reste dessinable (latitude bornée)', () => {
    const spec: MapSpec = {
      projection: 'world',
      places: [{ name: 'A', lon: 0, lat: 85 }, { name: 'B', lon: 170, lat: 80 }],
      arc: ['A', 'B'],
    };
    const svg = renderMap(spec, 'x');
    expect(svg).not.toMatch(/NaN|Infinity/);
  });

  it('monde : pas d’arc entre deux antipodes (grand cercle indéfini)', () => {
    const spec: MapSpec = { projection: 'world', places: [{ name: 'A', lon: 0, lat: 0 }, { name: 'B', lon: 180, lat: 0 }], arc: ['A', 'B'] };
    expect(count(renderMap(spec, 'x'), /class="arc"/g)).toBe(0);
  });

  it('monde : un seul lieu donne un cadre fini', () => {
    const svg = renderMap({ projection: 'world', places: [{ name: 'Paris', lon: 2.35, lat: 48.86 }] }, 'x');
    expect(svg).not.toMatch(/NaN|Infinity/);
    expect(markers(svg)).toHaveLength(1);
  });

  it('pas d’arc si une extrémité est hors cadre', () => {
    const spec: MapSpec = {
      projection: 'conic-france',
      places: [{ name: 'Kyiv', lon: 30.5, lat: 50.45 }, { name: 'Paris', lon: 2.35, lat: 48.86 }],
      arc: ['Paris', 'Kyiv'],
    };
    expect(count(renderMap(spec, 'x'), /class="arc"/g)).toBe(0);
  });

  it('Europe : Reykjavik et Bakou sont tous deux dans le cadre', () => {
    const spec: MapSpec = {
      projection: 'conic-europe',
      places: [{ name: 'Reykjavik', lon: -21.9, lat: 64.1 }, { name: 'Bakou', lon: 49.9, lat: 40.4 }],
    };
    expect(markers(renderMap(spec, 'x'))).toHaveLength(2);
  });

  it('Europe : les États-Unis surlignés ne déforment pas la carte', () => {
    const spec: MapSpec = { projection: 'conic-europe', highlight: ['USA', 'FRA'], places: [] };
    const svg = renderMap(spec, 'x');
    expect(svg.length).toBeLessThan(250_000);
    const focus = pathsOf(svg, 'land focus');
    // Seule la France est visible ; si les États-Unis l'étaient, ce serait coupés au bord du cadre.
    for (const d of focus) {
      const pts = subpaths(d).flat();
      const onEdge = pts.some(([x, y]) => x <= 0 || x >= W || y <= 0 || y >= H);
      const xs = pts.map((p) => p[0]);
      expect(onEdge || Math.max(...xs) - Math.min(...xs) < W / 3).toBe(true);
    }
    expect(focus.length).toBeLessThanOrEqual(2);
    // Les États-Unis, hors de la fenêtre européenne, ne changent pas le cadrage.
    const scale = (s: MapSpec) => (framing(s).projection as unknown as { scale(): number }).scale();
    expect(scale(spec)).toBeCloseTo(scale({ projection: 'conic-europe', highlight: ['FRA'], places: [] }), 6);
  });

  it('Europe : un lieu lointain (Tokyo) reste hors cadre sans élargir la carte', () => {
    const spec: MapSpec = {
      projection: 'conic-europe',
      places: [{ name: 'Tokyo', lon: 139.7, lat: 35.7 }, { name: 'Paris', lon: 2.35, lat: 48.86 }],
    };
    const svg = renderMap(spec, 'x');
    expect(svg.length).toBeLessThan(250_000);
    expect(markers(svg)).toHaveLength(1);
  });
});
