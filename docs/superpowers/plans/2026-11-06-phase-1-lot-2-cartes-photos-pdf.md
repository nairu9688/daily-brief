# Lot 2 — Cartes, photos et PDF : plan d'implémentation

> **Pour les agents :** sous-skill requis : superpowers:subagent-driven-development (recommandé) ou superpowers:executing-plans, tâche par tâche. Les étapes utilisent des cases à cocher (`- [ ]`) pour le suivi.

**Objectif :** produire chaque jour le PDF unique `Daily Brief AAAA-MM-JJ.pdf` (FR, puis EN, puis ES) à partir des éditions vérifiées, avec des cartes SVG générées depuis le `MapSpec`, des QR codes et des photos Pexels créditées. Le tout est lancé par `npm run brief:render` (spec §8.4, §8.5, R11).

**Architecture :** trois unités indépendantes.
- `packages/maps` porte `reference/mapgen2.mjs`, généralisé au `MapSpec` : `renderMap(spec, label)` renvoie un SVG thémable par classes CSS. Le paquet sera réutilisé par l'appli au lot 6.
- `packages/render-pdf` porte la partie PDF de `reference/render.mjs` : `renderPdfHtml` produit le HTML et `printPdf` l'imprime en A4 avec Playwright.
- `pipeline/render` complète les photos Pexels, intègre les images en data URI, puis écrit `{lang}.final.json`, le PDF et `render-report.json`. Tout appel réseau passe par un `fetch` injecté, donc les tests n'en font aucun.

**Pile :** d3-geo, topojson-client, world-atlas 50m, i18n-iso-countries (codes alpha-3 → numériques), qrcode, Playwright 1.63.0 (Chromium préinstallé), polices `geist`, pixelmatch et pngjs pour le test visuel.

**Feuille de route :** `docs/superpowers/plans/2026-11-06-phase-1-roadmap.md`. **Spec :** `docs/specs/2026-11-06-daily-brief-design.md` (§8.1, §8.4, §8.5, §12 et R11). **Référence visuelle :** `design/Daily-Brief-2026-11-06.pdf`, `design/pdf.css`, `reference/mapgen2.mjs`, `reference/render.mjs`.

---

## Contexte pour l'exécutant

- **Point de départ.** Le lot 1 est en place : schéma `@daily-brief/schema`, `pipeline/lib` et `brief:verify`, qui écrit `out/<date>/{lang}.verified.json`. Ce lot lit ces fichiers.
- **Fichiers à ne pas modifier :** `fixtures/brief-2026-11-06.json`, `design/` et `reference/`. Ils font foi pour le rendu.
- **Navigateur.** Playwright est épinglé en **1.63.0** parce que c'est la version des navigateurs préinstallés dans `/opt/pw-browsers` (variable `PLAYWRIGHT_BROWSERS_PATH`). Ne lance **pas** `npx playwright install`. Si la routine tourne un jour sur une image sans navigateur, la spec §16 prévoit `npx playwright install chromium`.
- **Réseau.** Aucun test n'appelle le réseau. Pexels et le téléchargement des images passent par un `fetch` injecté (`FetchLike`).
- **Cartes : écarts assumés par rapport à la maquette.** Les positions des étiquettes sont calculées, et non plus réglées à la main comme dans le prototype. Un léger décalage par rapport à la maquette est donc normal ; les couleurs, la grille de points, les marqueurs, les arcs et les cadrages sont les mêmes. Le cadrage Europe s'élargit aux pays surlignés : la carte des data centers englobe la Finlande.
- **Accent ES du PDF** : `#C08A00`, comme dans le prototype, plus lisible à l'impression (feuille de route, point 3). L'appli garde `#C88E00`.
- **Commandes.** Elles se lancent depuis la racine du dépôt. Un message d'échec « Failed to load url … » signifie que le module n'existe pas encore : c'est l'échec attendu.

## Structure des fichiers

```
packages/maps/
  package.json              @daily-brief/maps
  src/countries.ts          pays world-atlas 50m, alpha-3 → id, emprise de la métropole
  src/svg.ts                constantes 640×400, arrondi des tracés, grille de points, enveloppe SVG, échappement
  src/projections.ts        projection et cadrage de chaque type de MapSpec
  src/render-map.ts         renderMap : pays, arc, marqueurs, cercles proportionnels, étiquettes sans chevauchement
  src/qr.ts                 qrSvg
  src/index.ts
  scripts/preview.ts        out/maps-preview.html, aperçu clair et sombre des cartes de la fixture
  test/countries.test.ts, test/render-map.test.ts, test/qr.test.ts
packages/render-pdf/
  package.json              @daily-brief/render-pdf (geist, playwright 1.63.0)
  src/pdf.css               copie de design/pdf.css + 4 règles du lot 2
  src/i18n.ts               libellés FR/EN/ES, guillemets, accents d'impression
  src/format.ts             dates FR, échappement HTML
  src/assets.ts             polices Geist en base64, feuille de style finale
  src/html.ts               renderPdfHtml (couverture, sujets, brèves, vocabulaire)
  src/print.ts              printPdf (Chromium, A4, pied de page paginé)
  src/index.ts
  test/html.test.ts, test/print.test.ts, test/visual.test.ts, test/__screens__/*.png
pipeline/render/
  http.ts                   type FetchLike
  pexels.ts                 findPhoto (API Pexels v1)
  photos.ts                 fillPhotos (renseigne visual.pexels)
  images.ts                 fetchAsDataUri
  issue.ts                  numéro du jour, nom du PDF
  run-render.ts             runRender : lecture, photos, final.json, PDF, rapport
  cli.ts                    npm run brief:render
pipeline/test/render/       fake-fetch.ts + tests
fixtures/api/               réponse Pexels construite d'après la documentation
```

---

### Tâche 1 : paquet `@daily-brief/maps` et pays

**Fichiers :**
- Créer : `packages/maps/package.json`, `packages/maps/src/countries.ts`
- Test : `packages/maps/test/countries.test.ts`

- [ ] **Étape 1 : écrire `packages/maps/package.json` et installer**

```json
{
  "name": "@daily-brief/maps",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "exports": { ".": "./src/index.ts" },
  "dependencies": {
    "@daily-brief/schema": "*",
    "d3-geo": "^3.1.1",
    "i18n-iso-countries": "^7.14.0",
    "qrcode": "^1.5.4",
    "topojson-client": "^3.1.0",
    "world-atlas": "^2.0.2"
  },
  "devDependencies": {
    "@types/d3-geo": "^3.1.0",
    "@types/qrcode": "^1.5.5",
    "@types/topojson-client": "^3.1.5",
    "@types/topojson-specification": "^1.0.5"
  }
}
```

Commande : `npm install && npm ls d3-geo world-atlas i18n-iso-countries`
Attendu : les trois paquets sont listés sous `@daily-brief/maps`, sans erreur.

- [ ] **Étape 2 : écrire le test qui échoue**

```ts
import { describe, expect, it } from 'vitest';
import { countryByAlpha3, mainBounds, numericId } from '../src/countries';

describe('pays', () => {
  it('convertit les codes alpha-3 en identifiants world-atlas', () => {
    expect(numericId('FRA')).toBe('250');
    expect(numericId('AUT')).toBe('040');
    expect(numericId('XXX')).toBeUndefined();
    expect(countryByAlpha3('ESP')?.properties.name).toBe('Spain');
  });

  it('cadre la métropole, sans outre-mer ni îles lointaines', () => {
    const [[w, s], [e, n]] = mainBounds(countryByAlpha3('FRA')!);
    expect(w).toBeGreaterThan(-6);
    expect(e).toBeLessThan(9);
    expect(s).toBeGreaterThan(42);
    expect(n).toBeLessThan(52);
    const [[, sEsp]] = mainBounds(countryByAlpha3('ESP')!);
    expect(sEsp).toBeGreaterThan(35);
  });
});
```

- [ ] **Étape 3 : vérifier l'échec**

Commande : `npx vitest run packages/maps/test/countries.test.ts`
Attendu : ÉCHEC, le module `../src/countries` est introuvable.

- [ ] **Étape 4 : écrire `countries.ts`**

world-atlas identifie les pays par leur code ISO numérique sur 3 chiffres (« 250 »), alors que le `MapSpec` utilise l'alpha-3 (« FRA »). `mainBounds` cadre la métropole, sinon la Guyane étirerait toute carte qui met la France en avant.

```ts
import type { Feature, FeatureCollection, Geometry, MultiPolygon, Polygon } from 'geojson';
import { geoArea, geoBounds } from 'd3-geo';
import isoCountries from 'i18n-iso-countries';
import { feature } from 'topojson-client';
import type { GeometryCollection, Topology } from 'topojson-specification';
import topo from 'world-atlas/countries-50m.json';

export type CountryFeature = Feature<Geometry, { name: string }> & { id?: string };
export type Bounds = [[number, number], [number, number]];

const topology = topo as unknown as Topology<{ countries: GeometryCollection<{ name: string }> }>;

/** Pays de world-atlas 50m, chargés une seule fois. `id` = code ISO 3166 numérique sur 3 chiffres. */
export const COUNTRIES: CountryFeature[] = (
  feature(topology, topology.objects.countries) as unknown as FeatureCollection<Geometry, { name: string }>
).features as CountryFeature[];

/** Code alpha-3 (« FRA ») → identifiant world-atlas (« 250 »), ou undefined si inconnu. */
export function numericId(alpha3: string): string | undefined {
  return isoCountries.alpha3ToNumeric(alpha3) ?? undefined;
}

export function countryByAlpha3(alpha3: string): CountryFeature | undefined {
  const id = numericId(alpha3);
  return id ? COUNTRIES.find((f) => f.id === id) : undefined;
}

/**
 * Emprise du plus grand polygone du pays (en surface sphérique) : la métropole,
 * sans les outre-mer ni les îles lointaines (Guyane pour FRA, Canaries pour ESP).
 */
export function mainBounds(f: CountryFeature): Bounds {
  const g = f.geometry;
  if (g.type !== 'MultiPolygon') return geoBounds(f) as Bounds;
  const polygons = (g as MultiPolygon).coordinates.map(
    (coordinates): Feature<Polygon> => ({ type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates } }),
  );
  const largest = polygons.reduce((a, b) => (geoArea(b) > geoArea(a) ? b : a));
  return geoBounds(largest) as Bounds;
}
```

- [ ] **Étape 5 : vérifier le succès**

Commande : `npx vitest run packages/maps/test/countries.test.ts && npm run typecheck`
Attendu : 2 tests réussis, typage propre.

- [ ] **Étape 6 : commit**

```bash
git add packages/maps package-lock.json
git commit -m "feat(maps): pays world-atlas 50m et codes alpha-3"
```

---

### Tâche 2 : `renderMap`, du MapSpec au SVG

**Fichiers :**
- Créer : `packages/maps/src/svg.ts`, `packages/maps/src/projections.ts`, `packages/maps/src/render-map.ts`
- Test : `packages/maps/test/render-map.test.ts`

Les choix suivants sont repris du prototype :
- cadre de 640×400 avec `clipExtent` ;
- tracés des pays arrondis à l'entier ;
- grille de points tous les 24 px ;
- classes `land`, `focus` (pays de `highlight`) et `focus-soft` (pays de `focus`) ;
- marqueur `pulse` de 10 px, ou 14 px pour un lieu `primary` ;
- cercles proportionnels `bubble` de rayon 0,072 × √valeur ;
- arc en pointillés ;
- étiquettes `maplabel`.

Les étiquettes, elles, sont placées automatiquement :
- à gauche du point dans le dernier quart droit de la carte ;
- chaque étiquette essaie cinq hauteurs pour ne pas chevaucher une autre.

