import type { MapSpec } from '@daily-brief/schema';
import { geoAlbersUsa, geoConicConformal, geoEqualEarth, type GeoProjection } from 'd3-geo';
import { countryByAlpha3, mainBounds, type Bounds, type CountryFeature } from './countries';
import { H, W } from './svg';

type Extent = [[number, number], [number, number]];

const FULL: Extent = [[12, 12], [W - 12, H - 12]];

/** Réglages repris de reference/mapgen2.mjs (cadrages validés sur la maquette). */
const CONIC = {
  'conic-france': { parallels: [44, 49], rotate: [-3, 0], bbox: [[-5.2, 41.3], [9.9, 51.1]], pad: [[150, 18], [W - 150, H - 18]] },
  'conic-spain': { parallels: [37, 43], rotate: [3.5, 0], bbox: [[-9.4, 35.9], [3.4, 43.8]], pad: [[60, 16], [W - 60, H - 16]] },
  'conic-europe': { parallels: [40, 55], rotate: [-12, 0], bbox: [[-10, 35.5], [41, 58]], pad: FULL },
} as const satisfies Record<string, { parallels: [number, number]; rotate: [number, number]; bbox: Bounds; pad: Extent }>;

const multiPoint = (b: Bounds) => ({ type: 'Feature' as const, properties: {}, geometry: { type: 'MultiPoint' as const, coordinates: [b[0], b[1]] } });

/** Union d'emprises ; null si la liste est vide. */
export function unionBounds(list: Bounds[]): Bounds | null {
  if (list.length === 0) return null;
  return list.reduce((a, b) => [
    [Math.min(a[0][0], b[0][0]), Math.min(a[0][1], b[0][1])],
    [Math.max(a[1][0], b[1][0]), Math.max(a[1][1], b[1][1])],
  ]);
}

/** Emprise des pays cités (métropoles) et des lieux du MapSpec. */
export function specBounds(spec: MapSpec): Bounds | null {
  const codes = [...(spec.focus ?? []), ...(spec.highlight ?? [])];
  const countries = codes.map(countryByAlpha3).filter((f): f is CountryFeature => f !== undefined).map(mainBounds);
  const places = spec.places.map((p): Bounds => [[p.lon, p.lat], [p.lon, p.lat]]);
  return unionBounds([...countries, ...places]);
}

export type Framing = { projection: GeoProjection; onlyCountry?: string };

/**
 * Projection et cadrage d'un MapSpec.
 * - France et Espagne : cadrages fixes du prototype.
 * - Europe : cadrage du prototype, élargi aux pays et lieux cités (latitude plafonnée à 71,5°).
 * - États-Unis : Albers USA (Alaska et Hawaï repositionnés), seul le territoire américain est dessiné.
 * - Monde : Equal Earth, cadré sur les pays et lieux cités (marge 20 %, au moins 30° × 20°), sinon sur le globe.
 */
export function framing(spec: MapSpec): Framing {
  switch (spec.projection) {
    case 'conic-france':
    case 'conic-spain':
    case 'conic-europe': {
      const c = CONIC[spec.projection];
      let bbox: Bounds = c.bbox as unknown as Bounds;
      if (spec.projection === 'conic-europe') {
        const extra = specBounds(spec);
        const u = unionBounds(extra ? [bbox, extra] : [bbox])!;
        bbox = [u[0], [u[1][0], Math.min(u[1][1], 71.5)]];
      }
      const proj = geoConicConformal()
        .parallels(c.parallels as unknown as [number, number])
        .rotate(c.rotate as unknown as [number, number])
        .fitExtent(c.pad as unknown as Extent, multiPoint(bbox));
      proj.clipExtent([[0, 0], [W, H]]);
      return { projection: proj };
    }
    case 'albers-usa': {
      const usa = countryByAlpha3('USA')!;
      return { projection: geoAlbersUsa().fitExtent([[24, 24], [W - 24, H - 24]], usa) as unknown as GeoProjection, onlyCountry: usa.id };
    }
    case 'world': {
      const b = specBounds(spec);
      const proj = geoEqualEarth();
      if (!b) proj.fitExtent(FULL, { type: 'Sphere' });
      else {
        const [[x0, y0], [x1, y1]] = b;
        const dx = Math.max((x1 - x0) * 0.2, (30 - (x1 - x0)) / 2, 0);
        const dy = Math.max((y1 - y0) * 0.2, (20 - (y1 - y0)) / 2, 0);
        proj.fitExtent(FULL, multiPoint([[Math.max(x0 - dx, -180), Math.max(y0 - dy, -85)], [Math.min(x1 + dx, 180), Math.min(y1 + dy, 85)]]));
      }
      proj.clipExtent([[0, 0], [W, H]]);
      return { projection: proj };
    }
  }
}
