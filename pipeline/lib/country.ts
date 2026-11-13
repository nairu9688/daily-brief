import { hostOf } from './url';
import { lookupDomain, type Whitelist } from './whitelist';

/** Pays du média : liste blanche, sinon domaine national à 2 lettres (« .uk » donne « UK », sans effet : seul ES compte pour R2). */
export function countryOf(url: string, wl: Whitelist): string | undefined {
  const known = lookupDomain(wl, url)?.country;
  if (known) return known;
  const tld = hostOf(url).split('.').pop() ?? '';
  return tld.length === 2 ? tld.toUpperCase() : undefined;
}
