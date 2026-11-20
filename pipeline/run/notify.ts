import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { LANGS, parseEdition, type Edition, type Lang } from '@daily-brief/schema';
import { redactText } from '../lib/redact';
import { loadWhitelist, outletOf, type Whitelist } from '../lib/whitelist';
import { MAX_JSON_BYTES } from '../publish/inputs';

/** Lecture tolérante d'un rapport : absent, illisible ou d'une autre date donne null, jamais une exception. */
function report<T extends z.ZodType>(dayDir: string, name: string, date: string, schema: T): z.infer<T> | null {
  const path = join(dayDir, name);
  try {
    if (!existsSync(path) || statSync(path).size > MAX_JSON_BYTES) return null;
    const r = schema.safeParse(JSON.parse(readFileSync(path, 'utf8')));
    return r.success && (r.data as { date: string }).date === date ? r.data : null;
  } catch {
    return null;
  }
}

const Base = { date: z.string(), exitCode: z.number().int() };
const Issues = z.array(z.object({ level: z.string(), lang: z.string().optional(), message: z.string() })).catch([]).default([]);
const Context = z.object(Base);
const Collect = z.object({ ...Base, degraded: z.boolean(), perLang: z.record(z.string(), z.object({ light: z.boolean() })), issues: Issues });
const Newsletters = z.object({ ...Base, written: z.array(z.unknown()) });
const Verify = z.object({ ...Base, editions: z.array(z.object({ lang: z.string(), written: z.boolean() })) });
const Audio = z.object({ ...Base, status: z.enum(['ok', 'degraded', 'disabled', 'failed', 'invalid']), issues: Issues });
const Render = z.object({ ...Base, pdf: z.string().nullable(), finals: z.array(z.string()) });
const Publish = z.object({
  ...Base,
  status: z.string(),
  editions: z.array(z.object({ lang: z.string(), published: z.boolean() })),
  drive: z.object({ status: z.string() }),
  files: z.array(z.object({ name: z.string(), bucket: z.string(), stored: z.boolean() })).catch([]).default([]),
  issues: Issues,
});

/** Messages repris d'un rapport dans la notification : 2 au plus, 120 caractères chacun, secrets masqués. */
const MAX_NOTE_MESSAGES = 2;
const MAX_NOTE_CHARS = 120;
const bounded = (messages: string[], secrets: (string | undefined)[]) =>
  messages.slice(0, MAX_NOTE_MESSAGES).map((m) => {
    const r = redactText(m.replace(/\s+/g, ' ').trim(), secrets);
    return r.length > MAX_NOTE_CHARS ? `${r.slice(0, MAX_NOTE_CHARS).trimEnd()}…` : r;
  });
const STALE_AUDIO = 'ancien fichier audio impossible à supprimer';

const AUDIO_NOTE: Record<z.infer<typeof Audio>['status'], string | null> = {
  ok: null,
  degraded: 'audio partiel',
  disabled: 'audio désactivé, clé absente',
  failed: 'audio en échec, éditions sans lecteur',
  invalid: 'audio : entrée invalide, éditions sans lecteur',
};
const DRIVE_NOTE: Record<string, string> = { pending: 'Drive en attente', failed: 'Drive en échec', skipped: 'Drive non configuré' };

export type Notification = {
  /** Vrai si les trois éditions sont publiées (ou rendues, en répétition). */
  ready: boolean;
  message: string;
  editions: Lang[];
  stories: number;
  outlets: number;
  notes: string[];
};

const WHITELIST_PATH = fileURLToPath(new URL('../config/whitelist.json', import.meta.url));

/** Liste blanche pour l'identité des médias ; illisible, une liste vide (clé = domaine enregistrable). */
function whitelistOrEmpty(): Whitelist {
  try {
    return loadWhitelist(WHITELIST_PATH);
  } catch {
    return { checkedAt: '', domains: [] };
  }
}

/** Édition finale du jour (`{lang}.final.json`), ou null. */
function finalEdition(dayDir: string, lang: Lang, date: string): Edition | null {
  const path = join(dayDir, `${lang}.final.json`);
  try {
    if (!existsSync(path) || statSync(path).size > MAX_JSON_BYTES) return null;
    const r = parseEdition(JSON.parse(readFileSync(path, 'utf8')));
    return r.success && r.data.lang === lang && r.data.date === date ? r.data : null;
  } catch {
    return null;
  }
}

/**
 * Message final de la routine (annexe A), construit à partir des rapports du jour :
 * « Brief du jour prêt : N sujets, M médias » ou « Brief incomplet : <raison> », suivi entre
 * parenthèses de ce qui manque (collecte dégradée, audio partiel, Drive en attente…).
 * `dryRun` : répétition sans publication, les éditions comptées sont celles du rendu.
 */
