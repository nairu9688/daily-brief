import { hostOf } from '../lib/url';
import { lookupDomain, type Whitelist } from '../lib/whitelist';
import type { Candidate } from './types';

/** Pays du média : liste blanche, sinon domaine national à 2 lettres (même règle que `verify/perimeter.ts`). */
function countryOf(url: string, wl: Whitelist): string | undefined {
  const known = lookupDomain(wl, url)?.country;
  if (known) return known;
  const tld = hostOf(url).split('.').pop() ?? '';
  return tld.length === 2 ? tld.toUpperCase() : undefined;
}

/**
 * R2 à la collecte : l'édition ES n'accepte que des médias espagnols. Un candidat en espagnol dont
 * le pays est connu et n'est pas ES, ou inconnu (sans domaine en `.es`), est écarté dès maintenant
 * plutôt qu'au contrôle, où il aurait pris la place d'un article valable. Les autres langues passent.
 */
export function applyEditionPerimeter(candidates: Candidate[], wl: Whitelist): { kept: Candidate[]; dropped: number } {
  const kept = candidates.filter((c) => c.article.lang !== 'es' || countryOf(c.article.url, wl) === 'ES');
  return { kept, dropped: candidates.length - kept.length };
}
