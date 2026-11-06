import { readFileSync } from 'node:fs';
import { hostOf } from './url';

/** full = texte intégral lisible (R1) ; feed = flux lisible, articles à vérifier ; meta = métadonnées seulement. */
export type DomainStatus = 'full' | 'feed' | 'meta';
export type WhitelistEntry = { domain: string; country: string; status: DomainStatus };
export type Whitelist = { checkedAt: string; domains: WhitelistEntry[] };

export function loadWhitelist(path: string): Whitelist {
  return JSON.parse(readFileSync(path, 'utf8')) as Whitelist;
}

/** Entrée la plus spécifique qui couvre l'hôte de l'URL (le domaine lui-même ou un sous-domaine). */
export function lookupDomain(wl: Whitelist, url: string): WhitelistEntry | undefined {
  const h = hostOf(url);
  return wl.domains
    .filter((e) => h === e.domain || h.endsWith('.' + e.domain))
    .sort((a, b) => b.domain.length - a.domain.length)[0];
}

export function canReadFull(wl: Whitelist, url: string): boolean {
  return lookupDomain(wl, url)?.status === 'full';
}
