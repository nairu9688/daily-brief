/**
 * Génère les icônes PWA dans apps/web/public/icons/ : le logo demi-disque de la maquette (cercle cerné,
 * moitié gauche à l'accent FR) sur fond sombre. Déterministe, sans dépendance d'exécution (pngjs est
 * déjà une dépendance de développement du dépôt). Relancer : npx tsx apps/web/scripts/make-icons.ts
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';

const OUT = fileURLToPath(new URL('../public/icons/', import.meta.url));
const BG = [0x0b, 0x0b, 0x0c];
const RING = [0xf3, 0xf3, 0xf1];
const ACCENT = [0x3e, 0x6b, 0xff];

/** Couleur d'un point (coordonnées normalisées -1..1) : fond, anneau, demi-disque gauche. */
function colorAt(x: number, y: number, radius: number): number[] {
  const d = Math.hypot(x, y);
  const ring = radius * 0.09;
  if (d > radius) return BG;
  if (d > radius - ring) return RING;
  return x < 0 ? ACCENT : BG;
}

/** PNG carré de `size` px ; `radius` : rayon du logo (1 = bord), suréchantillonné 4×4. */
export function iconPng(size: number, radius: number): Buffer {
  const png = new PNG({ width: size, height: size });
  const S = 4;
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      const acc = [0, 0, 0];
      for (let sy = 0; sy < S; sy++) {
        for (let sx = 0; sx < S; sx++) {
          const x = ((px + (sx + 0.5) / S) / size) * 2 - 1;
          const y = ((py + (sy + 0.5) / S) / size) * 2 - 1;
          const c = colorAt(x, y, radius);
          for (let k = 0; k < 3; k++) acc[k] += c[k];
        }
      }
      const i = (py * size + px) * 4;
      for (let k = 0; k < 3; k++) png.data[i + k] = Math.round(acc[k] / (S * S));
      png.data[i + 3] = 255;
    }
  }
  return PNG.sync.write(png);
}

export const ICONS: { file: string; size: number; radius: number }[] = [
  { file: 'icon-192.png', size: 192, radius: 0.62 },
  { file: 'icon-512.png', size: 512, radius: 0.62 },
  // Zone sûre d'une icône « maskable » : le cercle central de 80 % du côté.
  { file: 'icon-maskable-512.png', size: 512, radius: 0.5 },
  { file: 'apple-touch-icon.png', size: 180, radius: 0.62 },
];

export const SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="#0B0B0C"/><path d="M32 12a20 20 0 0 0 0 40z" fill="#3E6BFF"/><circle cx="32" cy="32" r="19" fill="none" stroke="#F3F3F1" stroke-width="3"/></svg>\n`;

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  mkdirSync(OUT, { recursive: true });
  for (const i of ICONS) writeFileSync(`${OUT}${i.file}`, iconPng(i.size, i.radius));
  writeFileSync(`${OUT}icon.svg`, SVG);
  console.log(`${ICONS.length + 1} icônes écrites dans ${OUT}`);
}