- [ ] **Étape 1 : écrire le test qui échoue**

```ts
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
    const ys = [...renderMap(spec, 'x').matchAll(/<text x="[^"]+" y="([^"]+)"/g)].map((m) => Number(m[1]));
    expect(ys).toHaveLength(2);
    expect(Math.abs(ys[0] - ys[1])).toBeGreaterThanOrEqual(14);
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
```

- [ ] **Étape 2 : vérifier l'échec**

Commande : `npx vitest run packages/maps/test/render-map.test.ts`
Attendu : ÉCHEC, le module `../src/render-map` est introuvable.

- [ ] **Étape 3 : écrire `svg.ts`**

```ts
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
```

- [ ] **Étape 4 : écrire `projections.ts`**

```ts
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
```

- [ ] **Étape 5 : écrire `render-map.ts`**

```ts
import type { MapSpec, Place } from '@daily-brief/schema';
import { geoDistance, geoInterpolate, geoPath, type GeoProjection } from 'd3-geo';
import { COUNTRIES, numericId } from './countries';
import { framing } from './projections';
import { dotGrid, escapeXml, H, r1, roundedPath, W, wrapSvg } from './svg';

/** Rayon des cercles proportionnels, comme le prototype : 65 000 manifestants → 18,4 px. */
export const BUBBLE_K = 0.072;
const CHAR_W = 7.8;
const LABEL_H = 14;

type Box = { x0: number; y0: number; x1: number; y1: number };
const overlaps = (a: Box, b: Box) => a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;

function landClass(id: string | undefined, focus: Set<string>, highlight: Set<string>): string {
  if (id && highlight.has(id)) return 'land focus';
  if (id && focus.has(id)) return 'land focus-soft';
  return 'land';
}

function ids(codes: string[] | undefined): Set<string> {
  return new Set((codes ?? []).map(numericId).filter((x): x is string => x !== undefined));
}

/** Arc en pointillés : grand cercle, bombé vers le nord d'environ 13 % de la distance. */
function arcPath(proj: GeoProjection, a: Place, b: Place): string {
  const from: [number, number] = [a.lon, a.lat];
  const to: [number, number] = [b.lon, b.lat];
  const bump = (geoDistance(from, to) * 180) / Math.PI * 0.13;
  const at = geoInterpolate(from, to);
  let d = '';
  for (let i = 0; i <= 40; i++) {
    const t = i / 40;
    const [lon, lat] = at(t);
    const p = proj([lon, lat + Math.sin(Math.PI * t) * bump]);
    if (!p) continue;
    d += (d ? 'L' : 'M') + r1(p[0]) + ',' + r1(p[1]);
  }
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
  const focus = ids(spec.focus);
  const highlight = ids(spec.highlight);

  let body = dotGrid();
  for (const f of COUNTRIES) {
    if (onlyCountry && f.id !== onlyCountry) continue;
    const d = roundedPath(path, f);
    if (d) body += `<path d="${d}" class="${landClass(f.id, focus, highlight)}"/>`;
  }

  if (spec.arc) {
    const [a, b] = spec.arc.map((n) => spec.places.find((p) => p.name === n));
    if (a && b) body += arcPath(projection, a, b);
  }

  const placed: Box[] = [];
  const ordered = [...spec.places].sort((a, b) => Number(b.primary ?? false) - Number(a.primary ?? false));
  for (const place of ordered) {
    const xy = projection([place.lon, place.lat]);
    if (!xy || xy[0] < 0 || xy[0] > W || xy[1] < 0 || xy[1] > H) continue;
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
```

- [ ] **Étape 6 : vérifier le succès**

Commande : `npx vitest run packages/maps && npm run typecheck`
Attendu : 11 tests réussis (2 + 9), typage propre.

- [ ] **Étape 7 : commit**

```bash
git add packages/maps
git commit -m "feat(maps): renderMap, cartes SVG thémables depuis le MapSpec (spec §8.4)"
```

---

### Tâche 3 : QR codes, point d'entrée et aperçu des cartes

**Fichiers :**
- Créer : `packages/maps/src/qr.ts`, `packages/maps/src/index.ts`, `packages/maps/scripts/preview.ts`
- Modifier : `package.json` (racine), pour ajouter le script `maps:preview`
- Test : `packages/maps/test/qr.test.ts`

- [ ] **Étape 1 : écrire le test qui échoue**

```ts
import { describe, expect, it } from 'vitest';
import { qrSvg } from '../src/qr';

describe('qrSvg', () => {
  it('produit un SVG avec la classe qr', async () => {
    const svg = await qrSvg('https://www.sudradio.fr/societe/x');
    expect(svg.startsWith('<svg class="qr"')).toBe(true);
    expect(svg).toContain('<path');
  });
});
```

- [ ] **Étape 2 : vérifier l'échec**

Commande : `npx vitest run packages/maps/test/qr.test.ts`
Attendu : ÉCHEC, le module `../src/qr` est introuvable.

- [ ] **Étape 3 : écrire `qr.ts` et `index.ts`**

```ts
import QRCode from 'qrcode';

/** QR code SVG (sans marge, correction L) avec la classe `qr`, pour le PDF. */
export async function qrSvg(url: string): Promise<string> {
  const svg = await QRCode.toString(url, { type: 'svg', margin: 0, errorCorrectionLevel: 'L' });
  return svg.replace('<svg', '<svg class="qr"');
}
```

`packages/maps/src/index.ts` :

```ts
export { renderMap, BUBBLE_K } from './render-map';
export { qrSvg } from './qr';
export { countryByAlpha3, mainBounds, numericId } from './countries';
```

- [ ] **Étape 4 : vérifier le succès**

Commande : `npx vitest run packages/maps`
Attendu : 12 tests réussis.

- [ ] **Étape 5 : écrire le script d'aperçu**

```ts
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
```

Dans `package.json` (racine), ajouter une virgule à la fin de la ligne `"brief:verify": …`, puis la ligne suivante juste après, en dernière position de `"scripts"` :

```json
    "maps:preview": "tsx packages/maps/scripts/preview.ts"
```

- [ ] **Étape 6 : contrôle visuel**

Commande : `npm run maps:preview`
Attendu : `7 cartes → out/maps-preview.html`.

Ouvrir ce fichier dans Chromium ou en faire une capture, par exemple :

```bash
node -e "const {chromium}=require('playwright');(async()=>{const b=await chromium.launch();const p=await b.newPage({viewport:{width:1328,height:1700}});await p.goto('file://'+process.cwd()+'/out/maps-preview.html');await p.screenshot({path:'out/maps-preview.png'});await b.close()})()"
```

Vérifier, en comparant avec les cartes de `design/maquette-v2.html` :
- France avec les cercles Paris (65 000) et Lyon (30 500) ;
- États-Unis entiers, Alaska compris ;
- arc Madrid → Kyiv, avec l'Espagne et l'Ukraine en accent ;
- 8 pays en accent sur la carte Europe des data centers ;
- Espagne avec un arc Madrid–Urda ;
- aucune étiquette superposée à une autre.

- [ ] **Étape 7 : commit**

```bash
git add packages/maps package.json
git commit -m "feat(maps): QR codes et aperçu des cartes de la fixture"
```

---

### Tâche 4 : gabarit HTML du PDF (`packages/render-pdf`)

**Fichiers :**
- Créer : `packages/render-pdf/package.json`, `packages/render-pdf/src/pdf.css`, `packages/render-pdf/src/i18n.ts`, `packages/render-pdf/src/format.ts`, `packages/render-pdf/src/assets.ts`, `packages/render-pdf/src/html.ts`
- Test : `packages/render-pdf/test/html.test.ts`

