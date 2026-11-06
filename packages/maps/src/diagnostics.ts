import type { MapSpec } from '@daily-brief/schema';
import { geoPath } from 'd3-geo';
import { countryByAlpha3, isIsoAlpha3, mainBounds, mainPolygons, type CountryFeature } from './countries';
import { clampToWindow, EUROPE_WINDOW, framing, inFrame, type Framing } from './projections';

/**
 * Lieux visibles dans le cadre de la carte. Retirer les autres ne change pas le cadrage :
 * France et Espagne sont fixes, l'Europe ignore ce qui sort de sa fenêtre, le monde cadre tous les lieux.
 */
export function placesInFrame(spec: MapSpec): MapSpec['places'] {
  const { projection } = framing(spec);
  return spec.places.filter((p) => inFrame(projection([p.lon, p.lat])));
}

/**
 * Problème d'un code de focus ou highlight, ou null s'il est dessinable :
 * « code pays inconnu » s'il n'est pas un code ISO alpha-3 valide,
 * « pays absent de l’atlas (non dessiné) » s'il est valide mais absent de world-atlas (GIB, TUV…).
 */
export function countryCodeProblem(code: string): string | null {
  if (countryByAlpha3(code)) return null;
  return isIsoAlpha3(code) ? 'pays absent de l’atlas (non dessiné)' : 'code pays inconnu';
}

/**
 * Le pays cité (polygones principaux) est-il entièrement hors du cadre ? Le retirer ne change pas le cadrage.
 * - Monde : tout ce qui est cité est cadré.
 * - Europe : le cadre couvre toute la partie des pays cités qui est dans la fenêtre ; on teste la fenêtre.
 * - États-Unis : seul le territoire américain est dessiné.
 * - France, Espagne : polygones principaux projetés et coupés au cadre.
 */
export function countryOutOfFrame(spec: MapSpec, f: CountryFeature, fr: Framing = framing(spec)): boolean {
  switch (spec.projection) {
    case 'world':
      return false;
    case 'conic-europe':
      return clampToWindow(mainBounds(f), EUROPE_WINDOW) === null;
    case 'albers-usa':
      return f !== fr.onlyCountry;
    default: {
      const [[x0, y0], [x1, y1]] = geoPath(fr.projection).bounds(mainPolygons(f));
      return !(x0 <= x1 && y0 <= y1);
    }
  }
}

/** Codes de focus et highlight dessinables mais dont le pays est entièrement hors du cadre. */
export function countriesOutOfFrame(spec: MapSpec): string[] {
  const fr = framing(spec);
  return [...(spec.focus ?? []), ...(spec.highlight ?? [])].filter((code) => {
    const f = countryByAlpha3(code);
    return f !== undefined && countryOutOfFrame(spec, f, fr);
  });
}

/** Problèmes d'un MapSpec que le rendu tait (il ignore lieux hors cadre et codes non dessinables), en français. */
export function mapDiagnostics(spec: MapSpec): string[] {
  const out: string[] = [];
  const inside = new Set(placesInFrame(spec));
  for (const p of spec.places) if (!inside.has(p)) out.push(`lieu hors cadre (${spec.projection}) : ${p.name}`);
  for (const c of [...(spec.focus ?? []), ...(spec.highlight ?? [])]) {
    const problem = countryCodeProblem(c);
    if (problem) out.push(`${problem} : ${c}`);
  }
  for (const c of countriesOutOfFrame(spec)) out.push(`pays cité hors du cadre : ${c}`);
  const names = spec.places.map((p) => p.name);
  for (const n of new Set(spec.arc ?? [])) if (!names.includes(n)) out.push(`arc vers un lieu absent : ${n}`);
  const seen = new Set<string>();
  const dup = new Set<string>();
  for (const n of names) (seen.has(n) ? dup : seen).add(n);
  for (const n of dup) out.push(`nom de lieu en double : ${n}`);
  return out;
}
