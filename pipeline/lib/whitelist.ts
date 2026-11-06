import { readFileSync } from 'node:fs';
import { z } from 'zod';
import { hostOf, tryNormalizeUrl } from './url';

/** full = texte intégral lisible (R1) ; feed = flux lisible, articles à vérifier ; meta = métadonnées seulement. */
const DomainStatusSchema = z.enum(['full', 'feed', 'meta']);
const WhitelistEntrySchema = z.object({
  domain: z.string().min(1),
  country: z.union([z.literal('INT'), z.string().regex(/^[A-Z]{2}$/)]),
  status: DomainStatusSchema,
});
const WhitelistSchema = z.object({
  checkedAt: z.string(),
  note: z.string().optional(),
  domains: z.array(WhitelistEntrySchema),
});

export type DomainStatus = z.infer<typeof DomainStatusSchema>;
export type WhitelistEntry = z.infer<typeof WhitelistEntrySchema>;
export type Whitelist = z.infer<typeof WhitelistSchema>;

export function loadWhitelist(path: string): Whitelist {
  return WhitelistSchema.parse(JSON.parse(readFileSync(path, 'utf8')));
}

/** Entrée la plus spécifique qui couvre l'hôte de l'URL (le domaine lui-même ou un sous-domaine) ; undefined si l'URL est illisible. */
export function lookupDomain(wl: Whitelist, url: string): WhitelistEntry | undefined {
  const normalized = tryNormalizeUrl(url);
  if (!normalized) return undefined;
  const h = hostOf(normalized);
  return wl.domains
    .filter((e) => h === e.domain || h.endsWith('.' + e.domain))
    .sort((a, b) => b.domain.length - a.domain.length)[0];
}

export function canReadFull(wl: Whitelist, url: string): boolean {
  return lookupDomain(wl, url)?.status === 'full';
}
