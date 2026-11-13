import type { Lang, SourceRef } from '@daily-brief/schema';
import { countryOf } from '../lib/country';
import { tryNormalizeUrl } from '../lib/url';
import type { Whitelist } from '../lib/whitelist';

export type PerimeterResult = { remove: string } | null;

/**
 * R2 : l'édition FR accepte toute source ; EN exige des sources en anglais ;
 * ES exige des sources en espagnol publiées par des médias espagnols.
 * En cas de doute sur le pays, la source est retirée.
 */
export function checkPerimeter(lang: Lang, src: SourceRef, wl: Whitelist): PerimeterResult {
  if (lang === 'fr') return null;
  if (src.lang.toLowerCase().split('-')[0] !== lang) return { remove: `${src.outlet} : langue « ${src.lang} » hors édition ${lang.toUpperCase()}` };
  if (lang === 'es') {
    if (tryNormalizeUrl(src.url) === null) return { remove: `${src.outlet} : URL illisible` };
    const country = countryOf(src.url, wl);
    if (country === undefined) return { remove: `${src.outlet} : pays du média inconnu, à ajouter à whitelist.json` };
    if (country !== 'ES') return { remove: `${src.outlet} : média non espagnol (${country})` };
  }
  return null;
}