Ce gabarit porte `pdfEdition` et `pdfStory` de `reference/render.mjs` vers le schéma du lot 1. Choix à respecter :
- **Couverture de chaque édition :**
  - en-tête ;
  - titre du jour ;
  - Morning Brief ;
  - encadré « Dans cette édition », avec le nombre de sujets et de brèves par rubrique ;
  - liens internes vers les trois éditions, celles qui manquent étant grisées ;
  - encart audio, seulement si la durée est connue (sinon l'édition est publiée sans audio, §9) ;
  - « Les chiffres du jour » : le premier chiffre des 4 premiers sujets chiffrés.
- **Sujets :**
  - colonne texte ;
  - colonne visuelle avec la carte, ou la photo et son crédit ;
  - QR code vers la source principale, c'est-à-dire la première lue en entier ;
  - liens vers les médias.
- **Brèves, puis vocabulaire.**
- **Libellé des divergences** : « Les sources divergent » (spec §8.2).
- **Guillemets** : « » en FR et ES, “ ” en EN.
- **Échappement** : tout le texte venu du JSON est échappé.

- [ ] **Étape 1 : écrire `packages/render-pdf/package.json` et installer**

```json
{
  "name": "@daily-brief/render-pdf",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "exports": { ".": "./src/index.ts" },
  "dependencies": {
    "@daily-brief/maps": "*",
    "@daily-brief/schema": "*",
    "geist": "^1.9.2",
    "playwright": "1.63.0"
  }
}
```

Commande : `npm install && node -e "console.log(require('playwright/package.json').version)"`
Attendu : `1.63.0`.

- [ ] **Étape 2 : écrire le test qui échoue**

```ts
import { readFileSync } from 'node:fs';
import type { Brief, Edition } from '@daily-brief/schema';
import { describe, expect, it } from 'vitest';
import { renderPdfHtml } from '../src/html';

const brief: Brief = JSON.parse(readFileSync(new URL('../../../fixtures/brief-2026-11-06.json', import.meta.url), 'utf8'));
const ed = (lang: string): Edition => structuredClone(brief.editions.find((e) => e.lang === lang)!);
const count = (s: string, re: RegExp) => (s.match(re) ?? []).length;

describe('renderPdfHtml', () => {
  it('rend les trois éditions dans l’ordre FR, EN, ES avec leur couverture', async () => {
    const html = await renderPdfHtml({ date: brief.date, issue: '001', editions: [ed('es'), ed('fr'), ed('en')] });
    const order = ['ed-fr', 'ed-en', 'ed-es'].map((id) => html.indexOf(`id="${id}"`));
    expect(order.every((i, k) => i > 0 && (k === 0 || i > order[k - 1]))).toBe(true);
    expect(html).toContain('Vendredi 6 novembre 2026 · N° 001');
    expect(html).toContain('La rue pousse Lecornu à négocier, le Sud-Est sous l’eau');
    expect(count(html, /<svg class="map"/g)).toBe(7);
    expect(count(html, /<article class="story">/g)).toBe(10);
    expect(count(html, /<svg class="qr"/g)).toBe(10);
    expect(count(html, /<table class="voc">/g)).toBe(2);
    expect(html).toContain('@font-face{font-family:"Geist";src:url(data:font/woff2;base64,d09G');
  });

  it('montre les chiffres du jour, les divergences, le lien prépa et la traduction', async () => {
    const html = await renderPdfHtml({ date: brief.date, issue: '001', editions: [ed('fr')] });
    expect(html).toContain('<h3 class="mono">Les chiffres du jour</h3>');
    expect(html).toContain('<b class="mono">Les sources divergent</b>');
    expect(html).toContain('<b>Lien prépa · Éco-droit</b>');
    expect(html).toMatch(/<p class="tr"><span class="mono">Traduction<\/span>Ils jouent au Far West/);
  });

  it('grise les éditions absentes et n’ajoute l’encart audio que si la durée est connue', async () => {
    const html = await renderPdfHtml({ date: brief.date, issue: '001', editions: [ed('fr')] }, { audio: { fr: { duration: '3:24' } } });
    expect(html).toContain('<a href="#ed-fr"');
    expect(html).toContain('<span>EN</span><span>ES</span>');
    expect(html).toContain('3:24 · voix Chirp HD');
    const en = ed('en');
    const st = en.sections[0].stories[0];
    st.quote = { text: 'We had a tough night, no question about it', speaker: 'John Thune', translation: null, sourceUrl: st.sources[0].url };
    const silent = await renderPdfHtml({ date: brief.date, issue: '001', editions: [en] });
    expect(silent).not.toContain('Version audio');
    expect(silent).toContain('<p>“We had a tough night, no question about it”</p>');
  });

  it('intègre une photo Pexels avec son crédit, et omet une photo non téléchargée', async () => {
    const fr = ed('fr');
    const story = fr.sections.find((s) => s.key === 'eco')!.stories[0];
    story.visual = {
      type: 'photo',
      query: 'car factory',
      pexels: { id: 1, src: 'https://images.pexels.com/1.jpeg', width: 6, height: 4, photographer: 'Jo Rails', photographerUrl: 'https://www.pexels.com/@jo', pexelsUrl: 'https://www.pexels.com/photo/1/' },
    };
    const withImg = await renderPdfHtml({ date: brief.date, issue: '001', editions: [fr] }, { images: { 'https://images.pexels.com/1.jpeg': 'data:image/jpeg;base64,AA' } });
    expect(withImg).toContain('<img src="data:image/jpeg;base64,AA" alt="car factory">');
    expect(withImg).toContain('Photo : <a href="https://www.pexels.com/@jo">Jo Rails</a>');
    const without = await renderPdfHtml({ date: brief.date, issue: '001', editions: [fr] });
    expect(without).not.toContain('<img');
  });

  it('échappe le texte venu du JSON', async () => {
    const fr = ed('fr');
    fr.headline = '<script>alert(1)</script> & co';
    const html = await renderPdfHtml({ date: brief.date, issue: '001', editions: [fr] });
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt; &amp; co');
    expect(html).not.toContain('<script>');
  });

  it('refuse un rendu sans édition', async () => {
    await expect(renderPdfHtml({ date: brief.date, issue: '001', editions: [] })).rejects.toThrow(/aucune édition/);
  });
});
```

- [ ] **Étape 3 : vérifier l'échec**

Commande : `npx vitest run packages/render-pdf/test/html.test.ts`
Attendu : ÉCHEC, le module `../src/html` est introuvable.

- [ ] **Étape 4 : porter la feuille de style**

```bash
cp design/pdf.css packages/render-pdf/src/pdf.css
```

Puis ajouter à la fin de `packages/render-pdf/src/pdf.css` :

```css

/* Ajouts du lot 2 : photo Pexels et lien interne vers les éditions absentes */
.fig img{display:block;width:100%;aspect-ratio:16/10;object-fit:cover}
.figcap a{color:inherit}
.eds span{flex:1;text-align:center;font:500 7.4pt "Geist Mono",monospace;padding:1.6mm 0;border-radius:1.6mm;border:.7pt dashed var(--line);color:var(--ink-3)}
.quote p.tr span{font-size:6.2pt;text-transform:uppercase;color:var(--ink-3);margin-right:1mm}
```

- [ ] **Étape 5 : écrire `i18n.ts`**

```ts
import type { Lang } from '@daily-brief/schema';

/** Libellés du PDF, repris de reference/render.mjs. */
export const T: Record<
  Lang,
  {
    edition: string;
    ai: string;
    sources: string;
    briefs: string;
    infos: string;
    subjects: (n: number) => string;
    translation: string;
    diverge: string;
    kpis: string;
    inThisEdition: string;
    vocab: string;
    words: string;
  }
> = {
  fr: {
    edition: 'Édition française',
    ai: 'Résumé IA · d’après les sources citées',
    sources: 'sources',
    briefs: 'En bref',
    infos: 'infos',
    subjects: (n) => (n > 1 ? `${n} sujets` : `${n} sujet`),
    translation: 'Traduction',
    diverge: 'Les sources divergent',
    kpis: 'Les chiffres du jour',
    inThisEdition: 'Dans cette édition',
    vocab: 'Vocab du jour',
    words: 'mots',
  },
  en: {
    edition: 'English edition',
    ai: 'AI summary · based on cited sources',
    sources: 'sources',
    briefs: 'In brief',
    infos: 'stories',
    subjects: (n) => (n > 1 ? `${n} stories` : `${n} story`),
    translation: 'Translation',
    diverge: 'Sources differ',
    kpis: 'Numbers of the day',
    inThisEdition: 'In this edition',
    vocab: 'Vocab du jour',
    words: 'mots',
  },
  es: {
    edition: 'Edición en español',
    ai: 'Resumen IA · según las fuentes citadas',
    sources: 'fuentes',
    briefs: 'En breve',
    infos: 'temas',
    subjects: (n) => (n > 1 ? `${n} temas` : `${n} tema`),
    translation: 'Traducción',
    diverge: 'Las fuentes difieren',
    kpis: 'Las cifras del día',
    inThisEdition: 'En esta edición',
    vocab: 'Vocab du jour',
    words: 'mots',
  },
};

/** Guillemets d'ouverture et de fermeture des citations. */
export const QUOTE_MARKS: Record<Lang, [string, string]> = { fr: ['« ', ' »'], en: ['“', '”'], es: ['« ', ' »'] };

/** Accents d'impression (design/pdf.css et prototype : ES plus sombre que dans l'appli, pour l'impression). */
export const ACCENT: Record<Lang, string> = { fr: '#3E6BFF', en: '#0E9F6E', es: '#C08A00' };
```

- [ ] **Étape 6 : écrire `format.ts`**

```ts
/** « 2026-11-06 » → « Vendredi 6 novembre 2026 » (date civile, sans fuseau). */
export function longDateFr(iso: string): string {
  const s = new Intl.DateTimeFormat('fr-FR', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(`${iso}T12:00:00Z`));
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** « 2026-11-06 » → « 06.11.2026 ». */
export function dottedDate(iso: string): string {
  const [y, m, d] = iso.split('-');
  return `${d}.${m}.${y}`;
}

export const escapeHtml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
```

- [ ] **Étape 7 : écrire `assets.ts`**

Le paquet `geist` n'exporte pas ses fichiers de police : on résout `geist/font/sans` puis on remonte au dossier `dist/fonts`.

```ts
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);

/** Dossier des polices du paquet npm `geist` (auto-hébergées, aucune police servie par CDN). */
function geistFontsDir(): string {
  return join(dirname(require.resolve('geist/font/sans')), 'fonts');
}

export function fontBase64(): { sans: string; mono: string } {
  const dir = geistFontsDir();
  return {
    sans: readFileSync(join(dir, 'geist-sans/Geist-Variable.woff2')).toString('base64'),
    mono: readFileSync(join(dir, 'geist-mono/GeistMono-Variable.woff2')).toString('base64'),
  };
}

/** Feuille de style du PDF (portage de design/pdf.css) avec les polices intégrées. */
export function pdfCss(): string {
  const { sans, mono } = fontBase64();
  return readFileSync(new URL('./pdf.css', import.meta.url), 'utf8').replace('{{FONT_SANS}}', sans).replace('{{FONT_MONO}}', mono);
}
```

- [ ] **Étape 8 : écrire `html.ts`**

```ts
import { qrSvg, renderMap } from '@daily-brief/maps';
import { LANGS, type Edition, type Lang, type SourceRef, type Story } from '@daily-brief/schema';
import { pdfCss } from './assets';
import { escapeHtml as esc, longDateFr } from './format';
import { ACCENT, QUOTE_MARKS, T } from './i18n';

export type PdfInput = {
  date: string;
  /** Numéro du jour, « 001 » le 06/11/2026. */
  issue: string;
  /** Une à trois éditions ; l'ordre de sortie est toujours FR, EN, ES. */
  editions: Edition[];
};

export type PdfOptions = {
  /** URL d'image Pexels → data URI ; une photo absente de la table n'est pas affichée. */
  images?: Record<string, string>;
  /** Durée de l'audio par édition (« 3:24 ») ; sans durée, pas d'encart audio. */
  audio?: Partial<Record<Lang, { duration: string }>>;
};

type Ctx = { qr: Map<string, string>; images: Record<string, string> };

const uniqueOutlets = (sources: SourceRef[]) => {
  const seen = new Map<string, SourceRef>();
  for (const s of sources) if (!seen.has(s.outlet)) seen.set(s.outlet, s);
  return [...seen.values()];
};

/** Source principale : la première lue en entier (R4 garantit qu'il y en a une). */
export const primarySource = (story: Story) => story.sources.find((s) => s.readFull) ?? story.sources[0];

function visual(story: Story, ctx: Ctx): string {
  const v = story.visual;
  if (v.type === 'map') {
    return `<div class="fig">${renderMap(v.map, v.caption)}</div><div class="figcap mono">${esc(v.caption)}</div>`;
  }
  const data = v.pexels ? ctx.images[v.pexels.src] : undefined;
  if (!v.pexels || !data) return '';
  const alt = v.pexels.alt ?? v.query;
  return `<div class="fig"><img src="${data}" alt="${esc(alt)}"></div><div class="figcap mono">Photo : <a href="${esc(v.pexels.photographerUrl)}">${esc(v.pexels.photographer)}</a> · <a href="${esc(v.pexels.pexelsUrl)}">Pexels</a></div>`;
}

function story(s: Story, lang: Lang, ctx: Ctx): string {
  const t = T[lang];
  const [open, close] = QUOTE_MARKS[lang];
  const primary = primarySource(s);
  const stats = s.stats.length
    ? `<div class="stats">${s.stats.map((x) => `<div class="stat"><b>${esc(x.value)}</b><span>${esc(x.label)}</span></div>`).join('')}</div>`
    : '';
  const quote = s.quote
    ? `<blockquote class="quote"><p>${open}${esc(s.quote.text)}${close}</p>${
        s.quote.translation ? `<p class="tr"><span class="mono">${t.translation}</span>${esc(s.quote.translation)}</p>` : ''
      }<cite class="mono">${esc(s.quote.speaker)}</cite></blockquote>`
    : '';
  const diverge = s.divergences.length
    ? `<div class="diverge"><b class="mono">${t.diverge}</b>${s.divergences
        .map((d) => `<div class="drow"><span>${esc(d.metric)}</span><span><strong>${esc(d.a.value)}</strong> ${esc(d.a.by)}</span><span><strong>${esc(d.b.value)}</strong> ${esc(d.b.by)}</span></div>`)
        .join('')}</div>`
    : '';
  const prepa = s.prepa ? `<p class="prepa"><b>Lien prépa · ${esc(s.prepa.subject)}</b>${esc(s.prepa.text)}</p>` : '';
  const links = uniqueOutlets(s.sources).map((x) => `<a href="${esc(x.url)}">${esc(x.outlet)}</a>`).join(' · ');
  return `<article class="story"><div class="txt">
    <div class="kick mono"><b>${esc(s.kicker)}</b> · ${esc(s.date)}</div><h4>${esc(s.title)}</h4>
    <div class="ai mono"><i>✦</i> ${t.ai}</div><p class="sum">${esc(s.summary)}</p>
    ${stats}${quote}${diverge}${prepa}
  </div><div class="side2">${visual(s, ctx)}
    <div class="src">${ctx.qr.get(primary.url) ?? ''}<div><b>${s.sources.length} ${t.sources}</b>${links}</div></div>
  </div></article>`;
}

function kpis(ed: Edition): string {
  const k = ed.sections
    .flatMap((s) => s.stories)
    .filter((st) => st.stats.length)
    .slice(0, 4)
    .map((st) => `<div class="kpi"><b>${esc(st.stats[0].value)}</b><span>${esc(st.stats[0].label)}</span><small class="mono">${esc(st.kicker)}</small></div>`);
  return k.length ? `<div class="kpis"><h3 class="mono">${T[ed.lang].kpis}</h3><div class="kg">${k.join('')}</div></div>` : '';
}

function edition(ed: Edition, input: PdfInput, opts: PdfOptions, ctx: Ctx): string {
  const L = ed.lang;
  const t = T[L];
  const present = new Set(input.editions.map((e) => e.lang));
  const count = (s: Edition['sections'][number]) => s.stories.length + s.briefs.length;
  const rows = ed.sections.map((s) => `<div class="row"><span>${esc(s.title)}</span><span class="mono">${count(s)}</span></div>`).join('');
  const vocabRow = ed.vocab ? `<div class="row"><span>${t.vocab}</span><span class="mono">${ed.vocab.items.length}</span></div>` : '';
  const eds = LANGS.map((l) =>
    present.has(l)
      ? `<a href="#ed-${l}" style="--c:${ACCENT[l]}" class="${l === L ? 'on' : ''}">${l.toUpperCase()}</a>`
      : `<span>${l.toUpperCase()}</span>`,
  ).join('');
  const audio = opts.audio?.[L]
    ? `<div class="audio"><svg viewBox="0 0 24 24" fill="none" stroke="${ACCENT[L]}" stroke-width="1.5"><circle cx="12" cy="12" r="10.5"/><path d="M10 8.2v7.6l6-3.8z" fill="${ACCENT[L]}"/></svg><p><b>Version audio</b><br>${esc(opts.audio[L]!.duration)} · voix Chirp HD<br>MP3 dans le même dossier Drive</p></div>`
    : '';
  const sections = ed.sections
    .map(
      (s) =>
        `<div class="rubh"><h2>${esc(s.title)}</h2><span class="mono">${t.subjects(count(s))}</span></div>${s.stories.map((x) => story(x, L, ctx)).join('')}${
          s.briefs.length
            ? `<div class="pbriefs">${s.briefs.map((b) => `<a href="${esc(b.url)}"><span>${esc(b.title)}</span><span class="mono">${esc(b.outlet)} ↗</span></a>`).join('')}</div>`
            : ''
        }`,
    )
    .join('');
  const vocab = ed.vocab
    ? `<div class="rubh"><h2>${t.vocab} · ${esc(ed.vocab.title)}</h2><span class="mono">${ed.vocab.items.length} ${t.words}</span></div><table class="voc">${ed.vocab.items
        .map((w) => `<tr><td><b>${esc(w.term)}</b> <em class="mono">${esc(w.pos)}</em></td><td class="fr">${esc(w.translation)}</td><td class="ex">${esc(w.example)}</td></tr>`)
        .join('')}</table>`
    : '';
  return `<section class="ed" id="ed-${L}" style="--accent:${ACCENT[L]}">
  <header class="mast"><div class="brand"><span class="logo"></span>DAILY BRIEF</div><div class="meta mono"><b>${t.edition}</b> · ${esc(ed.region)}<br>${longDateFr(input.date)} · N° ${esc(input.issue)}</div></header>
  <section class="lead"><div><div class="kick mono"><b>Morning Brief</b> · ${ed.morningBrief.length} ${t.infos} · 10 min</div><h1>${esc(ed.headline)}</h1>
    <ol class="mb">${ed.morningBrief.map((p, i) => `<li><span class="n mono">0${i + 1}</span><span><b>${esc(p.lead)}</b> ${esc(p.text)}</span></li>`).join('')}</ol></div>
    <aside class="aside"><h3 class="mono">${t.inThisEdition}</h3>${rows}${vocabRow}
      <h3 class="mono" style="margin-top:4mm">Les 3 éditions</h3><div class="eds">${eds}</div>${audio}</aside></section>
  ${kpis(ed)}
  <div class="pb"></div>${sections}${vocab}</section>`;
}

/** Document HTML complet du PDF du jour : éditions FR, EN puis ES, chacune ouverte par sa couverture. */
export async function renderPdfHtml(input: PdfInput, opts: PdfOptions = {}): Promise<string> {
  const editions = LANGS.map((l) => input.editions.find((e) => e.lang === l)).filter((e): e is Edition => e !== undefined);
  if (editions.length === 0) throw new Error('renderPdfHtml : aucune édition à rendre');
  const urls = new Set(editions.flatMap((e) => e.sections.flatMap((s) => s.stories.map((st) => primarySource(st).url))));
  const qr = new Map<string, string>();
  for (const u of urls) qr.set(u, await qrSvg(u));
  const ctx: Ctx = { qr, images: opts.images ?? {} };
  const body = editions.map((e) => edition(e, { ...input, editions }, opts, ctx)).join('');
  return `<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>Daily Brief — ${esc(input.date)}</title><style>${pdfCss()}</style></head><body>${body}</body></html>`;
}
```

- [ ] **Étape 9 : vérifier le succès**

Commande : `npx vitest run packages/render-pdf/test/html.test.ts && npm run typecheck`
Attendu : 6 tests réussis, typage propre.

- [ ] **Étape 10 : commit**

```bash
git add packages/render-pdf package-lock.json
git commit -m "feat(render-pdf): gabarit HTML du PDF porté du prototype (spec §8.5)"
```

---

### Tâche 5 : impression A4 avec Playwright

**Fichiers :**
- Créer : `packages/render-pdf/src/print.ts`, `packages/render-pdf/src/index.ts`
- Test : `packages/render-pdf/test/print.test.ts`

Le pied de page reprend le PDF de démonstration :
- à gauche, « DAILY BRIEF · 06.11.2026 · FR · EN · ES » ;
- à droite, « RÉSUMÉS IA À PARTIR DES ARTICLES CITÉS · n/N ».

Il est rendu par le `footerTemplate` de Chromium, avec Geist Mono intégré.

- [ ] **Étape 1 : écrire le test qui échoue**

```ts
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Brief } from '@daily-brief/schema';
import { describe, expect, it } from 'vitest';
import { renderPdfHtml } from '../src/html';
import { footerTemplate, printPdf } from '../src/print';

const brief: Brief = JSON.parse(readFileSync(new URL('../../../fixtures/brief-2026-11-06.json', import.meta.url), 'utf8'));

describe('printPdf', () => {
  it('compose le pied de page : date, éditions, mention IA et pagination', () => {
    const f = footerTemplate({ date: '2026-11-06', langs: ['fr', 'es'] });
    expect(f).toContain('DAILY BRIEF · 06.11.2026 · FR · ES');
    expect(f).toContain('<span class="pageNumber"></span>/<span class="totalPages"></span>');
  });

  it('imprime la fixture en un PDF A4 d’environ 10 pages', { timeout: 60_000 }, async () => {
    const out = join(mkdtempSync(join(tmpdir(), 'pdf-')), 'Daily Brief 2026-11-06.pdf');
    await printPdf(await renderPdfHtml(brief), out, { date: brief.date, langs: ['fr', 'en', 'es'] });
    const pdf = readFileSync(out);
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
    const pages = (pdf.toString('latin1').match(/\/Type\s*\/Page[^s]/g) ?? []).length;
    expect(pages).toBeGreaterThanOrEqual(8);
    expect(pages).toBeLessThanOrEqual(14);
    expect(pdf.toString('latin1')).toMatch(/\/MediaBox\s*\[0 0 594\.9\d* 841\.9\d*\]/);
  });
});
```

- [ ] **Étape 2 : vérifier l'échec**

Commande : `npx vitest run packages/render-pdf/test/print.test.ts`
Attendu : ÉCHEC, le module `../src/print` est introuvable.

- [ ] **Étape 3 : écrire `print.ts`**

```ts
import { chromium } from 'playwright';
import type { Lang } from '@daily-brief/schema';
import { fontBase64 } from './assets';
import { dottedDate } from './format';

export type FooterInfo = { date: string; langs: Lang[] };

/** Pied de page : « DAILY BRIEF · 06.11.2026 · FR · EN · ES » à gauche, mention IA et pagination à droite. */
export function footerTemplate(info: FooterInfo): string {
  const { mono } = fontBase64();
  const left = ['DAILY BRIEF', dottedDate(info.date), ...info.langs.map((l) => l.toUpperCase())].join(' · ');
  return `<style>@font-face{font-family:"Geist Mono";src:url(data:font/woff2;base64,${mono}) format("woff2")}</style>
<div style="width:100%;margin:0 14mm;display:flex;justify-content:space-between;font:5.6pt 'Geist Mono',monospace;letter-spacing:.06em;color:#8C8D93;text-transform:uppercase">
<span>${left}</span><span>Résumés IA à partir des articles cités · <span class="pageNumber"></span>/<span class="totalPages"></span></span></div>`;
}

/** Imprime le HTML en PDF A4 avec Chromium (Playwright), polices et couleurs comprises. */
export async function printPdf(html: string, outPath: string, footer: FooterInfo): Promise<void> {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'load' });
    await page.evaluate('document.fonts.ready');
    await page.pdf({
      path: outPath,
      format: 'A4',
      printBackground: true,
      preferCSSPageSize: true,
      displayHeaderFooter: true,
      headerTemplate: '<span></span>',
      footerTemplate: footerTemplate(footer),
    });
  } finally {
    await browser.close();
  }
}
```

- [ ] **Étape 4 : écrire `index.ts`**

```ts
export { renderPdfHtml, primarySource, type PdfInput, type PdfOptions } from './html';
export { printPdf, footerTemplate, type FooterInfo } from './print';
export { longDateFr, dottedDate } from './format';
```

- [ ] **Étape 5 : vérifier le succès**

Commande : `npx vitest run packages/render-pdf && npm run typecheck`
Attendu : 8 tests réussis (6 + 2). L'impression prend environ 1 à 2 secondes.

- [ ] **Étape 6 : contrôle visuel du PDF**

```bash
mkdir -p out && npx tsx -e "import {readFileSync} from 'node:fs'; import {renderPdfHtml, printPdf} from './packages/render-pdf/src/index'; const b=JSON.parse(readFileSync('fixtures/brief-2026-11-06.json','utf8')); renderPdfHtml(b,{audio:{fr:{duration:'3:24'}}}).then(h=>printPdf(h,'out/fixture.pdf',{date:b.date,langs:['fr','en','es']})).then(()=>console.log('out/fixture.pdf'))"
```

Ouvrir `out/fixture.pdf` à côté de `design/Daily-Brief-2026-11-06.pdf` et vérifier les points suivants. Les étiquettes de carte peuvent être légèrement décalées.
- Couverture FR identique : titre, Morning Brief, « Dans cette édition », boutons FR/EN/ES, encart audio, chiffres du jour.
- Page 2 identique : sujet Lecornu avec carte, QR code, grille, citation, divergences et lien prépa.
- Pied de page paginé sur chaque page.
- Un clic sur « EN » dans la couverture FR mène bien à l'édition anglaise.

- [ ] **Étape 7 : commit**

```bash
git add packages/render-pdf
git commit -m "feat(render-pdf): impression A4 Playwright, pied de page paginé"
```

---

### Tâche 6 : test visuel du PDF

**Fichiers :**
- Modifier : `package.json` et `package-lock.json` (dépendances de développement pixelmatch et pngjs)
- Créer : `packages/render-pdf/test/visual.test.ts` et les références `packages/render-pdf/test/__screens__/{couverture-fr,sujet-fr-1,vocab-es}.png`

Les tests capturent trois zones du gabarit en mode impression et les comparent pixel à pixel aux références : au-delà de 1 % de pixels différents, le test échoue et écrit l'image de différence dans `out/visual/`. Les références dépendent du rendu des polices par Chromium : elles sont produites dans ce conteneur, qui est aussi celui de la routine.

- [ ] **Étape 1 : installer les outils de comparaison**

```bash
npm install -D pixelmatch@^7.2.0 pngjs@^7.0.0 @types/pngjs@^6.0.5
```

- [ ] **Étape 2 : écrire le test**

```ts
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import pixelmatch from 'pixelmatch';
import { chromium, type Browser } from 'playwright';
import { PNG } from 'pngjs';
import type { Brief } from '@daily-brief/schema';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { renderPdfHtml } from '../src/html';

/**
 * Test visuel du PDF (spec §13) : capture des zones clés du gabarit en mode impression,
 * comparées pixel à pixel aux références de test/__screens__ (écart toléré : 1 % des pixels).
 * Mettre à jour les références après un changement voulu : UPDATE_VISUAL=1 npx vitest run packages/render-pdf/test/visual.test.ts
 */
const SCREENS = fileURLToPath(new URL('./__screens__/', import.meta.url));
const DIFFS = fileURLToPath(new URL('../../../out/visual/', import.meta.url));
const UPDATE = process.env.UPDATE_VISUAL === '1';
const MAX_DIFF_RATIO = 0.01;

const SHOTS = [
  { name: 'couverture-fr', selector: '#ed-fr > .lead' },
  { name: 'sujet-fr-1', selector: '#ed-fr .story' },
  { name: 'vocab-es', selector: '#ed-es .voc' },
];

const brief: Brief = JSON.parse(readFileSync(new URL('../../../fixtures/brief-2026-11-06.json', import.meta.url), 'utf8'));

describe('rendu visuel du PDF', () => {
  let browser: Browser;
  let html: string;
  beforeAll(async () => {
    browser = await chromium.launch();
    html = await renderPdfHtml(brief, { audio: { fr: { duration: '3:24' } } });
  }, 60_000);
  afterAll(async () => browser?.close());

  for (const shot of SHOTS) {
    it(`${shot.name} correspond à la référence`, { timeout: 60_000 }, async () => {
      const page = await browser.newPage({ viewport: { width: 800, height: 1200 }, deviceScaleFactor: 1 });
      await page.emulateMedia({ media: 'print' });
      await page.setContent(html, { waitUntil: 'load' });
      await page.addStyleTag({ content: 'body{width:182mm;margin:0 auto;background:#fff}' });
      await page.evaluate('document.fonts.ready');
      const actual = PNG.sync.read(await page.locator(shot.selector).first().screenshot({ animations: 'disabled' }));
      await page.close();

      const refPath = `${SCREENS}${shot.name}.png`;
      if (UPDATE || !existsSync(refPath)) {
        if (!UPDATE) throw new Error(`référence absente : ${refPath} (lance UPDATE_VISUAL=1 pour la créer, puis vérifie l’image)`);
        mkdirSync(SCREENS, { recursive: true });
        writeFileSync(refPath, PNG.sync.write(actual));
        return;
      }
      const expected = PNG.sync.read(readFileSync(refPath));
      expect(`${actual.width}×${actual.height}`).toBe(`${expected.width}×${expected.height}`);
      const diff = new PNG({ width: actual.width, height: actual.height });
      const changed = pixelmatch(actual.data, expected.data, diff.data, actual.width, actual.height, { threshold: 0.1 });
      const ratio = changed / (actual.width * actual.height);
      if (ratio > MAX_DIFF_RATIO) {
        mkdirSync(DIFFS, { recursive: true });
        writeFileSync(`${DIFFS}${shot.name}.diff.png`, PNG.sync.write(diff));
        writeFileSync(`${DIFFS}${shot.name}.actual.png`, PNG.sync.write(actual));
      }
      expect(ratio, `${(ratio * 100).toFixed(2)} % de pixels différents, voir out/visual/`).toBeLessThanOrEqual(MAX_DIFF_RATIO);
    });
  }
});
```

- [ ] **Étape 3 : vérifier l'échec sans référence**

Commande : `npx vitest run packages/render-pdf/test/visual.test.ts`
Attendu : 3 échecs « référence absente : … (lance UPDATE_VISUAL=1 pour la créer, puis vérifie l’image) ».

- [ ] **Étape 4 : créer les références et les vérifier à l'œil**

Commande : `UPDATE_VISUAL=1 npx vitest run packages/render-pdf/test/visual.test.ts`
Attendu : 3 tests réussis et 3 fichiers PNG dans `packages/render-pdf/test/__screens__/`.

Ouvrir les trois images et les comparer au PDF de démonstration :
- `couverture-fr.png` : titre du jour, Morning Brief et encadré ;
- `sujet-fr-1.png` : sujet Lecornu complet, avec sa carte et son QR code ;
- `vocab-es.png` : tableau de 6 mots.

Une image fausse (police absente, mise en page cassée) ne doit pas devenir une référence.

- [ ] **Étape 5 : vérifier la comparaison**

Commande : `npx vitest run packages/render-pdf/test/visual.test.ts`
Attendu : 3 tests réussis, cette fois en comparant aux références.

- [ ] **Étape 6 : commit**

```bash
git add package.json package-lock.json packages/render-pdf/test
git commit -m "test(render-pdf): comparaison visuelle du PDF avec des références"
```

---

### Tâche 7 : client Pexels

**Fichiers :**
- Créer : `pipeline/render/http.ts`, `pipeline/render/pexels.ts`, `fixtures/api/README.md`, `fixtures/api/pexels-search.json`, `pipeline/test/render/fake-fetch.ts`
- Test : `pipeline/test/render/pexels.test.ts`

La requête Pexels arrive déjà validée par R11 (`brief:verify`) : objets ou lieux, jamais de personne. Le client demande des photos paysage et prend la première dont la largeur dépasse la hauteur. Il garde la taille `large` (940 px de large), suffisante pour une colonne de 66 mm.

- [ ] **Étape 1 : écrire la réponse d'API de test**

`fixtures/api/README.md` :

```markdown
# Réponses d'API pour les tests

Réponses **construites** d'après la documentation publique des API (forme des champs), pas des enregistrements réels. Elles servent à tester l'analyse des réponses sans appel réseau.

- `pexels-search.json` : `GET https://api.pexels.com/v1/search` (documentation Pexels API v1, objet `Photo`). La première photo est en portrait, pour vérifier que le client préfère une photo paysage.
```

`fixtures/api/pexels-search.json` :

```json
{
  "page": 1,
  "per_page": 5,
  "total_results": 2,
  "photos": [
    {
      "id": 1001,
      "width": 3000,
      "height": 4500,
      "url": "https://www.pexels.com/photo/portrait-train-1001/",
      "photographer": "Ana Portrait",
      "photographer_url": "https://www.pexels.com/@ana-portrait",
      "photographer_id": 11,
      "avg_color": "#5A5A5A",
      "src": {
        "original": "https://images.pexels.com/photos/1001/pexels-photo-1001.jpeg",
        "large2x": "https://images.pexels.com/photos/1001/pexels-photo-1001.jpeg?auto=compress&cs=tinysrgb&dpr=2&h=650&w=940",
        "large": "https://images.pexels.com/photos/1001/pexels-photo-1001.jpeg?auto=compress&cs=tinysrgb&h=650&w=940",
        "medium": "https://images.pexels.com/photos/1001/pexels-photo-1001.jpeg?auto=compress&cs=tinysrgb&h=350",
        "small": "https://images.pexels.com/photos/1001/pexels-photo-1001.jpeg?auto=compress&cs=tinysrgb&h=130",
        "portrait": "https://images.pexels.com/photos/1001/pexels-photo-1001.jpeg?auto=compress&cs=tinysrgb&fit=crop&h=1200&w=800",
        "landscape": "https://images.pexels.com/photos/1001/pexels-photo-1001.jpeg?auto=compress&cs=tinysrgb&fit=crop&h=627&w=1200",
        "tiny": "https://images.pexels.com/photos/1001/pexels-photo-1001.jpeg?auto=compress&cs=tinysrgb&dpr=1&fit=crop&h=200&w=280"
      },
      "liked": false,
      "alt": "Train in a station, portrait"
    },
    {
      "id": 2002,
      "width": 6000,
      "height": 4000,
      "url": "https://www.pexels.com/photo/high-speed-train-2002/",
      "photographer": "Jo Rails",
      "photographer_url": "https://www.pexels.com/@jo-rails",
      "photographer_id": 22,
      "avg_color": "#7A8590",
      "src": {
        "original": "https://images.pexels.com/photos/2002/pexels-photo-2002.jpeg",
        "large2x": "https://images.pexels.com/photos/2002/pexels-photo-2002.jpeg?auto=compress&cs=tinysrgb&dpr=2&h=650&w=940",
        "large": "https://images.pexels.com/photos/2002/pexels-photo-2002.jpeg?auto=compress&cs=tinysrgb&h=650&w=940",
        "medium": "https://images.pexels.com/photos/2002/pexels-photo-2002.jpeg?auto=compress&cs=tinysrgb&h=350",
        "small": "https://images.pexels.com/photos/2002/pexels-photo-2002.jpeg?auto=compress&cs=tinysrgb&h=130",
        "portrait": "https://images.pexels.com/photos/2002/pexels-photo-2002.jpeg?auto=compress&cs=tinysrgb&fit=crop&h=1200&w=800",
        "landscape": "https://images.pexels.com/photos/2002/pexels-photo-2002.jpeg?auto=compress&cs=tinysrgb&fit=crop&h=627&w=1200",
        "tiny": "https://images.pexels.com/photos/2002/pexels-photo-2002.jpeg?auto=compress&cs=tinysrgb&dpr=1&fit=crop&h=200&w=280"
      },
      "liked": false,
      "alt": "High-speed train at speed"
    }
  ],
  "next_page": null
}
```

- [ ] **Étape 2 : écrire le type `FetchLike` et le faux `fetch` de test**

`pipeline/render/http.ts` :

```ts
/** Sous-ensemble de `fetch` utilisé par le rendu : injectable dans les tests, aucun appel réseau réel. */
export type FetchLike = (
  url: string,
  init?: { headers?: Record<string, string> },
) => Promise<{
  ok: boolean;
  status: number;
  headers: { get(name: string): string | null };
  json(): Promise<unknown>;
  arrayBuffer(): Promise<ArrayBuffer>;
}>;
```

`pipeline/test/render/fake-fetch.ts` :

```ts
import type { FetchLike } from '../../render/http';

type Reply = { status?: number; json?: unknown; body?: Uint8Array; type?: string };

/** Faux `fetch` : associe un préfixe d'URL à une réponse et enregistre les appels. */
export function fakeFetch(routes: Record<string, Reply | (() => never)>) {
  const calls: { url: string; headers?: Record<string, string> }[] = [];
  const fetch: FetchLike = async (url, init) => {
    calls.push({ url, headers: init?.headers });
    const key = Object.keys(routes).find((k) => url.startsWith(k));
    if (!key) return { ok: false, status: 404, headers: { get: () => null }, json: async () => ({}), arrayBuffer: async () => new ArrayBuffer(0) };
    const r = routes[key];
    if (typeof r === 'function') r();
    const reply = r as Reply;
    const status = reply.status ?? 200;
    const body = reply.body ?? new Uint8Array();
    return {
      ok: status < 400,
      status,
      headers: { get: (n: string) => (n.toLowerCase() === 'content-type' ? reply.type ?? 'application/json' : null) },
      json: async () => reply.json,
      arrayBuffer: async () => body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength) as ArrayBuffer,
    };
  };
  return { fetch, calls };
}
```

- [ ] **Étape 3 : écrire le test qui échoue**

```ts
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { findPhoto } from '../../render/pexels';
import { repoPath } from '../helpers';
import { fakeFetch } from './fake-fetch';

