import { z } from 'zod';
import { LANGS, RUBRIC_KEYS } from './rubrics';

export const IsoDateSchema = z.iso.date();
export const UrlSchema = z.url({ protocol: /^https?$/ });
const Url = UrlSchema;
const Iso3 = z.string().regex(/^[A-Z]{3}$/, 'code ISO 3166 alpha-3 attendu');

export const LangSchema = z.enum(LANGS);
export const RubricKeySchema = z.enum(RUBRIC_KEYS);

export const SourceRefSchema = z.strictObject({
  outlet: z.string().min(1),
  title: z.string().min(1),
  url: Url,
  lang: z.string().min(2),
  readFull: z.boolean(),
  publishedAt: z.string().optional(),
});

export const PlaceSchema = z.strictObject({
  name: z.string().min(1),
  lon: z.number().min(-180).max(180),
  lat: z.number().min(-90).max(90),
  label: z.string().optional(),
  value: z.number().optional(),
  primary: z.boolean().optional(),
});

export const MapSpecSchema = z.strictObject({
  projection: z.enum(['conic-france', 'conic-europe', 'conic-spain', 'albers-usa', 'world']),
  focus: z.array(Iso3).optional(),
  highlight: z.array(Iso3).optional(),
  arc: z.tuple([z.string(), z.string()]).optional(),
  bubbles: z.boolean().optional(),
  places: z.array(PlaceSchema),
});

/** Hôtes de confiance des images Wikimedia Commons : originaux et vignettes (réponse de l'API, jamais le modèle). */
export const PHOTO_IMAGE_HOSTS = ['upload.wikimedia.org', 'thumb.wikimedia.org'] as const;
/** Pages de fichier de Commons (lien du crédit). */
export const PHOTO_PAGE_HOST = 'commons.wikimedia.org';
/** Textes des licences Creative Commons (lien du crédit). */
export const LICENSE_HOST = 'creativecommons.org';
/** Longueur maximale du nom d'auteur affiché. */
export const MAX_AUTHOR_LENGTH = 80;

/**
 * URL https sur l'un des hôtes donnés (nom exact), sans identifiants ni port. L'URL brute est aussi
 * contrôlée : le parseur WHATWG retire en silence tabulations et sauts de ligne, et efface `:443`.
 */
