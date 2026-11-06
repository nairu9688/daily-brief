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
 * Polygones principaux du pays : le plus grand en surface sphérique (la métropole),
 * sans les outre-mer ni les îles lointaines (Guyane pour FRA, Canaries pour ESP).
 */
export function mainPolygons(f: CountryFeature): Feature<Polygon | MultiPolygon> {
  const g = f.geometry;
  if (g.type === 'Polygon') return { type: 'Feature', properties: {}, geometry: g as Polygon };
  if (g.type !== 'MultiPolygon') return { type: 'Feature', properties: {}, geometry: { type: 'MultiPolygon', coordinates: [] } };
  const areas = (g as MultiPolygon).coordinates.map((coordinates) => geoArea({ type: 'Polygon', coordinates }));
  const largest = Math.max(...areas);
  const kept = (g as MultiPolygon).coordinates.filter((_, i) => areas[i] >= largest);
  return { type: 'Feature', properties: {}, geometry: { type: 'MultiPolygon', coordinates: kept } };
}

/**
 * Emprise des polygones principaux. Peut traverser l'antiméridien : x0 > x1 (Russie, Fidji).
 */
export function mainBounds(f: CountryFeature): Bounds {
  return geoBounds(mainPolygons(f)) as Bounds;
}