const search = JSON.parse(readFileSync(repoPath('fixtures/api/pexels-search.json'), 'utf8'));

describe('findPhoto', () => {
  it('envoie la clé et la requête, et préfère une photo paysage', async () => {
    const { fetch, calls } = fakeFetch({ 'https://api.pexels.com/v1/search': { json: search } });
    const photo = await findPhoto('high-speed train', { apiKey: 'cle-test', fetch });
    expect(calls[0].headers).toEqual({ Authorization: 'cle-test' });
    expect(calls[0].url).toContain('query=high-speed+train');
    expect(calls[0].url).toContain('orientation=landscape');
    expect(photo).toEqual({
      id: 2002,
      src: 'https://images.pexels.com/photos/2002/pexels-photo-2002.jpeg?auto=compress&cs=tinysrgb&h=650&w=940',
      width: 6000,
      height: 4000,
      photographer: 'Jo Rails',
      photographerUrl: 'https://www.pexels.com/@jo-rails',
      pexelsUrl: 'https://www.pexels.com/photo/high-speed-train-2002/',
      alt: 'High-speed train at speed',
    });
  });

  it('renvoie null sans résultat et lève une erreur sur un statut HTTP en erreur', async () => {
    const empty = fakeFetch({ 'https://api.pexels.com': { json: { photos: [] } } });
    expect(await findPhoto('x', { apiKey: 'k', fetch: empty.fetch })).toBeNull();
    const denied = fakeFetch({ 'https://api.pexels.com': { status: 401, json: {} } });
    await expect(findPhoto('x', { apiKey: 'k', fetch: denied.fetch })).rejects.toThrow(/Pexels 401/);
  });
});
```

- [ ] **Étape 4 : vérifier l'échec**

Commande : `npx vitest run pipeline/test/render/pexels.test.ts`
Attendu : ÉCHEC, le module `../../render/pexels` est introuvable.

- [ ] **Étape 5 : écrire `pexels.ts`**

```ts
import { z } from 'zod';
import type { PexelsPhoto } from '@daily-brief/schema';
import type { FetchLike } from './http';

