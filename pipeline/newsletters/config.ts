import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { LangSchema } from '@daily-brief/schema';

export const NEWSLETTERS_PATH = fileURLToPath(new URL('../config/newsletters.json', import.meta.url));

/** Domaine d'expéditeur ou de média : minuscules, sans `www.`, sans `@` ni chemin. */
const Domain = z.string().regex(/^(?!www\.)[a-z0-9-]+(\.[a-z0-9-]+)+$/, 'domaine en minuscules, sans www., @ ni chemin');

const NewsletterSchema = z.strictObject({
  id: z.string().regex(/^[a-z0-9-]+$/, 'identifiant en minuscules et tirets'),
  name: z.string().min(1),
  publisher: z.string().min(1),
  /** Édition que la newsletter nourrit (R2) ; `lang` est la langue de ses textes. */
  edition: LangSchema,
  lang: LangSchema,
  /** Domaine du média (site), cherché dans whitelist.json pour le pays (R2). */
  domain: Domain,
  /** Domaines d'expédition acceptés (le domaine lui-même ou un sous-domaine de l'adresse From). */
  senders: z.array(Domain).min(1),
  signupUrl: z.url({ protocol: /^https$/ }),
  schedule: z.string().min(1),
  free: z.literal(true),
  enabled: z.boolean(),
  /** verified : nom, éditeur et inscription confirmés sur une page publique ; probable : existence confirmée, détail à vérifier ; uncertain : à confirmer avant de s'abonner. */
  confidence: z.enum(['verified', 'probable', 'uncertain']),
  notes: z.string(),
});

export const NewslettersConfigSchema = z
  .strictObject({
    checkedAt: z.iso.date(),
    note: z.string().optional(),
    gmailLabel: z.string().min(1),
    /**
     * Exiger un en-tête Authentication-Results (dmarc=pass aligné) enregistré avec chaque message.
     * Un en-tête présent est toujours contrôlé ; à false, un message sans en-tête est gardé avec un
     * avertissement. À passer à true quand le premier passage réel montre que le connecteur le donne.
     */
    requireDmarc: z.boolean().default(false),
    /** Plafond de la spec §4.3 (6 à 8 par jour) : au-delà, les messages sont ignorés. */
    maxPerDay: z.number().int().min(1).max(8),
    newsletters: z.array(NewsletterSchema).min(1),
  })
  .superRefine((c, ctx) => {
    const ids = c.newsletters.map((n) => n.id);
    ids.forEach((id, i) => {
      if (ids.indexOf(id) !== i) ctx.addIssue({ code: 'custom', message: `identifiant en double : ${id}`, path: ['newsletters', i, 'id'] });
    });
    const senders = c.newsletters.filter((n) => n.enabled).flatMap((n) => n.senders.map((s) => [s, n.id] as const));
    senders.forEach(([s, id], i) => {
      if (senders.findIndex(([t]) => t === s) !== i) ctx.addIssue({ code: 'custom', message: `domaine d'expédition partagé par deux newsletters actives : ${s} (${id})` });
    });
    const enabled = c.newsletters.filter((n) => n.enabled).length;
    if (enabled > c.maxPerDay) ctx.addIssue({ code: 'custom', message: `${enabled} newsletters actives pour un plafond de ${c.maxPerDay}` });
  });

export type Newsletter = z.infer<typeof NewsletterSchema>;
export type NewslettersConfig = z.infer<typeof NewslettersConfigSchema>;

export function loadNewsletters(path: string = NEWSLETTERS_PATH): NewslettersConfig {
  return NewslettersConfigSchema.parse(JSON.parse(readFileSync(path, 'utf8')));
}

/** Domaine de l'adresse d'un en-tête From (« Nom <a@b.fr> » ou « a@b.fr ») ; null s'il n'y en a pas ou si l'adresse a plus d'un `@`. */
export function senderDomain(from: string): string | null {
  const m = /<([^<>\s]+@[^<>\s]+)>\s*$/.exec(from) ?? /^\s*([^<>\s]+@[^<>\s]+)\s*$/.exec(from);
  if (!m) return null;
  const parts = m[1].split('@');
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null;
  return parts[1].toLowerCase().replace(/\.$/, '');
}

/** Newsletter active dont un domaine d'expédition couvre l'adresse From ; undefined sinon. */
export function matchSender(config: NewslettersConfig, from: string): Newsletter | undefined {
  const d = senderDomain(from);
  if (!d) return undefined;
  return config.newsletters.find((n) => n.enabled && n.senders.some((s) => d === s || d.endsWith(`.${s}`)));
}

/** Requête du filtre Gmail (docs/setup-newsletters.md) : tous les domaines des newsletters actives. */
export function gmailFilterQuery(config: NewslettersConfig): string {
  const domains = [...new Set(config.newsletters.filter((n) => n.enabled).flatMap((n) => n.senders))];
  return `from:(${domains.join(' OR ')})`;
}
