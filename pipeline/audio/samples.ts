import { existsSync, mkdirSync, renameSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { LANGS, type Lang } from '@daily-brief/schema';
import { Breaker, describeError } from '../collect/breaker';
import type { HttpFetch } from '../collect/http';
import { writeAtomic } from '../lib/fs';
import { redactText, stripSecrets } from '../lib/redact';
import { billedChars } from './chunk';
import { chirp3HdVoices, listVoices, synthesize, type TtsClient, type VoiceInfo } from './tts';
import { LANGUAGE_CODES, type Voices } from './voices';

/** Phrases d'essai, du ton d'un Morning Brief (environ 200 caractères chacune). */
export const SAMPLE_TEXTS: Record<Lang, string> = {
  fr: 'Bonjour, voici le Daily Brief du jour. Au programme : le budget revient à l’Assemblée, la Bourse de Paris hésite, et « la grande question » du jour : qui paiera la transition énergétique ?',
  en: 'Good morning, here is today’s Daily Brief. Coming up: Congress returns to the budget fight, the Bank of England holds its rates, and a new climate report lands in Brussels.',
  es: 'Buenos días, este es el Daily Brief de hoy. ¿Qué nos espera? El Congreso debate los presupuestos, el Ibex abre con dudas y, ¡atención!, la selección prepara su próximo partido.',
};

export const DEFAULT_SAMPLES = 3;
export const MAX_SAMPLES = 10;

export type SampleEntry = { lang: Lang; voice: string; file: string | null; error: string | null };

export type SamplesIndex = {
  generatedAt: string;
  /** Toutes les voix Chirp 3 HD trouvées par langue d'édition (noms à recopier dans voices.json). */
  voices: Record<Lang, string[]>;
  samples: SampleEntry[];
  characters: number;
  issues: string[];
};

export type SamplesOptions = { apiKey: string; fetch: HttpFetch; outDir: string; voices: Voices; count?: number; timeoutMs?: number };

/**
 * Voix à essayer pour une langue : la voix configurée si elle existe, puis les autres en
 * alternant les variantes régionales (en-US, en-GB), chacune triée par nom.
 */
export function pickSampleVoices(byCode: Record<string, VoiceInfo[]>, preferred: string, count: number): string[] {
  const lists = Object.values(byCode).map((vs) => vs.map((v) => v.name).filter((n) => n !== preferred));
  const all = new Set(Object.values(byCode).flatMap((vs) => vs.map((v) => v.name)));
  const out = all.has(preferred) ? [preferred] : [];
  for (let i = 0; out.length < count && lists.some((l) => i < l.length); i++) {
    for (const l of lists) if (i < l.length && out.length < count) out.push(l[i]);
  }
  return out;
}

/**
 * `npm run audio:samples` (mise en place, spec §14) : liste les voix Chirp 3 HD de chaque langue
 * (voices.list filtré sur « Chirp3-HD », spec §16), synthétise `count` échantillons par langue
 * dans `<outDir>/voice-samples/` et écrit `index.json`. Ne sert jamais pendant la routine.
 * Les fichiers sont écrits dans un dossier voisin `voice-samples.tmp`, qui remplace le dossier
 * précédent seulement si au moins un échantillon a été écrit : un passage en échec (clé refusée,
 * service muet) laisse les échantillons précédents intacts.
 * Codes : 0 = tous les échantillons écrits ; 1 = certains seulement ; 2 = aucun.
 */
export async function runVoiceSamples(opts: SamplesOptions): Promise<{ exitCode: 0 | 1 | 2; index: SamplesIndex; dir: string }> {
  const requested = opts.count ?? DEFAULT_SAMPLES;
  const count = Math.min(MAX_SAMPLES, Math.max(1, Math.floor(requested)));
  const final = join(opts.outDir, 'voice-samples');
  const dir = `${final}.tmp`;
  const secrets = [opts.apiKey];
  const clean = (m: string) => redactText(m, secrets);
  const index: SamplesIndex = { generatedAt: '', voices: { fr: [], en: [], es: [] }, samples: [], characters: 0, issues: [] };
  if (count !== requested) index.issues.push(`--count ${requested} ramené à ${count} (${requested > MAX_SAMPLES ? 'maximum' : 'minimum 1, entier'})`);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });

  const breaker = new Breaker();
  const client: TtsClient = { apiKey: opts.apiKey, fetch: opts.fetch, timeoutMs: opts.timeoutMs };
  for (const lang of LANGS) {
    const byCode: Record<string, VoiceInfo[]> = {};
    for (const code of LANGUAGE_CODES[lang]) {
      if (breaker.open) break;
      try {
        byCode[code] = chirp3HdVoices(await listVoices(code, client), code);
        breaker.success();
      } catch (e) {
        breaker.trip(e);
        index.issues.push(clean(`voices.list ${code} : ${describeError(e)}`));
      }
    }
    index.voices[lang] = Object.values(byCode).flatMap((vs) => vs.map((v) => v.name));
    const preferred = opts.voices[lang].name;
    if (Object.keys(byCode).length > 0 && !index.voices[lang].includes(preferred)) index.issues.push(`${lang} : la voix configurée ${preferred} est absente de voices.list`);
    for (const name of pickSampleVoices(byCode, preferred, count)) {
      const entry: SampleEntry = { lang, voice: name, file: null, error: null };
      index.samples.push(entry);
      if (breaker.open) {
        entry.error = `Text-to-Speech coupé (${breaker.reason})`;
        continue;
      }
      const languageCode = name.split('-').slice(0, 2).join('-');
      try {
        index.characters += billedChars(SAMPLE_TEXTS[lang]);
        const mp3 = await synthesize(SAMPLE_TEXTS[lang], { languageCode, name }, {}, client);
        breaker.success();
        writeAtomic(join(dir, `${name}.mp3`), mp3);
        entry.file = `${name}.mp3`;
      } catch (e) {
        breaker.trip(e);
        entry.error = clean(describeError(e));
      }
    }
  }
  index.generatedAt = new Date().toISOString();
  writeAtomic(join(dir, 'index.json'), stripSecrets(JSON.stringify(index, null, 2), secrets) + '\n');
  const made = index.samples.filter((s) => s.file).length;
  // Remplace le dossier précédent seulement si quelque chose a été écrit (ou s'il n'y avait rien à protéger).
  if (made > 0 || !existsSync(final)) {
    rmSync(final, { recursive: true, force: true });
    renameSync(dir, final);
  } else rmSync(dir, { recursive: true, force: true });
  return { exitCode: made === 0 ? 2 : made === index.samples.length ? 0 : 1, index, dir: final };
}