const SEARCH = 'https://api.pexels.com/v1/search';

const PexelsSearchSchema = z.object({
  photos: z.array(
    z.object({
      id: z.number(),
      width: z.number(),
      height: z.number(),
      url: z.string(),
      photographer: z.string(),
      photographer_url: z.string(),
      alt: z.string().nullable().optional(),
      src: z.object({ large: z.string(), landscape: z.string() }),
    }),
  ),
});

/**
 * Cherche une photo libre de droits sur Pexels (R11 : la requête a déjà été validée par brief:verify).
 * Renvoie la première photo paysage, ou null si aucune ; lève une erreur si l'API répond en erreur.
 */
export async function findPhoto(query: string, opts: { apiKey: string; fetch: FetchLike }): Promise<PexelsPhoto | null> {
  const url = `${SEARCH}?${new URLSearchParams({ query, orientation: 'landscape', per_page: '5', size: 'medium' })}`;
  const res = await opts.fetch(url, { headers: { Authorization: opts.apiKey } });
  if (!res.ok) throw new Error(`Pexels ${res.status} pour « ${query} »`);
  const { photos } = PexelsSearchSchema.parse(await res.json());
  const p = photos.find((x) => x.width > x.height) ?? photos[0];
  if (!p) return null;
  return {
    id: p.id,
    src: p.src.large,
    width: p.width,
    height: p.height,
    photographer: p.photographer,
    photographerUrl: p.photographer_url,
    pexelsUrl: p.url,
    ...(p.alt ? { alt: p.alt } : {}),
  };
}
```

- [ ] **Étape 6 : vérifier le succès**

Commande : `npx vitest run pipeline/test/render/pexels.test.ts && npm run typecheck`
Attendu : 2 tests réussis, typage propre.

- [ ] **Étape 7 : commit**

```bash
git add pipeline/render fixtures/api pipeline/test/render
git commit -m "feat(render): client Pexels (photos paysage, crédit du photographe)"
```

---

### Tâche 8 : photos des sujets, images intégrées, numéro du jour

**Fichiers :**
- Créer : `pipeline/render/photos.ts`, `pipeline/render/images.ts`, `pipeline/render/issue.ts`
- Test : `pipeline/test/render/photos.test.ts`, `pipeline/test/render/images.test.ts`, `pipeline/test/render/issue.test.ts`

- [ ] **Étape 1 : écrire les trois tests qui échouent**

`pipeline/test/render/photos.test.ts` :

```ts
import { describe, expect, it } from 'vitest';
import type { PexelsPhoto } from '@daily-brief/schema';
import { fillPhotos } from '../../render/photos';
import { fixtureEdition } from '../helpers';