export function isHttpsUrlOn(url: string, hosts: readonly string[]): boolean {
  if (/[\t\n\r]/.test(url)) return false;
  const authority = /^https:\/\/([^/?#\\]*)/i.exec(url)?.[1];
  if (authority === undefined || /[:@]/.test(authority)) return false;
  try {
    const u = new URL(url);
    return u.protocol === 'https:' && hosts.includes(u.hostname) && !u.username && !u.password && !u.port;
  } catch {
    return false;
  }
}

/** Versions publiées des licences Creative Commons 4.0 et antérieures. */
const CC_VERSION = '(?:1\\.0|2\\.0|2\\.5|3\\.0|4\\.0)';
/** Suffixe de portage (pays, « igo ») : jamais un élément de licence (nc, nd, sa). */
const CC_PORT = '(?!(?:nc|nd|sa)$)[a-z]{2,3}';
/**
 * Licences admises (R11) : CC0, domaine public, CC BY et CC BY-SA d'une version publiée, avec ou sans
 * suffixe de portage (« CC BY-SA 2.5 nl »). Tout le reste est refusé : NC, ND, GFDL seule, usage loyal, inconnu.
 */
const FREE_LICENSE = new RegExp(`^(?:CC0(?: 1\\.0)?|Public domain|CC (BY(?:-SA)?) (${CC_VERSION})(?: (${CC_PORT}))?)$`, 'i');
export const isFreeLicense = (name: string): boolean => FREE_LICENSE.test(name.trim());

/**
 * Lien canonique du texte d'une licence CC BY ou CC BY-SA, d'après son nom
 * (« CC BY-SA 2.5 nl » → https://creativecommons.org/licenses/by-sa/2.5/nl/) ; undefined sinon.
 */
export function ccLicenseUrl(name: string): string | undefined {
  const m = FREE_LICENSE.exec(name.trim());
  if (!m?.[1]) return undefined;
  return `https://creativecommons.org/licenses/${m[1].toLowerCase()}/${m[2]}/${m[3] ? `${m[3].toLowerCase()}/` : ''}`;
}

/** Forme normalisée (WHATWG) d'une URL déjà validée. */
const normalized = (u: string): string => {
  try {
    return new URL(u).href;
  } catch {
    return u;
  }
};
/** Contrôle sur la chaîne brute : `z.url()` la normaliserait d'abord (tabulations et sauts de ligne effacés). */
const urlOn = (hosts: readonly string[], message: string) => z.string().refine((u) => isHttpsUrlOn(u, hosts), message);
const noQuery = (u: string) => !/[?#]/.test(u);

/** Photo libre d'un sujet, renseignée par `brief:render` seulement (leçon SSRF du lot 2). */
export const PhotoSchema = z
  .strictObject({
    provider: z.literal('wikimedia'),
    src: urlOn(PHOTO_IMAGE_HOSTS, 'image hors de upload.wikimedia.org ou thumb.wikimedia.org').refine(noQuery, 'URL d’image sans paramètres attendue').overwrite(normalized),
    width: z.number().int().positive(),
    height: z.number().int().positive(),
    author: z.string().trim().min(1).max(MAX_AUTHOR_LENGTH),
    license: z.string().refine(isFreeLicense, 'licence non libre ou inconnue'),
    licenseUrl: urlOn([LICENSE_HOST], 'lien de licence hors de creativecommons.org').overwrite(normalized).optional(),
    pageUrl: urlOn([PHOTO_PAGE_HOST], 'page hors de commons.wikimedia.org')
      .refine(noQuery, 'page sans paramètres attendue')
      .refine((u) => isHttpsUrlOn(u, [PHOTO_PAGE_HOST]) && new URL(u).pathname.startsWith('/wiki/File:'), 'page de fichier attendue')
      .overwrite(normalized),
  })
  .refine((p) => p.licenseUrl !== undefined || !ccLicenseUrl(p.license), { path: ['licenseUrl'], message: 'lien de licence requis pour CC BY et CC BY-SA' });

/** Ancienne forme (lot 2) : `pexels` n'a jamais été renseigné en production, il est ignoré à la lecture. */
const dropLegacyPhoto = (v: unknown): unknown => {
  if (!v || typeof v !== 'object' || Array.isArray(v) || !('pexels' in v)) return v;
  const { pexels: _legacy, ...rest } = v as Record<string, unknown>;
  return rest;
};

/**
 * Visuel d'un sujet. Une ancienne ligne ou un ancien fichier `{ type: 'photo', query, pexels }` se lit
 * encore (photo sans image) ; le JSON Schema émis n'expose que la forme actuelle.
 */
export const VisualSchema = z.preprocess(
  dropLegacyPhoto,
  z.discriminatedUnion('type', [
    z.strictObject({ type: z.literal('map'), caption: z.string().min(1), map: MapSpecSchema }),
    z.strictObject({
      type: z.literal('photo'),
      query: z.string().min(1),
      photo: PhotoSchema.optional().describe('Renseigné par brief:render seulement : la rédaction ne l’écrit jamais (retiré par brief:verify).'),
    }),
  ]),
);

/**
 * Visuel brut sans photo invalide (ni ancien champ `pexels`), quel que soit son type : le sujet garde son
 * aplat ou sa carte plutôt que d'être rejeté en entier. `removed` vaut vrai si une photo a été retirée
 * (un `pexels` sur une photo, ancienne forme lisible, ne compte pas).
 */
export function sanitizeVisual(v: unknown): { visual: unknown; removed: boolean } {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return { visual: v, removed: false };
  const rest = dropLegacyPhoto(v) as Record<string, unknown>;
  const keep = !('photo' in rest) || (rest.type === 'photo' && PhotoSchema.safeParse(rest.photo).success);
  // Un `pexels` retiré d'une carte compte comme une photo retirée ; sur une photo, c'est l'ancienne forme, lisible.
  if (keep) return { visual: rest, removed: rest !== v && rest.type !== 'photo' };
  const { photo: _invalid, ...clean } = rest;
  return { visual: clean, removed: true };
}

/** Retire en place les photos invalides d'une édition brute (avant analyse) ; renvoie les id des sujets touchés. */
export function stripInvalidPhotos(edition: unknown): string[] {
  const ids: string[] = [];
  const sections = (edition as { sections?: unknown } | null)?.sections;
  if (!Array.isArray(sections)) return ids;
  for (const section of sections) {
    const stories = (section as { stories?: unknown } | null)?.stories;
    if (!Array.isArray(stories)) continue;
    for (const story of stories) {
      if (!story || typeof story !== 'object') continue;
      const st = story as { id?: unknown; visual?: unknown };
      const r = sanitizeVisual(st.visual);
      if (r.visual !== st.visual) st.visual = r.visual;
      if (r.removed) ids.push(typeof st.id === 'string' ? st.id : '?');
    }
  }
  return ids;
}

export const StatSchema = z.strictObject({ value: z.string().min(1), label: z.string().min(1), sourceUrl: Url });

export const QuoteSchema = z.strictObject({
  text: z.string().min(1),
  speaker: z.string().min(1),
  translation: z.string().min(1).nullable(),
  sourceUrl: Url,
});

const DivergenceSide = z.strictObject({ value: z.string().min(1), by: z.string().min(1) });
export const DivergenceSchema = z.strictObject({ metric: z.string().min(1), a: DivergenceSide, b: DivergenceSide });

export const StoryThreadSchema = z.strictObject({
  id: z.string().optional(),
  title: z.string().min(1),
  subtitle: z.string(),
});

export const PrepaSchema = z.strictObject({ subject: z.string().min(1), text: z.string().min(1) });

export const StorySchema = z.strictObject({
  id: z.string().min(1),
  kicker: z.string().min(1),
  date: z.string().min(1),
  title: z.string().min(1),
  summary: z.string().min(1),
  visual: VisualSchema,
  stats: z.array(StatSchema).refine((a) => a.length === 0 || a.length === 4, '0 ou 4 chiffres'),
  quote: QuoteSchema.nullable(),
  divergences: z.array(DivergenceSchema),
  thread: StoryThreadSchema.nullable(),
  prepa: PrepaSchema.nullable(),
  sources: z.array(SourceRefSchema).min(1, 'au moins une source'),
});

export const SectionSchema = z.strictObject({
  key: RubricKeySchema,
  title: z.string().min(1),
  stories: z.array(StorySchema),
  briefs: z.array(SourceRefSchema),
});

export const MorningBriefItemSchema = z.strictObject({
  lead: z.string().min(1),
  text: z.string().min(1),
  rubric: z.string().min(1),
  storyId: z.string().optional(),
});

export const VocabItemSchema = z.strictObject({
  term: z.string().min(1),
  pos: z.string().min(1),
  translation: z.string().min(1),
  example: z.string().min(1),
  sourceUrl: Url.optional(),
});

export const VocabSchema = z.strictObject({ title: z.string().min(1), items: z.array(VocabItemSchema) });

export const EditionSchema = z
  .object({
    date: IsoDateSchema,
    lang: LangSchema,
    region: z.string().min(1),
    headline: z.string().min(1),
    morningBrief: z.array(MorningBriefItemSchema).length(5, 'exactement 5 infos (R8)'),
    audioScript: z.string().min(1),
    sections: z.array(SectionSchema),
    vocab: VocabSchema.nullable(),
  })
  .superRefine((ed, ctx) => {
    if (ed.lang === 'fr' && ed.vocab !== null) {
      ctx.addIssue({ code: 'custom', path: ['vocab'], message: 'vocab doit être null pour l’édition FR' });
    }
    if (ed.lang !== 'fr' && (ed.vocab === null || ed.vocab.items.length !== 6)) {
      ctx.addIssue({ code: 'custom', path: ['vocab'], message: 'exactement 6 mots pour EN et ES (R10)' });
    }
    const keys = ed.sections.map((s) => s.key);
    if (new Set(keys).size !== keys.length) {
      ctx.addIssue({ code: 'custom', path: ['sections'], message: 'rubrique en double' });
    }
    const ids = ed.sections.flatMap((s) => s.stories.map((st) => st.id));
    if (new Set(ids).size !== ids.length) {
      ctx.addIssue({ code: 'custom', path: ['sections'], message: 'id de sujet en double' });
    }
  });

export const BriefSchema = z
  .object({ date: IsoDateSchema, issue: z.string().min(1), editions: z.array(EditionSchema).length(3) })
  .superRefine((b, ctx) => {
    const langs = b.editions.map((e) => e.lang).sort().join(',');
    if (langs !== 'en,es,fr') ctx.addIssue({ code: 'custom', path: ['editions'], message: 'éditions fr, en et es attendues' });
    if (b.editions.some((e) => e.date !== b.date)) ctx.addIssue({ code: 'custom', path: ['editions'], message: 'date d’édition incohérente' });
  });

export type SourceRef = z.infer<typeof SourceRefSchema>;
export type Place = z.infer<typeof PlaceSchema>;
export type MapSpec = z.infer<typeof MapSpecSchema>;
export type Photo = z.infer<typeof PhotoSchema>;
export type Visual = z.infer<typeof VisualSchema>;
export type Stat = z.infer<typeof StatSchema>;
export type Quote = z.infer<typeof QuoteSchema>;
export type Divergence = z.infer<typeof DivergenceSchema>;
export type StoryThread = z.infer<typeof StoryThreadSchema>;
export type Prepa = z.infer<typeof PrepaSchema>;
export type Story = z.infer<typeof StorySchema>;
export type Section = z.infer<typeof SectionSchema>;
export type MorningBriefItem = z.infer<typeof MorningBriefItemSchema>;
export type Vocab = z.infer<typeof VocabSchema>;
export type Edition = z.infer<typeof EditionSchema>;
export type Brief = z.infer<typeof BriefSchema>;
