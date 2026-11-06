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
}).refine((m) => new Set(m.places.map((p) => p.name)).size === m.places.length, 'noms de lieux en double');

export const PexelsPhotoSchema = z.strictObject({
  id: z.number(),
  src: Url,
  width: z.number(),
  height: z.number(),
  photographer: z.string().min(1),
  photographerUrl: Url,
  pexelsUrl: Url,
  alt: z.string().optional(),
});

export const VisualSchema = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('map'), caption: z.string().min(1), map: MapSpecSchema }),
  z.strictObject({ type: z.literal('photo'), query: z.string().min(1), pexels: PexelsPhotoSchema.optional() }),
]);

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
export type PexelsPhoto = z.infer<typeof PexelsPhotoSchema>;
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
