import type { Lang, SourceRef } from '@daily-brief/schema';
import { hostOf, tryNormalizeUrl } from '../lib/url';
import { lookupDomain, type Whitelist } from '../lib/whitelist';

export type PerimeterResult = { remove: string } | null;

/** Pays du média : liste blanche, sinon domaine national à 2 lettres (« .uk » donne « UK », sans effet : seul ES compte ici). */
function countryOf(url: string, wl: Whitelist): string | undefined {
  const known = lookupDomain(wl, url)?.country;
  if (known) return known;
  const tld = hostOf(url).split('.').pop() ?? '';
  return tld.length === 2 ? tld.toUpperCase() : undefined;
}

/**
 * R2 : l'édition FR accepte toute source ; EN exige des sources en anglais ;
 * ES exige des sources en espagnol publiées par des médias espagnols.
 * En cas de doute sur le pays, la source est retirée.
 */
export function checkPerimeter(lang: Lang, src: SourceRef, wl: Whitelist): PerimeterResult {
  if (lang === 'fr') return null;
  if (src.lang !== lang) return { remove: `${src.outlet} : langue « ${src.lang} » hors édition ${lang.toUpperCase()}` };
  if (lang === 'es') {
    if (tryNormalizeUrl(src.url) === null) return { remove: `${src.outlet} : URL illisible` };
    const country = countryOf(src.url, wl);
    if (country === undefined) return { remove: `${src.outlet} : pays du média inconnu, à ajouter à whitelist.json` };
    if (country !== 'ES') return { remove: `${src.outlet} : média non espagnol (${country})` };
  }
  return null;
}
