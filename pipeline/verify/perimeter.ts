import type { Lang, SourceRef } from '@daily-brief/schema';
import { hostOf } from '../lib/url';
import { lookupDomain, type Whitelist } from '../lib/whitelist';

export type PerimeterResult = { remove: string } | { warn: string } | null;

/**
 * R2 : l'édition FR accepte toute source ; EN exige des sources en anglais ;
 * ES exige des sources en espagnol publiées par des médias espagnols.
 */
export function checkPerimeter(lang: Lang, src: SourceRef, wl: Whitelist): PerimeterResult {
  if (lang === 'fr') return null;
  if (src.lang !== lang) return { remove: `${src.outlet} : langue « ${src.lang} » hors édition ${lang.toUpperCase()}` };
  if (lang === 'es') {
    const country = lookupDomain(wl, src.url)?.country ?? (hostOf(src.url).endsWith('.es') ? 'ES' : undefined);
    if (country === undefined) return { warn: `${src.outlet} : pays du média inconnu, à ajouter à whitelist.json` };
    if (country !== 'ES') return { remove: `${src.outlet} : média non espagnol (${country})` };
  }
  return null;
}
