import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import type { Lang } from '@daily-brief/schema';

/** Variantes régionales permises par édition (spec §9 : fr-FR, en-US ou en-GB, es-ES). */
export const LANGUAGE_CODES: Record<Lang, readonly string[]> = { fr: ['fr-FR'], en: ['en-US', 'en-GB'], es: ['es-ES'] };

export const VOICES_PATH = fileURLToPath(new URL('../config/voices.json', import.meta.url));

const VoiceSchema = z.strictObject({
  languageCode: z.string(),
  /** Nom complet d'une voix Chirp 3 HD : `<languageCode>-Chirp3-HD-<nom>`. */
  name: z.string().regex(/^[a-z]{2}-[A-Z]{2}-Chirp3-HD-[A-Za-z]+$/, 'voix Chirp 3 HD attendue (« fr-FR-Chirp3-HD-Nom »)'),
  /** Débit de parole (API : 0,25 à 2,0 ; 1 par défaut). */
  speakingRate: z.number().min(0.25).max(2).optional(),
});

export type VoiceConfig = z.infer<typeof VoiceSchema>;

export const VoicesSchema = z
  .strictObject({
    _note: z.string().optional(),
    /** Vrai une fois les noms confirmés par voices.list et choisis sur les échantillons. */
    confirmed: z.boolean(),
    fr: VoiceSchema,
    en: VoiceSchema,
    es: VoiceSchema,
  })
  .superRefine((cfg, ctx) => {
    for (const lang of ['fr', 'en', 'es'] as const) {
      const v = cfg[lang];
      if (!LANGUAGE_CODES[lang].includes(v.languageCode)) {
        ctx.addIssue({ code: 'custom', path: [lang, 'languageCode'], message: `${lang} : ${LANGUAGE_CODES[lang].join(' ou ')} attendu` });
      } else if (!v.name.startsWith(`${v.languageCode}-`)) {
        ctx.addIssue({ code: 'custom', path: [lang, 'name'], message: `${lang} : la voix doit être de ${v.languageCode}` });
      }
    }
  });

export type Voices = z.infer<typeof VoicesSchema>;

/** Lit et valide `pipeline/config/voices.json` ; lève une erreur lisible sinon. */
export function loadVoices(path = VOICES_PATH): Voices {
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(path, 'utf8'));
  } catch (e) {
    throw new Error(`voices.json illisible : ${(e as Error).message}`);
  }
  const r = VoicesSchema.safeParse(raw);
  if (!r.success) throw new Error(`voices.json invalide : ${r.error.issues.map((i) => `${i.path.join('.')} ${i.message}`).join(' ; ')}`);
  return r.data;
}