const photo = (id: number): PexelsPhoto => ({
  id,
  src: `https://images.pexels.com/photos/${id}/p.jpeg`,
  width: 6000,
  height: 4000,
  photographer: 'P',
  photographerUrl: 'https://www.pexels.com/@p',
  pexelsUrl: `https://www.pexels.com/photo/${id}/`,
});

const photoStories = (ed: ReturnType<typeof fixtureEdition>) =>
  ed.sections.flatMap((s) => s.stories).filter((st) => st.visual.type === 'photo');

describe('fillPhotos', () => {
  it('renseigne les photos, une recherche par requête, sans modifier l’entrée', async () => {
    const ed = fixtureEdition('fr');
    const before = JSON.stringify(ed);
    const queries: string[] = [];
    const r = await fillPhotos(ed, async (q) => {
      queries.push(q);
      return photo(queries.length);
    });
    expect(JSON.stringify(ed)).toBe(before);
    expect(queries).toEqual(['car factory', 'high-speed train']);
    for (const st of photoStories(r.edition)) expect(st.visual.type === 'photo' && st.visual.pexels).toBeTruthy();
    expect(r.problems).toEqual([]);
  });

  it('signale une recherche sans résultat ou en erreur, sans bloquer', async () => {
    const r = await fillPhotos(fixtureEdition('fr'), async (q) => {
      if (q === 'car factory') throw new Error('Pexels 500');
      return null;
    });
    expect(r.problems).toEqual([
      '2026-11-06-fr-5 : Pexels 500',
      '2026-11-06-fr-6 : aucune photo Pexels pour « high-speed train »',
    ]);
    for (const st of photoStories(r.edition)) expect(st.visual.type === 'photo' && st.visual.pexels).toBeFalsy();
  });

  it('ne refait pas la recherche d’une photo déjà renseignée', async () => {
    const first = await fillPhotos(fixtureEdition('fr'), async () => photo(1));
    let calls = 0;
    await fillPhotos(first.edition, async () => {
      calls++;
      return photo(2);
    });
    expect(calls).toBe(0);
  });
});
```

`pipeline/test/render/images.test.ts` :

```ts
import { describe, expect, it } from 'vitest';
import { fetchAsDataUri, MAX_IMAGE_BYTES } from '../../render/images';
import { fakeFetch } from './fake-fetch';

describe('fetchAsDataUri', () => {
  it('encode une image en data URI', async () => {
    const { fetch } = fakeFetch({ 'https://img/': { body: new Uint8Array([1, 2, 3]), type: 'image/jpeg' } });
    expect(await fetchAsDataUri('https://img/a.jpg', fetch)).toBe('data:image/jpeg;base64,AQID');
  });

  it('renvoie null sur une erreur, un type non image, un corps vide ou trop lourd', async () => {
    const { fetch } = fakeFetch({
      'https://img/404': { status: 404 },
      'https://img/html': { body: new Uint8Array([1]), type: 'text/html' },
      'https://img/empty': { type: 'image/png' },
      'https://img/big': { body: new Uint8Array(MAX_IMAGE_BYTES + 1), type: 'image/png' },
      'https://img/throw': () => {
        throw new Error('réseau');
      },
    });
    for (const u of ['404', 'html', 'empty', 'big', 'throw']) expect(await fetchAsDataUri(`https://img/${u}`, fetch), u).toBeNull();
  });
});
```

`pipeline/test/render/issue.test.ts` :

```ts
import { describe, expect, it } from 'vitest';
import { issueNumber, pdfFileName } from '../../render/issue';

describe('numéro et nom du PDF', () => {
  it('numérote depuis le lancement du 06/11/2026', () => {
    expect(issueNumber('2026-11-06')).toBe('001');
    expect(issueNumber('2026-11-07')).toBe('002');
    expect(issueNumber('2027-11-06')).toBe('366');
    expect(() => issueNumber('2026-11-05')).toThrow(/antérieure/);
  });

  it('nomme le PDF comme la spec §8.5', () => {
    expect(pdfFileName('2026-11-06')).toBe('Daily Brief 2026-11-06.pdf');
  });
});
```

- [ ] **Étape 2 : vérifier l'échec**

Commande : `npx vitest run pipeline/test/render/photos.test.ts pipeline/test/render/images.test.ts pipeline/test/render/issue.test.ts`
Attendu : 3 fichiers en ÉCHEC, modules introuvables.

- [ ] **Étape 3 : écrire `photos.ts`**

```ts
import type { Edition, PexelsPhoto } from '@daily-brief/schema';

export type PhotoFinder = (query: string) => Promise<PexelsPhoto | null>;

/**
 * Renseigne `visual.pexels` des sujets illustrés par une photo qui n'en ont pas encore.
 * Une recherche par requête distincte ; un échec laisse le sujet sans photo et est signalé.
 */
export async function fillPhotos(ed: Edition, find: PhotoFinder): Promise<{ edition: Edition; problems: string[] }> {
  const out = structuredClone(ed);
  const problems: string[] = [];
  const cache = new Map<string, PexelsPhoto | null>();
  for (const story of out.sections.flatMap((s) => s.stories)) {
    const v = story.visual;
    if (v.type !== 'photo' || v.pexels) continue;
    if (!cache.has(v.query)) {
      try {
        cache.set(v.query, await find(v.query));
      } catch (e) {
        cache.set(v.query, null);
        problems.push(`${story.id} : ${(e as Error).message}`);
        continue;
      }
    }
    const photo = cache.get(v.query);
    if (photo) v.pexels = photo;
    else problems.push(`${story.id} : aucune photo Pexels pour « ${v.query} »`);
  }
  return { edition: out, problems };
}
```

- [ ] **Étape 4 : écrire `images.ts`**

Les images sont intégrées au PDF en data URI : l'impression ne dépend alors ni du réseau ni de la disponibilité de Pexels au moment de l'impression.

```ts
import type { FetchLike } from './http';

export const MAX_IMAGE_BYTES = 3_000_000;

/** Télécharge une image et la renvoie en data URI pour l'intégrer au PDF ; null en cas d'échec ou si trop lourde. */
export async function fetchAsDataUri(url: string, fetch: FetchLike): Promise<string | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const type = res.headers.get('content-type') ?? 'image/jpeg';
    if (!type.startsWith('image/')) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length === 0 || buf.length > MAX_IMAGE_BYTES) return null;
    return `data:${type};base64,${buf.toString('base64')}`;
  } catch {
    return null;
  }
}
```

- [ ] **Étape 5 : écrire `issue.ts`**

```ts
/** Date de la première édition (spec §13 : lancement le 06/11/2026, N° 001). */
export const LAUNCH_DATE = '2026-11-06';

/** Numéro du jour sur 3 chiffres : 2026-11-06 → « 001 », 2026-11-07 → « 002 ». */
export function issueNumber(date: string, launch = LAUNCH_DATE): string {
  const days = Math.round((Date.parse(`${date}T00:00:00Z`) - Date.parse(`${launch}T00:00:00Z`)) / 86_400_000);
  if (!Number.isFinite(days) || days < 0) throw new Error(`date antérieure au lancement : ${date}`);
  return String(days + 1).padStart(3, '0');
}

