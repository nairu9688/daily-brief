import type { MapSpec, Place } from '@daily-brief/schema';
import { geoDistance, geoInterpolate, geoPath, type GeoProjection } from 'd3-geo';
import { COUNTRIES, COUNTRY_BOUNDS, countryByAlpha3, type CountryFeature } from './countries';
import { framing, inFrame, mayIntersect } from './projections';
import { dotGrid, escapeXml, H, r1, roundedPath, W, wrapSvg } from './svg';

/** Rayon des cercles proportionnels, comme le prototype : 65 000 manifestants → 18,4 px. */
export const BUBBLE_K = 0.072;
/** Rayon maximal d'un cercle : au-delà, tous les cercles de la carte sont réduits d'autant. */
const MAX_BUBBLE_R = 56;
const MIN_BUBBLE_R = 4;
const MARKER_R = 3.6;
const CHAR_W = 7.8;
const LABEL_H = 14;
const MAX_LABEL = 28;

/** Libellé de 28 caractères au plus : au-delà, 27 caractères et « … ». */
function truncate(text: string): string {
  const chars = [...text];
  return chars.length > MAX_LABEL ? chars.slice(0, MAX_LABEL - 1).join('') + '…' : text;
}

type Box = { x0: number; y0: number; x1: number; y1: number };
const overlaps = (a: Box, b: Box) => a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;
const insideFrame = (b: Box) => b.x0 >= 2 && b.x1 <= W - 2 && b.y0 >= 2 && b.y1 <= H - 2;

function landClass(f: CountryFeature, focus: Set<CountryFeature>, highlight: Set<CountryFeature>): string {
  if (highlight.has(f)) return 'land focus';
  if (focus.has(f)) return 'land focus-soft';
  return 'land';
}

function features(codes: string[] | undefined): Set<CountryFeature> {
  return new Set((codes ?? []).map(countryByAlpha3).filter((f): f is CountryFeature => f !== undefined));
}

const clampLat = (lat: number) => Math.max(-89, Math.min(89, lat));

/**
 * Arc en pointillés : grand cercle, bombé vers le nord d'environ 13 % de la distance.
 * Tracé comme une LineString par geoPath : coupé à l'antiméridien et au cadre.
 * Pas d'arc si l'une des extrémités est hors cadre.
 */
function arcPath(proj: GeoProjection, a: Place, b: Place): string {
  const from: [number, number] = [a.lon, a.lat];
  const to: [number, number] = [b.lon, b.lat];
  if (!inFrame(proj(from)) || !inFrame(proj(to))) return '';
  const distance = geoDistance(from, to);
  if (!(distance > 0 && distance < Math.PI - 1e-3)) return ''; // même point, ou antipodes : grand cercle indéfini
  const bump = (distance * 180) / Math.PI * 0.13;
  const at = geoInterpolate(from, to);
  const coordinates: [number, number][] = [];
  for (let i = 0; i <= 40; i++) {
    const t = i / 40;
    const [lon, lat] = at(t);
    const point: [number, number] = [lon, clampLat(lat + Math.sin(Math.PI * t) * bump)];
    if (point.every(Number.isFinite)) coordinates.push(point);
  }
  if (coordinates.length < 2) return '';
  const d = geoPath(proj).digits(1)({ type: 'LineString', coordinates });
  return d ? `<path d="${d}" class="arc"/>` : '';
}

/**
 * Rend un MapSpec en SVG thémable : les couleurs passent par les classes CSS
 * `land`, `focus`, `focus-soft`, `dot`, `pulse`, `bubble`, `marker`, `arc`, `maplabel`
 * (définies dans design/app.css et design/pdf.css).
 */
export function renderMap(spec: MapSpec, label: string): string {
  const { projection, onlyCountry, visible: area } = framing(spec);
  const path = geoPath(projection);
  const focus = features(spec.focus);
  const highlight = features(spec.highlight);

  let body = dotGrid();
  for (const f of COUNTRIES) {
    if (onlyCountry && f !== onlyCountry) continue;
    if (area && !mayIntersect(COUNTRY_BOUNDS.get(f)!, area)) continue;
    const d = roundedPath(path, f);
    if (d) body += `<path d="${d}" class="${landClass(f, focus, highlight)}"/>`;
  }

  if (spec.arc) {
    const [a, b] = spec.arc.map((n) => spec.places.find((p) => p.name === n));
    if (a && b) body += arcPath(projection, a, b);
  }

  // Rayons des cercles proportionnels. Seule une valeur finie > 0 donne un cercle : une valeur
  // nulle, négative ou absente garde volontairement le marqueur pulsé.
  const raw = new Map<Place, number>();
  if (spec.bubbles) {
    for (const p of spec.places) if (p.value !== undefined && Number.isFinite(p.value) && p.value > 0) raw.set(p, r1(Math.sqrt(p.value) * BUBBLE_K));
  }
  const largest = Math.max(0, ...raw.values());
  const shrink = largest > MAX_BUBBLE_R ? MAX_BUBBLE_R / largest : 1;
  const radius = (p: Place) => {
    const r = raw.get(p);
    return r === undefined ? null : Math.max(MIN_BUBBLE_R, r1(r * shrink));
  };

  const ordered = [...spec.places].sort((a, b) => Number(b.primary ?? false) - Number(a.primary ?? false));
  const visible = ordered.flatMap((place) => {
    const xy = projection([place.lon, place.lat]);
    return inFrame(xy) ? [{ place, x: xy[0], y: xy[1], r: radius(place) }] : [];
  });
  // Les étiquettes évitent tous les marqueurs et cercles, pas seulement les étiquettes déjà posées.
  const placed: Box[] = visible.map(({ x, y, r }) => {
    const e = r ?? MARKER_R;
    return { x0: x - e, y0: y - e, x1: x + e, y1: y + e };
  });

  for (const { place, x, y, r } of visible) {
    body += r
      ? `<circle cx="${r1(x)}" cy="${r1(y)}" r="${r}" class="bubble"/>`
      : `<circle cx="${r1(x)}" cy="${r1(y)}" r="${place.primary ? 14 : 10}" class="pulse"/>`;
    body += `<circle cx="${r1(x)}" cy="${r1(y)}" r="${MARKER_R}" class="marker"/>`;

    const text = truncate(place.label ?? place.name);
    const width = [...text].length * CHAR_W;
    const gap = r ? r + 4 : 10;
    const prefersLeft = x > W * 0.72;
    const candidates: { box: Box; left: boolean; dy: number }[] = [];
    for (const dy of [4, -10, 18, -24, 32]) {
      for (const left of [prefersLeft, !prefersLeft]) {
        const lx = left ? x - gap : x + gap;
        const y0 = y + dy - LABEL_H + 3;
        const box: Box = left ? { x0: lx - width, y0, x1: lx, y1: y + dy + 3 } : { x0: lx, y0, x1: lx + width, y1: y + dy + 3 };
        candidates.push({ box, left, dy });
      }
    }
    const fits = candidates.filter((c) => insideFrame(c.box));
    // Repli : la dernière position dans le cadre, sinon la dernière essayée.
    const chosen = fits.find((c) => !placed.some((p) => overlaps(p, c.box))) ?? fits.at(-1) ?? candidates.at(-1)!;
    placed.push(chosen.box);
    const tx = chosen.left ? x - gap : x + gap;
    body += `<text x="${r1(tx)}" y="${r1(y + chosen.dy)}" class="maplabel" text-anchor="${chosen.left ? 'end' : 'start'}">${escapeXml(text)}</text>`;
  }
  return wrapSvg(body, label);
}
