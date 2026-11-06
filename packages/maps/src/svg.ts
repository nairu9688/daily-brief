import type { GeoPath } from 'd3-geo';
import type { CountryFeature } from './countries';

export const W = 640;
export const H = 400;

export const r1 = (n: number) => Math.round(n * 10) / 10;

export const escapeXml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Tracé SVG aux coordonnées arrondies à l'entier (fichiers 3 à 4 fois plus légers, rendu identique). */
export function roundedPath(path: GeoPath, f: CountryFeature): string {
  return (path(f) ?? '').replace(/-?\d+\.\d+/g, (m) => String(Math.round(parseFloat(m))));
}

/** Grille de points de fond, tous les 24 px. */
export function dotGrid(step = 24): string {
  let g = '';
  for (let x = step; x < W; x += step) for (let y = step; y < H; y += step) g += `<circle cx="${x}" cy="${y}" r="0.7" class="dot"/>`;
  return `<g>${g}</g>`;
}

export function wrapSvg(body: string, label: string): string {
  return `<svg class="map" viewBox="0 0 ${W} ${H}" role="img" aria-label="${escapeXml(label)}" xmlns="http://www.w3.org/2000/svg">${body}</svg>`;
}