export const pdfFileName = (date: string) => `Daily Brief ${date}.pdf`;
```

- [ ] **Étape 6 : vérifier le succès**

Commande : `npx vitest run pipeline/test/render && npm run typecheck`
Attendu : 9 tests réussis (2 + 3 + 2 + 2), typage propre.

- [ ] **Étape 7 : commit**

```bash
git add pipeline/render pipeline/test/render
git commit -m "feat(render): photos des sujets, images intégrées, numéro du jour"
```

---

### Tâche 9 : `npm run brief:render`

**Fichiers :**
- Créer : `pipeline/render/run-render.ts`, `pipeline/render/cli.ts`
- Modifier : `pipeline/package.json` (dépendance `@daily-brief/render-pdf`), `package.json` (script `brief:render`)
- Test : `pipeline/test/render/run-render.test.ts`

Comportement attendu :
- **Entrées et sorties.** La commande lit `{lang}.verified.json`, renseigne les photos si `PEXELS_API_KEY` est définie, et écrit `{lang}.final.json`, qui sera publié au lot 4.
- **Images et audio.** Elle télécharge les images. Elle lit `audio.json` s'il existe (fichier écrit par le lot 5, de la forme `{ "fr": { "duration": "3:24" } }`).
- **PDF et rapport.** Elle imprime le PDF puis écrit `render-report.json`.
- **Éditions incomplètes.** Une édition absente ou invalide est omise et signalée.
- **Codes de sortie.** Sans aucune édition, pas de PDF et code 2. Sinon, code 0, même avec des avertissements (photo ou audio manquants), car le §12 veut une publication dégradée plutôt qu'aucune.
- **Clé Pexels.** Le CLI charge `.env` s'il existe, avec `process.loadEnvFile` (Node 22). La routine y écrit les secrets lus dans Supabase Vault (§6.3).

- [ ] **Étape 1 : déclarer les dépendances et le script**

Remplacer `pipeline/package.json` par :

```json
{
  "name": "@daily-brief/pipeline",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "dependencies": {
    "@daily-brief/render-pdf": "*",
    "@daily-brief/schema": "*",
    "zod": "^4.0.0"
  }
}
```

Dans `package.json` (racine), ajouter dans `"scripts"`, après `brief:verify` :

```json
    "brief:render": "tsx pipeline/render/cli.ts",
```

Commande : `npm install`

- [ ] **Étape 2 : écrire le test qui échoue**

```ts
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { FooterInfo } from '@daily-brief/render-pdf';
import { runRender } from '../../render/run-render';
import { fixtureBrief, repoPath } from '../helpers';
import { fakeFetch } from './fake-fetch';

const search = JSON.parse(readFileSync(repoPath('fixtures/api/pexels-search.json'), 'utf8'));

function day(langs = ['fr', 'en', 'es']) {
  const outDir = mkdtempSync(join(tmpdir(), 'render-'));
  const dayDir = join(outDir, '2026-11-06');
  mkdirSync(dayDir, { recursive: true });
  for (const e of fixtureBrief().editions) if (langs.includes(e.lang)) writeFileSync(join(dayDir, `${e.lang}.verified.json`), JSON.stringify(e));
  return { outDir, dayDir };
}

function printer() {
  const printed: { html: string; outPath: string; footer: FooterInfo }[] = [];
  const print = async (html: string, outPath: string, footer: FooterInfo) => {
    printed.push({ html, outPath, footer });
    writeFileSync(outPath, '%PDF-fake');
  };
  return { print, printed };
}

const net = () =>
  fakeFetch({
    'https://api.pexels.com/v1/search': { json: search },
    'https://images.pexels.com/': { body: new Uint8Array([255, 216, 255]), type: 'image/jpeg' },
  });

describe('runRender', () => {
  it('complète les photos, écrit les éditions finales, le PDF et le rapport', async () => {
    const { outDir, dayDir } = day();
    const { print, printed } = printer();
    const r = await runRender({ outDir, date: '2026-11-06', pexelsApiKey: 'k', fetch: net().fetch, print });
    expect(r.exitCode).toBe(0);
    expect(r.pdfPath).toBe(join(dayDir, 'Daily Brief 2026-11-06.pdf'));
    expect(existsSync(r.pdfPath!)).toBe(true);
    expect(printed[0].footer).toEqual({ date: '2026-11-06', langs: ['fr', 'en', 'es'] });
    expect(printed[0].html).toContain('src="data:image/jpeg;base64,/9j/"');
    expect(printed[0].html).toContain('N° 001');
    const fr = JSON.parse(readFileSync(join(dayDir, 'fr.final.json'), 'utf8'));
    const photo = fr.sections.flatMap((s: { stories: { visual: { type: string; pexels?: { id: number } } }[] }) => s.stories).find((st: { visual: { type: string } }) => st.visual.type === 'photo');
    expect(photo.visual.pexels.id).toBe(2002);
    const report = JSON.parse(readFileSync(join(dayDir, 'render-report.json'), 'utf8'));
    expect(report).toMatchObject({ exitCode: 0, langs: ['fr', 'en', 'es'] });
  });

  it('rend les éditions présentes et ajoute l’encart audio si audio.json existe', async () => {
    const { outDir, dayDir } = day(['fr']);
    writeFileSync(join(dayDir, 'audio.json'), JSON.stringify({ fr: { duration: '3:24' } }));
    const { print, printed } = printer();
    const r = await runRender({ outDir, date: '2026-11-06', fetch: net().fetch, print });
    expect(r.langs).toEqual(['fr']);
    expect(r.issues).toContainEqual(expect.objectContaining({ lang: 'en', level: 'warning' }));
    expect(r.issues).toContainEqual(expect.objectContaining({ lang: 'fr', message: expect.stringMatching(/PEXELS_API_KEY/) }));
    expect(printed[0].html).toContain('3:24 · voix Chirp HD');
    expect(printed[0].footer.langs).toEqual(['fr']);
  });

  it('ignore un audio.json illisible avec un avertissement', async () => {
    const { outDir, dayDir } = day(['fr']);
    writeFileSync(join(dayDir, 'audio.json'), JSON.stringify({ fr: { duration: '' } }));
    const { print, printed } = printer();
    const r = await runRender({ outDir, date: '2026-11-06', fetch: net().fetch, print });
    expect(r.exitCode).toBe(0);
    expect(r.issues).toContainEqual(expect.objectContaining({ message: expect.stringMatching(/audio\.json illisible/) }));
    expect(printed[0].html).not.toContain('Version audio');
  });

  it('sans édition valide : pas de PDF, code 2', async () => {
    const { outDir, dayDir } = day([]);
    writeFileSync(join(dayDir, 'fr.verified.json'), '{');
    const { print, printed } = printer();
    const r = await runRender({ outDir, date: '2026-11-06', fetch: net().fetch, print });
    expect(r.exitCode).toBe(2);
    expect(printed).toHaveLength(0);
    expect(r.issues).toContainEqual(expect.objectContaining({ lang: 'fr', level: 'error' }));
  });

  it('refuse une date invalide', async () => {
    const r = await runRender({ outDir: tmpdir(), date: '2026-13-45', fetch: net().fetch, print: printer().print });
    expect(r.exitCode).toBe(2);
  });
});
```

- [ ] **Étape 3 : vérifier l'échec**

Commande : `npx vitest run pipeline/test/render/run-render.test.ts`
Attendu : ÉCHEC, le module `../../render/run-render` est introuvable.

- [ ] **Étape 4 : écrire `run-render.ts`**

`audio.json` est validé avec `z.partialRecord`. En Zod 4, `z.record` sur une énumération exige **toutes** les clés, donc un audio seulement en FR serait refusé.

```ts
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import { IsoDateSchema, LANGS, parseEdition, type Edition, type Lang } from '@daily-brief/schema';
import { printPdf, renderPdfHtml, type FooterInfo } from '@daily-brief/render-pdf';
import type { FetchLike } from './http';
import { fetchAsDataUri } from './images';
import { issueNumber, pdfFileName } from './issue';
import { findPhoto } from './pexels';
import { fillPhotos } from './photos';

export type RenderIssue = { level: 'error' | 'warning'; lang?: Lang; message: string };

export type RunRenderOptions = {
  outDir: string;
  date: string;
  /** Clé Pexels ; sans clé, les sujets illustrés par une photo sont rendus sans image. */
  pexelsApiKey?: string;
  fetch: FetchLike;
  /** Imprimante PDF, remplaçable dans les tests. */
  print?: (html: string, outPath: string, footer: FooterInfo) => Promise<void>;
};

export type RunRenderResult = { issues: RenderIssue[]; exitCode: 0 | 2; pdfPath: string | null; langs: Lang[] };

/** `audio.json` (écrit par le lot 5) : durée par édition, toutes facultatives. */
const AudioSchema = z.partialRecord(z.enum(['fr', 'en', 'es']), z.object({ duration: z.string().min(1) }));

/**
 * Lit `out/<date>/{lang}.verified.json`, complète les photos Pexels, écrit `{lang}.final.json`
 * puis `Daily Brief <date>.pdf` et `render-report.json`. Une édition absente ou invalide est
 * simplement omise ; sans aucune édition, pas de PDF et code 2.
 */
export async function runRender(opts: RunRenderOptions): Promise<RunRenderResult> {
  const issues: RenderIssue[] = [];
  if (!IsoDateSchema.safeParse(opts.date).success) {
    return { issues: [{ level: 'error', message: `date incorrecte : « ${opts.date} »` }], exitCode: 2, pdfPath: null, langs: [] };
  }
  const dayDir = join(opts.outDir, opts.date);
  mkdirSync(dayDir, { recursive: true });
  const pdfPath = join(dayDir, pdfFileName(opts.date));
  rmSync(pdfPath, { force: true });

  const editions: Edition[] = [];
  for (const lang of LANGS) {
    const path = join(dayDir, `${lang}.verified.json`);
    rmSync(join(dayDir, `${lang}.final.json`), { force: true });
    if (!existsSync(path)) {
      issues.push({ level: 'warning', lang, message: `${lang}.verified.json absent : édition omise` });
      continue;
    }
    let parsed: ReturnType<typeof parseEdition>;
    try {
      parsed = parseEdition(JSON.parse(readFileSync(path, 'utf8')));
    } catch (e) {
      issues.push({ level: 'error', lang, message: `${lang}.verified.json illisible : ${(e as Error).message}` });
      continue;
    }
    if (!parsed.success) {
      issues.push({ level: 'error', lang, message: `${lang}.verified.json invalide : ${parsed.errors.join(' ; ')}` });
      continue;
    }
    let ed = parsed.data;
    if (opts.pexelsApiKey) {
      const apiKey = opts.pexelsApiKey;
      const r = await fillPhotos(ed, (q) => findPhoto(q, { apiKey, fetch: opts.fetch }));
      ed = r.edition;
      for (const message of r.problems) issues.push({ level: 'warning', lang, message });
    } else if (ed.sections.some((s) => s.stories.some((st) => st.visual.type === 'photo' && !st.visual.pexels))) {
      issues.push({ level: 'warning', lang, message: 'PEXELS_API_KEY absente : sujets illustrés rendus sans photo' });
    }
    writeFileSync(join(dayDir, `${lang}.final.json`), JSON.stringify(ed, null, 2) + '\n');
    editions.push(ed);
  }

  if (editions.length === 0) {
    issues.push({ level: 'error', message: 'aucune édition à rendre : pas de PDF' });
    return finish(dayDir, opts.date, issues, null, []);
  }

  const images: Record<string, string> = {};
  for (const src of new Set(editions.flatMap((e) => e.sections.flatMap((s) => s.stories.flatMap((st) => (st.visual.type === 'photo' && st.visual.pexels ? [st.visual.pexels.src] : [])))))) {
    const data = await fetchAsDataUri(src, opts.fetch);
    if (data) images[src] = data;
    else issues.push({ level: 'warning', message: `image Pexels non téléchargée : ${src}` });
  }

  let audio: z.infer<typeof AudioSchema> | undefined;
  const audioPath = join(dayDir, 'audio.json');
  if (existsSync(audioPath)) {
    try {
      audio = AudioSchema.parse(JSON.parse(readFileSync(audioPath, 'utf8')));
    } catch (e) {
      issues.push({ level: 'warning', message: `audio.json illisible, PDF sans encart audio : ${(e as Error).message}` });
    }
  }

  const langs = editions.map((e) => e.lang);
  const html = await renderPdfHtml({ date: opts.date, issue: issueNumber(opts.date), editions }, { images, audio });
  await (opts.print ?? printPdf)(html, pdfPath, { date: opts.date, langs });
  return finish(dayDir, opts.date, issues, pdfPath, langs);
}

