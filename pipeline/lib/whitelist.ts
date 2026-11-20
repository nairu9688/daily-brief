import { readFileSync } from 'node:fs';
import { z } from 'zod';
import { hostOf, outletKey, tryNormalizeUrl } from './url';

/** full = texte intégral lisible (R1) ; feed = flux lisible, articles à vérifier ; meta = métadonnées seulement. */
const DomainStatusSchema = z.enum(['full', 'feed', 'meta']);
const DomainSchema = z.string().regex(/^(?!www\.)[a-z0-9.-]+$/, 'domaine en minuscules, sans www. ni chemin');
const WhitelistEntrySchema = z.object({
  domain: DomainSchema,
  country: z.union([z.literal('INT'), z.string().regex(/^[A-Z]{2}$/)]),
  status: DomainStatusSchema,
  /** Nom affiché du média (« elDiario.es », « BBC News »). Sans lui, le domaine canonique sert de nom. */
  outlet: z.string().trim().min(1).max(60).optional(),
  /**
   * Domaine canonique du même média (bbc.com → bbc.co.uk, francetvinfo.fr → franceinfo.fr) : clé et nom
   * du média viennent de cette entrée. N'agit que sur l'identité du média (R3, affichage), jamais sur le statut (R1).
   */
  sameAs: DomainSchema.optional(),
});
export const WhitelistSchema = z
  .object({
    checkedAt: z.string(),
    note: z.string().optional(),
    domains: z.array(WhitelistEntrySchema),
  })
  .superRefine((wl, ctx) => {
    const byDomain = new Map(wl.domains.map((e) => [e.domain, e]));
    const seen = new Set<string>();
    wl.domains.forEach((e, i) => {
      if (seen.has(e.domain)) ctx.addIssue({ code: 'custom', path: ['domains', i, 'domain'], message: `domaine en double : ${e.domain}` });
      seen.add(e.domain);
      if (e.sameAs === undefined) return;
      const target = byDomain.get(e.sameAs);
      if (!target || target.sameAs !== undefined || e.sameAs === e.domain)
        ctx.addIssue({ code: 'custom', path: ['domains', i, 'sameAs'], message: `sameAs doit désigner une autre entrée canonique de la liste : ${e.sameAs}` });
    });
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

/** Identité d'un média : `key` sert à compter (R3, notification), `name` à afficher. */
export type OutletIdentity = { key: string; name: string; known: boolean };

/**
 * Média d'une URL, normalisé : l'entrée de la liste blanche (suivie de son `sameAs`) donne la clé
 * (domaine canonique) et le nom affiché ; hors liste, la clé et le nom sont le domaine enregistrable
 * (fr.euronews.com → euronews.com). Une URL illisible donne son texte en minuscules, sans lever.
 */
export function outletOf(wl: Whitelist, url: string): OutletIdentity {
  const entry = lookupDomain(wl, url);
  if (entry) {
    const canonical = (entry.sameAs && wl.domains.find((e) => e.domain === entry.sameAs)) || entry;
    return { key: canonical.domain, name: canonical.outlet ?? entry.outlet ?? canonical.domain, known: true };
  }
  const normalized = tryNormalizeUrl(url);
  const key = normalized ? outletKey(normalized) : url.trim().toLowerCase();
  return { key, name: key, known: false };
}
