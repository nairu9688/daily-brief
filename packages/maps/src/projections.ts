import type { Feature, FeatureCollection, Geometry, MultiPoint } from 'geojson';
import type { MapSpec } from '@daily-brief/schema';
import { geoAlbersUsa, geoBounds, geoConicConformal, geoEqualEarth, geoPath, type GeoProjection } from 'd3-geo';
import { countryByAlpha3, mainBounds, mainPolygons, type Bounds, type CountryFeature } from './countries';
import { H, W } from './svg';

type Extent = [[number, number], [number, number]];

const FULL: Extent = [[12, 12], [W - 12, H - 12]];

/** Réglages repris de reference/mapgen2.mjs (cadrages validés sur la maquette). */
const CONIC = {
  'conic-france': { parallels: [44, 49], rotate: [-3, 0], bbox: [[-5.2, 41.3], [9.9, 51.1]], pad: [[150, 18], [W - 150, H - 18]] },
  'conic-spain': { parallels: [37, 43], rotate: [3.5, 0], bbox: [[-9.4, 35.9], [3.4, 43.8]], pad: [[60, 16], [W - 60, H - 16]] },
  'conic-europe': { parallels: [40, 55], rotate: [-12, 0], bbox: [[-10, 35.5], [41, 58]], pad: FULL },
} as const satisfies Record<string, { parallels: [number, number]; rotate: [number, number]; bbox: Bounds; pad: Extent }>;

/** Fenêtre de la carte Europe : pays et lieux cités n'élargissent le cadre qu'à l'intérieur. */
export const EUROPE_WINDOW: Bounds = [[-25, 33], [50, 71.5]];

/**
 * Points d'ajustement d'une emprise : les 4 coins et les 4 milieux des côtés.
 * En conique, les parallèles sont courbes : le milieu du bord sud descend plus bas que ses coins.
 */
function fitPoints([[x0, y0], [x1, y1]]: Bounds): Feature<MultiPoint> {
  const xm = (x0 + x1) / 2;
  const ym = (y0 + y1) / 2;
  const coordinates = [[x0, y0], [xm, y0], [x1, y0], [x1, ym], [x1, y1], [xm, y1], [x0, y1], [x0, ym]];
  return { type: 'Feature', properties: {}, geometry: { type: 'MultiPoint', coordinates } };
}

/**
 * Emprise `b` restreinte à la fenêtre `w`, ou null si elle est entièrement dehors.
 * `b` peut traverser l'antiméridien (x0 > x1) : elle est alors coupée en deux intervalles.
 */
export function clampToWindow(b: Bounds, w: Bounds): Bounds | null {
  const y0 = Math.max(b[0][1], w[0][1]);
  const y1 = Math.min(b[1][1], w[1][1]);
  if (y0 > y1) return null;
  const parts: [number, number][] = b[0][0] <= b[1][0] ? [[b[0][0], b[1][0]]] : [[b[0][0], 180], [-180, b[1][0]]];
  const kept = parts.map(([a, c]) => [Math.max(a, w[0][0]), Math.min(c, w[1][0])]).filter(([a, c]) => a <= c);
  if (kept.length === 0) return null;
  return [[Math.min(...kept.map((k) => k[0])), y0], [Math.max(...kept.map((k) => k[1])), y1]];
}

const citedCountries = (spec: MapSpec): CountryFeature[] =>
  [...(spec.focus ?? []), ...(spec.highlight ?? [])].map(countryByAlpha3).filter((f): f is CountryFeature => f !== undefined);

const within = (b: Bounds, w: Bounds) => b[0][0] <= b[1][0] && b[0][0] >= w[0][0] && b[1][0] <= w[1][0] && b[0][1] >= w[0][1] && b[1][1] <= w[1][1];

/**
 * Ce que la carte Europe doit montrer, dans la fenêtre : les lieux, les polygones principaux
 * des pays qui y tiennent, et pour les autres les 4 coins et 4 milieux de leur emprise
 * restreinte à la fenêtre. Ce qui est entièrement hors fenêtre est ignoré.
 */