function finish(dayDir: string, date: string, issues: RenderIssue[], pdfPath: string | null, langs: Lang[]): RunRenderResult {
  const exitCode = pdfPath ? 0 : 2;
  writeFileSync(
    join(dayDir, 'render-report.json'),
    JSON.stringify({ date, generatedAt: new Date().toISOString(), exitCode, pdf: pdfPath, langs, issues }, null, 2) + '\n',
  );
  return { issues, exitCode, pdfPath, langs };
}
```

- [ ] **Étape 5 : écrire `cli.ts`**

```ts
import { parseArgs } from 'node:util';
import { parisToday } from '../lib/date';
import type { FetchLike } from './http';
import { runRender } from './run-render';

try {
  try {
    process.loadEnvFile('.env');
  } catch {
    /* pas de .env : variables d'environnement du processus seulement */
  }
  const { values } = parseArgs({ options: { date: { type: 'string' }, out: { type: 'string', default: 'out' } } });
  const date = values.date ?? parisToday();
  const r = await runRender({ outDir: values.out!, date, pexelsApiKey: process.env.PEXELS_API_KEY, fetch: fetch as FetchLike });
  console.log(`brief:render ${date}`);
  for (const i of r.issues) console.log(`[${i.level}]${i.lang ? ' ' + i.lang.toUpperCase() : ''} ${i.message}`);
  console.log(r.pdfPath ? `PDF : ${r.pdfPath} (${r.langs.join(', ').toUpperCase()})` : 'Erreur : aucun PDF produit.');
  process.exit(r.exitCode);
} catch (e) {
  console.error(`brief:render : ${(e as Error).message}`);
  process.exit(2);
}
```

- [ ] **Étape 6 : vérifier le succès**

Commande : `npx vitest run pipeline/test/render && npm run typecheck`
Attendu : 14 tests réussis, typage propre.

- [ ] **Étape 7 : essai de bout en bout sur la fixture**

```bash
rm -rf out/2026-11-06 && mkdir -p out/2026-11-06 && node -e "const b=require('./fixtures/brief-2026-11-06.json');for(const e of b.editions)require('fs').writeFileSync('out/2026-11-06/'+e.lang+'.json',JSON.stringify(e,null,2))"
```

```bash
npm run -s brief:verify -- --date 2026-11-06 > /dev/null; echo "verify=$?"
```

```bash
env -u PEXELS_API_KEY npm run -s brief:render -- --date 2026-11-06; echo "render=$?"
```

Attendu : `verify=1`, puis :

```text
brief:render 2026-11-06
[warning] FR PEXELS_API_KEY absente : sujets illustrés rendus sans photo
[warning] ES PEXELS_API_KEY absente : sujets illustrés rendus sans photo
PDF : out/2026-11-06/Daily Brief 2026-11-06.pdf (FR, EN, ES)
render=0
```

`pdfinfo "out/2026-11-06/Daily Brief 2026-11-06.pdf"` (si disponible) indique environ 9 pages A4. Il y en a une de moins que la fixture, parce que `brief:verify` a retiré les citations et les chiffres faute de textes sources. Supprimer ensuite le dossier d'essai : `rm -rf out`.

- [ ] **Étape 8 : commit**

```bash
git add pipeline package.json package-lock.json
git commit -m "feat(render): commande brief:render (photos, éditions finales, PDF, rapport)"
```

---

### Tâche 10 : vérification finale et documentation

**Fichiers :**
- Modifier : `README.md` (section « Développement »), `docs/superpowers/plans/2026-11-06-phase-1-roadmap.md` (statut du lot 2)

- [ ] **Étape 1 : lancer toute la suite et le typage**

Commande : `npm test && npm run typecheck`
Attendu : `Test Files  28 passed (28)`, `Tests  186 passed (186)` (149 du lot 1 + 37 du lot 2), et `tsc` sans sortie.

- [ ] **Étape 2 : compléter le README**

Dans le bloc de commandes de la section « Développement » de `README.md`, ajouter après la ligne `npm run brief:verify …` :

```bash
npm run brief:render -- --date AAAA-MM-JJ [--out out]
npm run maps:preview   # aperçu des cartes de la fixture (out/maps-preview.html)
```

Puis ajouter ce paragraphe après celui qui décrit `brief:verify` :

```markdown
`brief:render` lit les `{lang}.verified.json` du jour et complète les photos Pexels si `PEXELS_API_KEY` est définie (variable d'environnement ou `.env`). Il écrit `{lang}.final.json`, `Daily Brief <date>.pdf` (A4, FR puis EN puis ES) et `render-report.json`. Une édition absente est omise ; sans aucune édition, il n'y a pas de PDF et le code de sortie vaut 2. Le test visuel du PDF compare trois captures à `packages/render-pdf/test/__screens__/`. Après un changement voulu du gabarit, régénère-les avec `UPDATE_VISUAL=1 npx vitest run packages/render-pdf/test/visual.test.ts` et vérifie les images avant de les commiter.
```

- [ ] **Étape 3 : mettre à jour la feuille de route**

Dans `docs/superpowers/plans/2026-11-06-phase-1-roadmap.md`, remplacer le titre `### Lot 2 — Cartes, photos et PDF` par `### Lot 2 — Cartes, photos et PDF ✅ plan détaillé`. Ajouter juste en dessous la ligne `Plan : \`docs/superpowers/plans/2026-11-06-phase-1-lot-2-cartes-photos-pdf.md\``.

- [ ] **Étape 4 : commit**

```bash
git add README.md docs/superpowers/plans/2026-11-06-phase-1-roadmap.md
git commit -m "docs: commandes du lot 2 (brief:render, aperçu des cartes)"
```

---

## Couverture du lot (auto-revue)

| Exigence | Tâche |
|---|---|
| §8.4 cartes depuis `MapSpec` : d3-geo, world-atlas 50m, `clipExtent`, coordonnées entières, grille de points, pays en avant, marqueurs pulsés, cercles proportionnels, arc en pointillés, étiquettes mono, classes CSS thémables, module partagé site + PDF | 1, 2, 3 |
| §8.5 PDF A4 unique FR puis EN puis ES, couverture (en-tête, titre, Morning Brief, sommaire, liens internes, encart audio, chiffres du jour), sujet en deux colonnes avec QR code et liens, brèves, vocabulaire, pied de page (date, éditions, pagination), Playwright, nom `Daily Brief AAAA-MM-JJ.pdf` | 4, 5, 9 |
| §8.1 polices Geist auto-hébergées depuis le paquet `geist`, sans CDN | 4, 5 |
| R11 photo Pexels par mots-clés d'objets ou de lieux, crédit du photographe | 7, 8, 4 (affichage du crédit) |
| R4 libellé « Résumé IA · d'après les sources citées » toujours affiché | 4 |
| §9 et §12 : édition sans audio publiée sans encart ; photo ou image manquante sans blocage ; édition absente omise | 4, 8, 9 |
| §13 test visuel des pages du PDF à partir de la fixture | 6 |
| §16 Chromium et Playwright disponibles (préinstallés, version épinglée) | 4, 5 |
| Hors lot : audio (lot 5, qui écrira `audio.json`), dépôt Drive (lot 4), bandeau « édition allégée » (lot 3 pour le seuil, lot 6 pour l'appli) | — |

---

## Écarts après exécution (revues de code)

Le lot a été exécuté par sous-agents, avec une revue de conformité puis une revue qualité après chaque groupe de tâches. Les revues ont durci le code au-delà du texte ci-dessus. **Le dépôt fait foi** ; ce plan reste la trace de la conception initiale. Résultat final : 30 fichiers de test, 251 tests, typage strict propre.

| Zone | Écart par rapport au plan | Raison |
|---|---|---|
| Cartes | Monde recentré sur l'antiméridien ; Europe bornée à lon [-25, 50] et lat [33, 71,5], avec une marge autour des lieux ; cadrage France et Espagne inchangé (2 coins du prototype) | Les cartes restent lisibles et cadrées comme la maquette |
| Cartes | Arcs tracés par `geoPath`, sans arc entre points identiques ou antipodaux ; cercles proportionnels bornés à 56 px | Pas de tracé dégénéré ni de cercle qui déborde |
| Cartes | Étiquettes tronquées à 28 caractères, gardées dans le cadre et à distance des marqueurs | Pas d'étiquette coupée ni posée sur un marqueur |
| Cartes | Points consécutifs identiques supprimés (carte du monde : 757 Ko → 210 Ko) ; pays hors cadre ignorés ; outre-mer dessiné comme la France ; archipels ; Kosovo, Chypre du Nord et Somaliland reconnus par leur nom | SVG plus léger et territoires absents des codes numériques de world-atlas |
| R11 dans `brief:verify` | Lieux hors cadre, codes inconnus, pays hors cadre et doublons retirés ; carte vidée remplacée par une photo | Une carte ne montre jamais un lieu hors cadre ni ne reste vide |
| R11 dans `brief:verify` | Photo Pexels écrite par la rédaction retirée : seul le rendu remplit `visual.pexels` | Une URL écrite par le modèle ne doit être ni téléchargée (SSRF) ni créditée à tort |
| PDF | Data URI d'image validée (jpeg, png, webp) ; JavaScript désactivé à l'impression | Pas de contenu actif dans le HTML imprimé |
| PDF | Un lien par source, source principale en premier ; mises en page robustes aux mots longs ; pas de page blanche ; `lang` par édition | Rendu fidèle des sujets réels, pas seulement de la fixture |
| PDF | Délai d'impression, et fermeture du navigateur bornée à 5 s | Une routine sans surveillance ne reste jamais bloquée |
| `brief:render` | Rapport toujours écrit (même sur exception), avec `finals` ; `langs` = langues du PDF, vide sans PDF ; `pdf` = nom du fichier | La publication (lot 4) lit un état jamais périmé ; le code 2 peut accompagner des `final.json` valides |
| `brief:render` | `final.json` toujours valide (photo validée, repli sur l'édition vérifiée) ; édition contrôlée contre son fichier (langue et date) | Aucune donnée fausse ou périmée n'est publiée |
| `brief:render` | Délais réseau (10 s) ; disjoncteur Pexels sur 401, 429 et délai dépassé, avec un seul avertissement ; recherches mémoïsées entre langues | Publication dégradée plutôt que blocage (§12) |
| `brief:render` | Images limitées à `images.pexels.com` en https, jpeg/png/webp et 3 Mo (avec contrôle de `content-length`) ; liens de crédit sur `www.pexels.com` | Pas de téléchargement arbitraire |
| `brief:render` | `.env` chargé sans écraser l'environnement ; seule l'absence du fichier est ignorée ; `audio.json` tolère les clés inconnues | Les secrets du processus priment ; formats tolérants |