export function buildNotification(dayDir: string, date: string, opts: { dryRun?: boolean; secrets?: (string | undefined)[]; whitelist?: Whitelist } = {}): Notification {
  const secrets = opts.secrets ?? [];
  const context = report(dayDir, 'context-report.json', date, Context);
  const collect = report(dayDir, 'collect-report.json', date, Collect);
  const newsletters = report(dayDir, 'newsletters-report.json', date, Newsletters);
  const verify = report(dayDir, 'verify-report.json', date, Verify);
  const audio = report(dayDir, 'audio-report.json', date, Audio);
  const render = report(dayDir, 'render-report.json', date, Render);
  const publish = opts.dryRun ? null : report(dayDir, 'publish-report.json', date, Publish);

  const notes: string[] = [];
  if (!context || context.exitCode !== 0) notes.push('contexte indisponible : Threads non rattachés');
  if (collect?.degraded) {
    const errors = bounded(collect.issues.filter((i) => i.level === 'error').map((i) => i.message), secrets);
    notes.push(errors.length ? `collecte dégradée : ${errors.join(' ; ')}` : 'collecte dégradée');
  }
  const light = LANGS.filter((l) => collect?.perLang[l]?.light);
  if (light.length) notes.push(`édition allégée : ${light.map((l) => l.toUpperCase()).join(', ')}`);
  if (!newsletters || newsletters.exitCode !== 0) notes.push('newsletters non lues');
  else if (newsletters.written.length === 0) notes.push('aucune newsletter');
  if (!audio) notes.push('audio non lancé');
  else if (audio.status === 'invalid' && audio.issues.some((i) => i.message.startsWith(STALE_AUDIO))) notes.push(`audio : ${STALE_AUDIO}, éditions sans lecteur`);
  else if (audio.status === 'disabled' && opts.dryRun) notes.push('audio désactivé (répétition)');
  else if (AUDIO_NOTE[audio.status]) notes.push(AUDIO_NOTE[audio.status]!);
  if (render && render.finals.length > 0 && render.pdf === null) notes.push('PDF absent');
  if (publish) {
    const before = notes.length;
    if (publish.files.some((f) => f.bucket === 'pdf' && !f.stored)) notes.push('PDF non enregistré dans Storage');
    const lostMp3 = publish.files.filter((f) => f.bucket === 'audio' && !f.stored).map((f) => /\b([A-Z]{2})\.mp3$/.exec(f.name)?.[1] ?? f.name);
    if (lostMp3.length) notes.push(`MP3 non enregistré${lostMp3.length > 1 ? 's' : ''} dans Storage : ${lostMp3.join(', ')}`);
    if (DRIVE_NOTE[publish.drive.status]) notes.push(DRIVE_NOTE[publish.drive.status]);
    // Passage dégradé pour une autre raison (Thread refusé, purge, ligne runs…) : la première erreur du rapport.
    // Une édition manquante dégrade aussi le passage, mais le message le dit déjà (« édition ES manquante »).
    const allPublished = LANGS.every((l) => publish.editions.some((e) => e.lang === l && e.published));
    if (publish.status === 'degraded' && notes.length === before && allPublished) {
      const [first] = bounded(publish.issues.filter((i) => i.level === 'error').map((i) => (i.lang ? `${i.lang.toUpperCase()} : ${i.message}` : i.message)), secrets);
      notes.push(first ? `publication dégradée : ${first}` : 'publication dégradée');
    }
  }

  const done = opts.dryRun ? (render?.finals ?? []) : (publish?.editions.filter((e) => e.published).map((e) => e.lang) ?? []);
  const finals = LANGS.filter((l) => done.includes(l)).map((l) => finalEdition(dayDir, l, date)).filter((e): e is Edition => e !== null);
  const editions = finals.map((e) => e.lang);
  const stories = finals.reduce((n, e) => n + e.sections.reduce((m, s) => m + s.stories.length, 0), 0);
  // Médias comptés par clé normalisée (R3) : « eldiario.es » et « elDiario.es », bbc.com et bbc.co.uk font un seul média.
  const wl = opts.whitelist ?? whitelistOrEmpty();
  const outlets = new Set(finals.flatMap((e) => e.sections.flatMap((s) => [...s.stories.flatMap((st) => st.sources), ...s.briefs])).map((src) => outletOf(wl, src.url).key)).size;

  const tail = notes.length ? ` (${notes.join(' ; ')})` : '';
  const counts = `${stories} sujet${stories > 1 ? 's' : ''}, ${outlets} média${outlets > 1 ? 's' : ''}`;
  let reason: string | null = null;
  if (editions.length === 0) {
    if (collect && collect.exitCode !== 0) reason = 'collecte impossible : aucun article';
    else if (!verify) reason = 'rédaction ou contrôle non faits';
    else if (!verify.editions.some((e) => e.written)) reason = 'aucune édition valide après le contrôle';
    else if (!render || render.finals.length === 0) reason = 'rendu impossible';
    else if (!opts.dryRun) reason = publish ? 'publication impossible' : 'publication non lancée';
    else reason = 'rendu impossible';
  } else if (editions.length < LANGS.length) {
    const missing = LANGS.filter((l) => !editions.includes(l)).map((l) => l.toUpperCase());
    reason = `édition${missing.length > 1 ? 's' : ''} ${missing.join(', ')} manquante${missing.length > 1 ? 's' : ''} — ${counts}`;
  }
  const message = reason
    ? `Brief incomplet : ${reason}${tail}`
    : `${opts.dryRun ? 'Répétition sans publication' : 'Brief du jour prêt'} : ${counts}${tail}`;
  return { ready: reason === null, message, editions, stories, outlets, notes };
}
