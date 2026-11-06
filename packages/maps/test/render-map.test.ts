import { readFileSync } from 'node:fs';
import type { Brief, MapSpec } from '@daily-brief/schema';
import { describe, expect, it } from 'vitest';
import { renderMap } from '../src/render-map';

const brief: Brief = JSON.parse(readFileSync(new URL('../../../fixtures/brief-2026-11-06.json', import.meta.url), 'utf8'));
const fixtureMaps = brief.editions.flatMap((e) =>
  e.sections.flatMap((s) => s.stories.flatMap((st) => (st.visual.type === 'map' ? [{ id: st.id, caption: st.visual.caption, map: st.visual.map }] : []))),
);

const count = (svg: string, re: RegExp) => (svg.match(re) ?? []).length;

describe('renderMap', () => {
  it('rend toutes les cartes de la fixture', () => {
    expect(fixtureMaps.length).toBe(7);
    for (const m of fixtureMaps) {
      const svg = renderMap(m.map, m.caption);
      expect(svg, m.id).toMatch(/^<svg class="map" viewBox="0 0 640 400"/);
      expect(svg.length, m.id).toBeLessThan(400_000);
      expect(count(svg, /class="marker"/g), m.id).toBe(m.map.places.length);
      expect(svg, m.id).not.toMatch(/<path d="[^"]*\d\.\d[^"]*" class="land/);
    }
  });

  it('colore les pays cités : focus en doux, highlight en accent', () => {
    const fr1 = fixtureMaps.find((m) => m.id === '2026-11-06-fr-1')!;
    expect(count(renderMap(fr1.map, 'x'), /class="land focus-soft"/g)).toBe(1);
    const kyiv = fixtureMaps.find((m) => m.id === '2026-11-06-fr-3')!;
    expect(count(renderMap(kyiv.map, 'x'), /class="land focus"/g)).toBe(2);
  });

  it('dessine les cercles proportionnels et l’arc', () => {
    const fr1 = fixtureMaps.find((m) => m.id === '2026-11-06-fr-1')!;
    const svg = renderMap(fr1.map, 'x');
    expect(svg).toContain('r="18.4" class="bubble"');
    expect(count(svg, /class="pulse"/g)).toBe(0);
    const kyiv = fixtureMaps.find((m) => m.id === '2026-11-06-fr-3')!;
    expect(count(renderMap(kyiv.map, 'x'), /class="arc"/g)).toBe(1);
  });

  it('ne dessine que les États-Unis en Albers USA', () => {
    const us = fixtureMaps.find((m) => m.map.projection === 'albers-usa')!;
    expect(count(renderMap(us.map, 'x'), /class="land/g)).toBe(1);
  });

  it('élargit la carte Europe aux pays surlignés (Finlande)', () => {
    const dc = fixtureMaps.find((m) => m.id === '2026-11-06-fr-7')!;
    expect(count(renderMap(dc.map, 'x'), /class="land focus"/g)).toBe(8);
  });

  it('écarte les étiquettes de deux lieux proches', () => {
    const spec: MapSpec = {
      projection: 'conic-france',
      places: [
        { name: 'Montpellier', lon: 3.88, lat: 43.61 },
        { name: 'Sommières', lon: 4.09, lat: 43.78 },
      ],
    };
    // Boîtes des étiquettes : 7,8 px par caractère, 14 px de haut, à gauche si text-anchor="end".
    const boxes = [...renderMap(spec, 'x').matchAll(/<text x="([^"]+)" y="([^"]+)" class="maplabel" text-anchor="(\w+)">([^<]*)</g)].map((m) => {
      const [x, y, w] = [Number(m[1]), Number(m[2]), m[4].length * 7.8];
      return { x0: m[3] === 'end' ? x - w : x, x1: m[3] === 'end' ? x : x + w, y0: y - 11, y1: y + 3 };
    });
    expect(boxes).toHaveLength(2);
    const [a, b] = boxes;
    expect(a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1).toBe(false);
  });

  it('échappe les textes venus du JSON', () => {
    const spec: MapSpec = { projection: 'world', places: [{ name: 'A', lon: 2, lat: 48, label: '<script>&' }] };
    const svg = renderMap(spec, 'Carte "test"');
    expect(svg).toContain('&lt;script&gt;&amp;');
    expect(svg).toContain('aria-label="Carte &quot;test&quot;"');
  });

  it('rend une carte du monde sans lieu ni pays', () => {
    expect(renderMap({ projection: 'world', places: [] }, 'Monde')).toContain('class="land"');
  });

  it('est déterministe', () => {
    const m = fixtureMaps[0];
    expect(renderMap(m.map, m.caption)).toBe(renderMap(m.map, m.caption));
  });
});