function europeTargets(spec: MapSpec): Feature<Geometry>[] {
  const out: Feature<Geometry>[] = [];
  for (const f of citedCountries(spec)) {
    const b = mainBounds(f);
    if (within(b, EUROPE_WINDOW)) out.push(mainPolygons(f));
    else {
      const c = clampToWindow(b, EUROPE_WINDOW);
      if (c) out.push(fitPoints(c));
    }
  }
  for (const p of spec.places) {
    if (clampToWindow([[p.lon, p.lat], [p.lon, p.lat]], EUROPE_WINDOW)) out.push(point(p.lon, p.lat));
  }
  return out;
}

const point = (lon: number, lat: number): Feature<Geometry> => ({ type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: [lon, lat] } });

/** Pays cités (polygones principaux) et lieux, en une collection GeoJSON ; null si rien à cadrer. */
export function specFeatures(spec: MapSpec): FeatureCollection<Geometry> | null {
  const features: Feature<Geometry>[] = [
    ...citedCountries(spec).map(mainPolygons),
    ...spec.places.map((p) => point(p.lon, p.lat)),
  ];
  return features.length ? { type: 'FeatureCollection', features } : null;
}

/** Longitude centrale d'une emprise, y compris quand elle traverse l'antiméridien (x0 > x1). */
export function centreLon([[x0], [x1]]: Bounds): number {
  const c = x0 <= x1 ? (x0 + x1) / 2 : (x0 + x1 + 360) / 2;
  return c > 180 ? c - 360 : c;
}

const SPHERE = { type: 'Sphere' } as const;
const clampLat = (lat: number) => Math.max(-89, Math.min(89, lat));

/**
 * Equal Earth tournée sur le centre des pays et lieux cités, ajustée sur eux
 * (comme `fitExtent(FULL, fc)`), puis dézoomée : marge de 20 %, et au moins
 * 30° × 20° visibles autour du centre. Au-delà du globe entier, cadre le globe.
 */
function worldProjection(spec: MapSpec): GeoProjection {
  const fc = specFeatures(spec);
  if (!fc) return geoEqualEarth().fitExtent(FULL, SPHERE);
  const b = geoBounds(fc) as Bounds;
  const lon0 = centreLon(b);
  const lat0 = (b[0][1] + b[1][1]) / 2;
  const proj = geoEqualEarth().rotate([-lon0, 0]).scale(1).translate([0, 0]);
  const path = geoPath(proj);
  const w = FULL[1][0] - FULL[0][0];
  const h = FULL[1][1] - FULL[0][1];
  const fit = ([[x0, y0], [x1, y1]]: Extent) => Math.min(w / (x1 - x0), h / (y1 - y0)); // Infinity pour un point seul
  const target = path.bounds(fc) as Extent;
  const box = fitPoints([[lon0 - 15, clampLat(lat0 - 10)], [lon0 + 15, clampLat(lat0 + 10)]]);
  const k = Math.min(fit(target) * 0.8, fit(path.bounds(box) as Extent));
  if (!(k > fit(path.bounds(SPHERE) as Extent))) return proj.fitExtent(FULL, SPHERE);
  const [[x0, y0], [x1, y1]] = target;
  return proj.scale(k).translate([W / 2 - (k * (x0 + x1)) / 2, H / 2 - (k * (y0 + y1)) / 2]);
}

/**
 * Framing.visible : emprise géographique (lon, lat) qui contient tout ce que montre le cadre,
 * marge comprise. Les pays dont l'emprise ne la touche pas sont sautés sans être projetés.
 * Calculée seulement en conique : on y inverse le bord du cadre, et un extremum de longitude
 * ou de latitude ne peut être intérieur que si le pôle (sommet du cône) est dans le cadre.
 * En Equal Earth tournée (coupure à l'antiméridien), ce n'est pas sûr : pas d'emprise.
 */
export type Framing = { projection: GeoProjection; onlyCountry?: CountryFeature; visible?: Bounds };

const VISIBLE_MARGIN = 1;

