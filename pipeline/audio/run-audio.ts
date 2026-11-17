import { existsSync, mkdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { IsoDateSchema, LANGS, parseEdition, type Edition, type Lang } from '@daily-brief/schema';
import { Breaker } from '../collect/breaker';
import type { HttpFetch } from '../collect/http';
import { writeAtomic } from '../lib/fs';
import { redactText, stripSecrets } from '../lib/redact';
import { looksLikeMp3, mp3FileName } from '../publish/files';
import { MAX_JSON_BYTES, MAX_MP3_BYTES } from '../publish/inputs';
import { CharBudget } from './budget';
import { findFfmpeg, type ConcatMethod } from './concat';
import { formatDuration } from './mp3';
import { voiceEdition, VoiceEditionError } from './voice-edition';
import { loadVoices, VOICES_PATH, type Voices } from './voices';

/** Échéance globale de `brief:audio` : la routine n'attend jamais l'audio plus de 10 minutes. */
export const AUDIO_DEADLINE_MS = 10 * 60_000;

export type AudioIssue = { level: 'error' | 'warning'; lang?: Lang; message: string };

export type AudioEditionReport = {
  lang: Lang;
  voice: string;
  chunks: number;
  /** Caractères envoyés à Text-to-Speech pour cette édition. */
  characters: number;
  /** Nom du MP3 écrit, ou null (édition publiée sans lecteur). */
  file: string | null;
  /** Durée « m:ss », comme dans audio.json. */
  duration: string | null;
  seconds: number | null;
  bytes: number | null;
  method: ConcatMethod | null;
  error: string | null;
};

/**
 * - `ok` : un MP3 par édition vérifiée ; `degraded` : au moins un MP3, mais pas pour toutes ;
 * - `disabled` : pas de clé, aucun appel (avertissement) ; `failed` : clé présente, aucun MP3 ;
 * - `invalid` : entrée inutilisable (date, voices.json, aucune édition vérifiée lisible).
 */
export type AudioStatus = 'ok' | 'degraded' | 'disabled' | 'failed' | 'invalid';

export type AudioReport = {
  date: string;
  generatedAt: string;
  exitCode: 0 | 1 | 2;
  status: AudioStatus;
  /** Voix confirmées dans voices.json (null si le fichier est illisible). */
  voicesConfirmed: boolean | null;
  /** ffmpeg trouvé (réencodage 64 kb/s mono) ; sinon concaténation des trames. */
  ffmpeg: boolean;
  characters: { sent: number; maxPerEdition: number; maxPerRun: number };
  editions: AudioEditionReport[];
  issues: AudioIssue[];
};

export type RunAudioOptions = {
  outDir: string;
  date: string;
  /** `GOOGLE_TTS_API_KEY` ; sans clé, l'audio est désactivé (code 0, avertissement). */
  apiKey?: string;
  fetch: HttpFetch;
  /** Chemin de ffmpeg, null pour s'en passer ; par défaut, recherche dans le PATH. */
  ffmpeg?: string | null;
  voicesPath?: string;
  budget?: CharBudget;
  deadlineMs?: number;
  /** Délai d'une requête de synthèse. */
  timeoutMs?: number;
  maxChunkBytes?: number;
};

export type RunAudioResult = { exitCode: 0 | 1 | 2; report: AudioReport; reportWritten: boolean };

/** Fichiers de `brief:audio` dans le dossier du jour, supprimés avant tout travail. */
export const audioOutputs = (date: string): string[] => [...LANGS.flatMap((l) => [mp3FileName(date, l), `${mp3FileName(date, l)}.tmp`]), 'audio.json', 'audio.json.tmp', 'audio-report.json', 'audio-report.json.tmp'];

/** Lit `{lang}.verified.json` (taille bornée), contrôlé contre sa langue et sa date. */
function readEdition(dayDir: string, lang: Lang, date: string): { edition?: Edition; issue?: AudioIssue } {
  const name = `${lang}.verified.json`;
  const path = join(dayDir, name);
  if (!existsSync(path)) return { issue: { level: 'warning', lang, message: `${name} absent : pas d'audio pour cette édition` } };
  try {
    if (statSync(path).size > MAX_JSON_BYTES) throw new Error(`fichier trop lourd (plus de ${MAX_JSON_BYTES} octets)`);
    const parsed = parseEdition(JSON.parse(readFileSync(path, 'utf8')));
    if (!parsed.success) return { issue: { level: 'error', lang, message: `${name} invalide : ${parsed.errors.slice(0, 3).join(' ; ')}` } };
    if (parsed.data.lang !== lang || parsed.data.date !== date) {
      return { issue: { level: 'error', lang, message: `${name} contient l’édition ${parsed.data.lang} du ${parsed.data.date} (attendu : ${lang}, ${date})` } };
    }
    return { edition: parsed.data };
  } catch (e) {
    return { issue: { level: 'error', lang, message: `${name} illisible : ${(e as Error).message}` } };
  }
}

/**
 * `brief:audio` : lit l'`audioScript` de chaque `{lang}.verified.json`, le fait lire par la voix
 * Chirp 3 HD de l'édition, écrit `Daily Brief <date> FR.mp3` (EN, ES), `audio.json`
 * (`{ fr: { duration: "3:24" } }`, lu par brief:render) et `audio-report.json`.
 *
 * L'audio ne bloque jamais la routine (spec §9 et §12) : une édition en échec est publiée sans
 * lecteur, les autres continuent. Codes : 0 = au moins un MP3, ou audio désactivé faute de clé ;
 * 1 = clé présente mais aucun MP3 ; 2 = entrée invalide. Quel que soit le code, la routine
 * enchaîne sur brief:render.
 */
export async function runAudio(opts: RunAudioOptions): Promise<RunAudioResult> {
  const apiKey = opts.apiKey?.trim() || undefined;
  const budget = opts.budget ?? new CharBudget();
  const issues: AudioIssue[] = [];
  const editions: AudioEditionReport[] = [];
  const report: AudioReport = {
    date: opts.date,
    generatedAt: '',
    exitCode: 2,
    status: 'invalid',
    voicesConfirmed: null,
    ffmpeg: false,
    characters: { sent: 0, maxPerEdition: budget.perEdition, maxPerRun: budget.perRun },
    editions,
    issues,
  };
  const secrets = [apiKey];
  const issue = (level: AudioIssue['level'], message: string, lang?: Lang) => issues.push({ level, ...(lang ? { lang } : {}), message: redactText(message, secrets) });

  if (!IsoDateSchema.safeParse(opts.date).success) {
    issue('error', `date incorrecte : « ${opts.date} »`);
    report.generatedAt = new Date().toISOString();
    return { exitCode: 2, report, reportWritten: false };
  }
  const dayDir = join(opts.outDir, opts.date);

  const finish = (exitCode: 0 | 1 | 2, status: AudioStatus): RunAudioResult => {
    report.exitCode = exitCode;
    report.status = status;
    report.characters.sent = budget.sent;
    report.generatedAt = new Date().toISOString();
    try {
      writeAtomic(join(dayDir, 'audio-report.json'), stripSecrets(JSON.stringify(report, null, 2), secrets) + '\n');
      return { exitCode, report, reportWritten: true };
    } catch {
      return { exitCode, report, reportWritten: false };
    }
  };

  try {
    mkdirSync(dayDir, { recursive: true });
    // Les anciens MP3 d'abord : brief:publish prend tout MP3 présent pour une édition publiable.
    for (const name of audioOutputs(opts.date)) rmSync(join(dayDir, name), { force: true });
  } catch (e) {
    issue('error', `anciens fichiers audio impossibles à supprimer : ${(e as Error).message}`);
    return finish(2, 'invalid');
  }

  let voices: Voices;
  try {
    voices = loadVoices(opts.voicesPath ?? VOICES_PATH);
  } catch (e) {
    issue('error', (e as Error).message);
    return finish(2, 'invalid');
  }
  report.voicesConfirmed = voices.confirmed;

  const todo: Edition[] = [];
  for (const lang of LANGS) {
    const r = readEdition(dayDir, lang, opts.date);
    if (r.issue) issues.push(r.issue);
    if (r.edition) todo.push(r.edition);
  }
  if (todo.length === 0) {
    issue('error', 'aucune édition vérifiée lisible : pas d’audio');
    return finish(2, 'invalid');
  }

  if (!apiKey) {
    issue('warning', 'GOOGLE_TTS_API_KEY absente : audio désactivé, éditions publiées sans lecteur');
    return finish(0, 'disabled');
  }
  if (!voices.confirmed) issue('warning', 'voix par défaut non confirmées : lancer npm run audio:samples et choisir les voix (voices.json)');

  const ffmpeg = opts.ffmpeg !== undefined ? opts.ffmpeg : findFfmpeg();
  report.ffmpeg = ffmpeg !== null;
  if (!ffmpeg) issue('warning', 'ffmpeg absent : trames concaténées sans réencodage (débit de la source)');

  const signal = AbortSignal.timeout(opts.deadlineMs ?? AUDIO_DEADLINE_MS);
  const breaker = new Breaker();
  const durations: Partial<Record<Lang, { duration: string }>> = {};
  try {
    for (const ed of todo) {
      const voice = voices[ed.lang];
      const entry: AudioEditionReport = { lang: ed.lang, voice: voice.name, chunks: 0, characters: 0, file: null, duration: null, seconds: null, bytes: null, method: null, error: null };
      editions.push(entry);
      const fail = (message: string) => {
        entry.error = redactText(message, secrets);
        issue('error', `${message} : édition publiée sans lecteur`, ed.lang);
      };
      let voiced;
      try {
        voiced = await voiceEdition(ed.audioScript, voice, { client: { apiKey, fetch: opts.fetch, signal, timeoutMs: opts.timeoutMs }, breaker, budget, ffmpeg, maxChunkBytes: opts.maxChunkBytes });
      } catch (e) {
        if (e instanceof VoiceEditionError) entry.characters = e.characters;
        fail(e instanceof Error ? e.message : String(e));
        continue;
      }
      Object.assign(entry, { chunks: voiced.chunks, characters: voiced.characters, method: voiced.method, seconds: Math.round(voiced.seconds * 100) / 100 });
      for (const w of voiced.warnings) issue('warning', w, ed.lang);
      if (voiced.bytes.length > MAX_MP3_BYTES || !looksLikeMp3(voiced.bytes)) {
        fail(`MP3 refusé (${voiced.bytes.length} octets, ${MAX_MP3_BYTES} au plus, en-tête MP3 exigé)`);
        continue;
      }
      const name = mp3FileName(opts.date, ed.lang);
      try {
        writeAtomic(join(dayDir, name), voiced.bytes);
      } catch (e) {
        fail(`${name} impossible à écrire : ${(e as Error).message}`);
        continue;
      }
      Object.assign(entry, { file: name, bytes: voiced.bytes.length, duration: formatDuration(voiced.seconds) });
      durations[ed.lang] = { duration: entry.duration! };
    }
  } catch (e) {
    issue('error', `erreur inattendue : ${(e as Error).message}`);
  }

  const made = editions.filter((e) => e.file !== null).length;
  if (made > 0) {
    try {
      writeAtomic(join(dayDir, 'audio.json'), JSON.stringify(durations, null, 2) + '\n');
    } catch (e) {
      issue('warning', `audio.json impossible à écrire, PDF sans encart audio : ${(e as Error).message}`);
    }
  }
  if (made === 0) return finish(1, 'failed');
  return finish(0, made === todo.length ? 'ok' : 'degraded');
}
