import type { MapSpec } from '@daily-brief/schema';
import { countryByAlpha3 } from './countries';
import { framing, inFrame } from './projections';

/**
 * Lieux visibles dans le cadre de la carte. Retirer les autres ne change pas le cadrage :
 * France et Espagne sont fixes, l'Europe ignore ce qui sort de sa fenêtre, le monde cadre tous les lieux.
 */
export function placesInFrame(spec: MapSpec): MapSpec['places'] {
  const { projection } = framing(spec);
  return spec.places.filter((p) => inFrame(projection([p.lon, p.lat])));
}

/** Codes alpha-3 de focus et highlight absents de l'atlas (ou qui ne sont pas des pays). */
export function unknownCountryCodes(codes: string[] | undefined): string[] {
  return (codes ?? []).filter((c) => countryByAlpha3(c) === undefined);
}

/** Problèmes d'un MapSpec que le rendu tait (il ignore lieux hors cadre et codes inconnus), en français. */
export function mapDiagnostics(spec: MapSpec): string[] {
  const out: string[] = [];
  const inside = new Set(placesInFrame(spec));
  for (const p of spec.places) if (!inside.has(p)) out.push(`lieu hors cadre (${spec.projection}) : ${p.name}`);
  for (const c of [...unknownCountryCodes(spec.focus), ...unknownCountryCodes(spec.highlight)]) out.push(`code pays inconnu : ${c}`);
  const names = spec.places.map((p) => p.name);
  for (const n of new Set(spec.arc ?? [])) if (!names.includes(n)) out.push(`arc vers un lieu absent : ${n}`);
  const seen = new Set<string>();
  const dup = new Set<string>();
  for (const n of names) (seen.has(n) ? dup : seen).add(n);
  for (const n of dup) out.push(`nom de lieu en double : ${n}`);
  return out;
}
