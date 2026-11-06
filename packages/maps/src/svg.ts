import type { GeoPath } from 'd3-geo';
import type { CountryFeature } from './countries';

export const W = 640;
export const H = 400;

export const r1 = (n: number) => Math.round(n * 10) / 10;

export const escapeXml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/**
 * Tracé SVG aux coordonnées arrondies à l'entier (fichiers 3 à 4 fois plus légers, rendu identique),
 * sans les points qui, une fois arrondis, répètent le point précédent du même sous-tracé
 * (carte du monde : 757 → 215 Ko).
 */
export function roundedPath(path: GeoPath, f: CountryFeature): string {
  const rounded = (path(f) ?? '').replace(/-?\d+\.\d+/g, (m) => String(Math.round(parseFloat(m))));
  let out = '';
  let prev = '';
  for (const [, cmd, xy] of rounded.matchAll(/([MLZ])([^MLZ]*)/g)) {
    if (cmd === 'L' && xy === prev) continue;
    out += cmd + xy;
    prev = cmd === 'Z' ? '' : xy;
  }
  return out;
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
