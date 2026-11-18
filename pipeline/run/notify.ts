import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import { LANGS, parseEdition, type Edition, type Lang } from '@daily-brief/schema';
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
const Context = z.object(Base);
const Collect = z.object({ ...Base, degraded: z.boolean(), perLang: z.record(z.string(), z.object({ light: z.boolean() })) });
const Newsletters = z.object({ ...Base, written: z.array(z.unknown()) });
const Verify = z.object({ ...Base, editions: z.array(z.object({ lang: z.string(), written: z.boolean() })) });
const Audio = z.object({ ...Base, status: z.enum(['ok', 'degraded', 'disabled', 'failed', 'invalid']) });
const Render = z.object({ ...Base, pdf: z.string().nullable(), finals: z.array(z.string()) });
const Publish = z.object({ ...Base, status: z.string(), editions: z.array(z.object({ lang: z.string(), published: z.boolean() })), drive: z.object({ status: z.string() }) });

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
export function buildNotification(dayDir: string, date: string, opts: { dryRun?: boolean } = {}): Notification {
  const context = report(dayDir, 'context-report.json', date, Context);
  const collect = report(dayDir, 'collect-report.json', date, Collect);
  const newsletters = report(dayDir, 'newsletters-report.json', date, Newsletters);
  const verify = report(dayDir, 'verify-report.json', date, Verify);
  const audio = report(dayDir, 'audio-report.json', date, Audio);
  const render = report(dayDir, 'render-report.json', date, Render);
  const publish = opts.dryRun ? null : report(dayDir, 'publish-report.json', date, Publish);

  const notes: string[] = [];
  if (!context || context.exitCode !== 0) notes.push('contexte indisponible : Threads non rattachés');
  if (collect?.degraded) notes.push('collecte dégradée');
  const light = LANGS.filter((l) => collect?.perLang[l]?.light);
  if (light.length) notes.push(`édition allégée : ${light.map((l) => l.toUpperCase()).join(', ')}`);
  if (!newsletters || newsletters.exitCode !== 0) notes.push('newsletters non lues');
  else if (newsletters.written.length === 0) notes.push('aucune newsletter');
  if (!audio) notes.push('audio non lancé');
  else if (AUDIO_NOTE[audio.status]) notes.push(AUDIO_NOTE[audio.status]!);
  if (render && render.finals.length > 0 && render.pdf === null) notes.push('PDF absent');
  if (publish && DRIVE_NOTE[publish.drive.status]) notes.push(DRIVE_NOTE[publish.drive.status]);

  const done = opts.dryRun ? (render?.finals ?? []) : (publish?.editions.filter((e) => e.published).map((e) => e.lang) ?? []);
  const finals = LANGS.filter((l) => done.includes(l)).map((l) => finalEdition(dayDir, l, date)).filter((e): e is Edition => e !== null);
  const editions = finals.map((e) => e.lang);
  const stories = finals.reduce((n, e) => n + e.sections.reduce((m, s) => m + s.stories.length, 0), 0);
  const outlets = new Set(finals.flatMap((e) => e.sections.flatMap((s) => [...s.stories.flatMap((st) => st.sources), ...s.briefs])).map((src) => src.outlet.trim().toLowerCase())).size;

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
