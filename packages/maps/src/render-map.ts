import type { MapSpec, Place } from '@daily-brief/schema';
import { geoDistance, geoInterpolate, geoPath, type GeoProjection } from 'd3-geo';
import { COUNTRIES, countryByAlpha3, type CountryFeature } from './countries';
import { framing, inFrame } from './projections';
import { dotGrid, escapeXml, H, r1, roundedPath, W, wrapSvg } from './svg';

/** Rayon des cercles proportionnels, comme le prototype : 65 000 manifestants → 18,4 px. */
export const BUBBLE_K = 0.072;
const CHAR_W = 7.8;
const LABEL_H = 14;

type Box = { x0: number; y0: number; x1: number; y1: number };
const overlaps = (a: Box, b: Box) => a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;

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
  const { projection, onlyCountry } = framing(spec);
  const path = geoPath(projection);
  const focus = features(spec.focus);
  const highlight = features(spec.highlight);

  let body = dotGrid();
  for (const f of COUNTRIES) {
    if (onlyCountry && f !== onlyCountry) continue;
    const d = roundedPath(path, f);
    if (d) body += `<path d="${d}" class="${landClass(f, focus, highlight)}"/>`;
  }

  if (spec.arc) {
    const [a, b] = spec.arc.map((n) => spec.places.find((p) => p.name === n));
    if (a && b) body += arcPath(projection, a, b);
  }

  const placed: Box[] = [];
  const ordered = [...spec.places].sort((a, b) => Number(b.primary ?? false) - Number(a.primary ?? false));
  for (const place of ordered) {
    const xy = projection([place.lon, place.lat]);
    if (!inFrame(xy)) continue;
    const [x, y] = xy;
    const r = spec.bubbles && place.value !== undefined ? r1(Math.sqrt(place.value) * BUBBLE_K) : null;
    body += r
      ? `<circle cx="${r1(x)}" cy="${r1(y)}" r="${r}" class="bubble"/>`
      : `<circle cx="${r1(x)}" cy="${r1(y)}" r="${place.primary ? 14 : 10}" class="pulse"/>`;
    body += `<circle cx="${r1(x)}" cy="${r1(y)}" r="3.6" class="marker"/>`;

    const text = place.label ?? place.name;
    const width = text.length * CHAR_W;
    const gap = r ? r + 4 : 10;
    const toLeft = x > W * 0.72;
    const dx = toLeft ? -gap : gap;
    const anchor = toLeft ? 'end' : 'start';
    let chosen: Box | null = null;
    let ty = y + 4;
    for (const dy of [4, -10, 18, -24, 32]) {
      const lx = x + dx;
      const box: Box = toLeft
        ? { x0: lx - width, y0: y + dy - LABEL_H + 3, x1: lx, y1: y + dy + 3 }
        : { x0: lx, y0: y + dy - LABEL_H + 3, x1: lx + width, y1: y + dy + 3 };
      if (!placed.some((p) => overlaps(p, box))) {
        chosen = box;
        ty = y + dy;
        break;
      }
    }
    placed.push(chosen ?? { x0: x, y0: ty - LABEL_H, x1: x + width, y1: ty });
    body += `<text x="${r1(x + dx)}" y="${r1(ty)}" class="maplabel" text-anchor="${anchor}">${escapeXml(text)}</text>`;
  }
  return wrapSvg(body, label);
}
