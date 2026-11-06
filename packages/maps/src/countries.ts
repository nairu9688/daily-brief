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

/** Emprise de chaque pays (geoBounds), calculée une fois au chargement. x0 > x1 si elle traverse l'antiméridien. */
export const COUNTRY_BOUNDS: ReadonlyMap<CountryFeature, Bounds> = new Map(COUNTRIES.map((f) => [f, geoBounds(f) as Bounds]));

/** Code alpha-3 (« FRA ») → identifiant world-atlas (« 250 »), ou undefined si inconnu. */
export function numericId(alpha3: string): string | undefined {
  return isoCountries.alpha3ToNumeric(alpha3) ?? undefined;
}

/** Pays sans identifiant numérique dans world-atlas, retrouvés par leur nom (properties.name). */
const BY_NAME: Record<string, string> = { XKX: 'Kosovo', XKK: 'Kosovo', CYN: 'N. Cyprus', SOL: 'Somaliland' };

/**
 * Régions d'outre-mer que world-atlas dessine dans le polygone de la France : elles sont
 * dessinées comme la France. Un focus ou un highlight sur GUF surligne donc la France entière.
 */
const DRAWN_AS: Record<string, string> = { GUF: 'FRA', REU: 'FRA', MYT: 'FRA', GLP: 'FRA', MTQ: 'FRA' };

/** Code ISO 3166 alpha-3 valide (connu de i18n-iso-countries), qu'il soit ou non dans l'atlas. */
export function isIsoAlpha3(alpha3: string): boolean {
  return numericId(alpha3) !== undefined || alpha3 in BY_NAME;
}

/** Pays world-atlas d'un code alpha-3, ou undefined si le code est inconnu ou absent de l'atlas (GIB, TUV…). */
export function countryByAlpha3(alpha3: string): CountryFeature | undefined {
  if (DRAWN_AS[alpha3]) return countryByAlpha3(DRAWN_AS[alpha3]);
  const name = BY_NAME[alpha3];
  if (name) return COUNTRIES.find((f) => !f.id && f.properties.name === name);
  const id = numericId(alpha3);
  return id ? COUNTRIES.find((f) => f.id === id) : undefined;
}

/** Part minimale de la surface du plus grand polygone pour qu'une île compte parmi les polygones principaux. */
const MAIN_SHARE = 0.25;

/**
 * Polygones principaux du pays : ceux dont la surface sphérique atteint 25 % du plus grand.
 * La métropole, sans les outre-mer ni les îles lointaines (Guyane ≈ 15 % pour FRA, Canaries pour ESP),
 * mais toutes les grandes îles d'un archipel (Sumatra, Java, Bornéo, Sulawesi, Nouvelle-Guinée pour IDN).
 */
export function mainPolygons(f: CountryFeature): Feature<Polygon | MultiPolygon> {
  const g = f.geometry;
  if (g.type === 'Polygon') return { type: 'Feature', properties: {}, geometry: g as Polygon };
  if (g.type !== 'MultiPolygon') return { type: 'Feature', properties: {}, geometry: { type: 'MultiPolygon', coordinates: [] } };
  const areas = (g as MultiPolygon).coordinates.map((coordinates) => geoArea({ type: 'Polygon', coordinates }));
  const largest = Math.max(...areas);
  const kept = (g as MultiPolygon).coordinates.filter((_, i) => areas[i] >= largest * MAIN_SHARE);
  return { type: 'Feature', properties: {}, geometry: { type: 'MultiPolygon', coordinates: kept } };
}

/**
 * Emprise des polygones principaux, par geoBounds sur leur union : elle ne traverse l'antiméridien
 * (x0 > x1) que si les polygones le font vraiment (Russie, Fidji), sans artefact d'union.
 */
export function mainBounds(f: CountryFeature): Bounds {
  return geoBounds(mainPolygons(f)) as Bounds;
}
