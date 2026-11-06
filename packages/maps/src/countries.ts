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