function conicVisible(proj: GeoProjection): Bounds | undefined {
  if (!proj.invert) return undefined;
  const pole = proj([0, 90]);
  if (pole && pole[0] >= -20 && pole[0] <= W + 20 && pole[1] >= -20 && pole[1] <= H + 20) return undefined;
  const lons: number[] = [];
  const lats: number[] = [];
  const N = 64;
  for (let i = 0; i <= N; i++) {
    const t = i / N;
    for (const xy of [[t * W, 0], [t * W, H], [0, t * H], [W, t * H]] as [number, number][]) {
      const ll = proj.invert(xy);
      if (!ll || !ll.every(Number.isFinite)) return undefined;
      lons.push(ll[0]);
      lats.push(ll[1]);
    }
  }
  const [x0, x1, y0, y1] = [Math.min(...lons), Math.max(...lons), Math.min(...lats), Math.max(...lats)];
  if (x1 - x0 > 180) return undefined; // cadre à cheval sur la coupure : pas de raccourci
  return [[x0 - VISIBLE_MARGIN, y0 - VISIBLE_MARGIN], [x1 + VISIBLE_MARGIN, y1 + VISIBLE_MARGIN]];
}

/** Une emprise de pays peut-elle toucher l'emprise visible ? Prudent si elle traverse l'antiméridien. */
export function mayIntersect(b: Bounds, visible: Bounds): boolean {
  if (b[1][1] < visible[0][1] || b[0][1] > visible[1][1]) return false;
  if (b[0][0] > b[1][0]) return true;
  return !(b[1][0] < visible[0][0] || b[0][0] > visible[1][0]);
}

/**
 * Projection et cadrage d'un MapSpec.
 * - France et Espagne : cadrages fixes du prototype.
 * - Europe : cadrage du prototype, élargi aux pays et lieux cités, dans la fenêtre lon [-25, 50], lat [33, 71,5].
 *   Ce qui est entièrement hors de la fenêtre est ignoré (et reste hors cadre).
 * - États-Unis : Albers USA (Alaska et Hawaï repositionnés), seul le territoire américain est dessiné.
 * - Monde : Equal Earth centrée et cadrée sur les pays et lieux cités (marge 20 %, au moins 30° × 20°), sinon le globe.
 */
export function framing(spec: MapSpec): Framing {
  switch (spec.projection) {
    case 'conic-france':
    case 'conic-spain':
    case 'conic-europe': {
      const c = CONIC[spec.projection];
      // Cadrage du prototype : les 2 coins de son emprise, tels que réglés sur la maquette.
      // En Europe s'y ajoutent les pays et lieux cités (europeTargets) : leur géométrie,
      // ou les 4 coins et 4 milieux de leur emprise, car en conique les parallèles sont
      // courbes et un cadre ajusté sur 2 coins couperait le coin sud-est (Reykjavik + Bakou).
      const corners: Feature<Geometry> = { type: 'Feature', properties: {}, geometry: { type: 'MultiPoint', coordinates: [...c.bbox] as number[][] } };
      const targets = spec.projection === 'conic-europe' ? europeTargets(spec) : [];
      const proj = geoConicConformal()
        .parallels(c.parallels as unknown as [number, number])
        .rotate(c.rotate as unknown as [number, number])
        .fitExtent(c.pad as unknown as Extent, { type: 'FeatureCollection', features: [corners, ...targets] });
      proj.clipExtent([[0, 0], [W, H]]);
      return { projection: proj, visible: conicVisible(proj) };
    }
    case 'albers-usa': {
      const usa = countryByAlpha3('USA')!;
      return { projection: geoAlbersUsa().fitExtent([[24, 24], [W - 24, H - 24]], usa) as unknown as GeoProjection, onlyCountry: usa };
    }
    case 'world': {
      const proj = worldProjection(spec);
      proj.clipExtent([[0, 0], [W, H]]);
      return { projection: proj };
    }
  }
}

/** Le point projeté est-il dans le cadre de la carte ? */
export const inFrame = (xy: [number, number] | null): xy is [number, number] =>
  xy !== null && xy[0] >= 0 && xy[0] <= W && xy[1] >= 0 && xy[1] <= H;
