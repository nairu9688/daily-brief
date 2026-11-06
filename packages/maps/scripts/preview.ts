import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { Brief } from '@daily-brief/schema';
import { renderMap } from '../src/render-map';

/** Aperçu de contrôle : toutes les cartes de la fixture, en clair et en sombre, dans out/maps-preview.html. */
const root = fileURLToPath(new URL('../../../', import.meta.url));
const brief: Brief = JSON.parse(readFileSync(root + 'fixtures/brief-2026-11-06.json', 'utf8'));
const css = readFileSync(root + 'design/app.css', 'utf8').match(/\.map \.[^\n]*/g)!.join('\n');
const cards = brief.editions.flatMap((e) =>
  e.sections.flatMap((s) =>
    s.stories.flatMap((st) =>
      st.visual.type === 'map'
        ? [`<figure>${renderMap(st.visual.map, st.visual.caption)}<figcaption>${st.id} · ${st.visual.map.projection} · ${st.visual.caption}</figcaption></figure>`]
        : [],
    ),
  ),
);
const theme = (cls: string, vars: string) => `<section class="${cls}" style="${vars}">${cards.join('')}</section>`;
const light = '--map-land:#E9E9E5;--map-stroke:#FFFFFF;--map-dot:#D3D3CE;--map-soft:#DADAD5;--accent:#3E6BFF;--ink-2:#55565C;--surface-2:#F7F7F5;background:#F7F7F5';
const dark = '--map-land:#1E1E21;--map-stroke:#0B0B0C;--map-dot:#232327;--map-soft:#2A2A2F;--accent:#7B97FF;--ink-2:#A7A8AE;--surface-2:#1A1A1D;background:#1A1A1D;color:#eee';
mkdirSync(root + 'out', { recursive: true });
writeFileSync(
  root + 'out/maps-preview.html',
  `<!doctype html><meta charset="utf-8"><style>body{margin:0;font:12px monospace}section{display:grid;grid-template-columns:repeat(2,640px);gap:16px;padding:16px}figure{margin:0}svg{width:640px;height:400px;display:block}${css}</style>${theme('light', light)}${theme('dark', dark)}`,
);
console.log(`${cards.length} cartes → out/maps-preview.html`);
