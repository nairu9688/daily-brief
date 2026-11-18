import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import { IsoDateSchema } from '@daily-brief/schema';
import { writeAtomic } from '../lib/fs';
import { loadNewsletters, matchSender, senderDomain, type Newsletter, type NewslettersConfig } from './config';
import { htmlToMarkdown, tidy } from './markdown';

/** Message tel que la routine l'enregistre depuis le connecteur Gmail, sans rien réécrire. */
export const GmailMessageSchema = z
  .object({
    id: z.string().min(1),
    from: z.string().min(1),
    subject: z.string(),
    date: z.string().min(1),
    html: z.string().nullish(),
    text: z.string().nullish(),
  })
  .refine((m) => Boolean(m.html?.trim() || m.text?.trim()), 'ni html ni text');

export const MAX_MESSAGE_BYTES = 2 * 1024 * 1024;
/** Un message plus vieux que 36 h n'est pas du jour (la routine lit les 24 dernières heures). */
export const MAX_AGE_MS = 36 * 3600_000;

export type NewslettersIssue = { level: 'error' | 'warning'; message: string };
export type NewslettersReport = {
  date: string;
  generatedAt: string;
  exitCode: 0 | 2;
  written: { file: string; newsletter: string; messageId: string; links: number }[];
  skipped: { file: string; reason: string }[];
  issues: NewslettersIssue[];
};

export type RunNewslettersOptions = { outDir: string; date: string; configPath?: string; now?: Date };

/**
 * `brief:newsletters` : convertit, par une étape mécanique, les messages Gmail enregistrés par la
 * routine (`out/<date>/newsletters/gmail/*.json`) en `out/<date>/newsletters/*.md`, que brief:verify
 * compte comme textes lus (R1). Seuls les expéditeurs des newsletters actives de newsletters.json
 * sont gardés, au plus une par newsletter et `maxPerDay` en tout ; les anciens `.md` sont supprimés
 * d'abord. Code 0 (même sans message), 2 si la date, la configuration ou le dossier est inutilisable.
 */
export function runNewsletters(opts: RunNewslettersOptions): { exitCode: 0 | 2; report: NewslettersReport } {
  const now = opts.now ?? new Date();
  const report: NewslettersReport = { date: opts.date, generatedAt: now.toISOString(), exitCode: 2, written: [], skipped: [], issues: [] };
  const issue = (level: NewslettersIssue['level'], message: string) => report.issues.push({ level, message });
  if (!IsoDateSchema.safeParse(opts.date).success) {
    issue('error', `date incorrecte : « ${opts.date} »`);
    return { exitCode: 2, report };
  }
  const dir = join(opts.outDir, opts.date, 'newsletters');
  const finish = (exitCode: 0 | 2) => {
    report.exitCode = exitCode;
    try {
      mkdirSync(join(opts.outDir, opts.date), { recursive: true });
      writeAtomic(join(opts.outDir, opts.date, 'newsletters-report.json'), JSON.stringify(report, null, 2) + '\n');
    } catch (e) {
      issue('error', `newsletters-report.json impossible à écrire : ${(e as Error).message}`);
    }
    return { exitCode, report };
  };

  let config: NewslettersConfig;
  try {
    config = loadNewsletters(opts.configPath);
  } catch (e) {
    issue('error', `newsletters.json invalide : ${e instanceof z.ZodError ? e.issues.map((i) => i.message).slice(0, 3).join(' ; ') : (e as Error).message}`);
    return finish(2);
  }
  try {
    mkdirSync(dir, { recursive: true });
    for (const f of readdirSync(dir)) if (f.endsWith('.md')) rmSync(join(dir, f));
  } catch (e) {
    issue('error', `ancien texte de newsletter impossible à supprimer : ${(e as Error).message}`);
    return finish(2);
  }

  const gmailDir = join(dir, 'gmail');
  const files = existsSync(gmailDir) ? readdirSync(gmailDir).filter((f) => f.endsWith('.json')).sort() : [];
  if (files.length === 0) {
    issue('warning', 'aucun message Gmail enregistré : brief rédigé sans newsletter');
    return finish(0);
  }

  type Kept = { file: string; n: Newsletter; m: z.infer<typeof GmailMessageSchema>; at: number };
  const kept: Kept[] = [];
  const skip = (file: string, reason: string) => report.skipped.push({ file, reason });
  for (const file of files) {
    try {
      if (statSync(join(gmailDir, file)).size > MAX_MESSAGE_BYTES) {
        skip(file, `message trop lourd (plus de ${MAX_MESSAGE_BYTES} octets)`);
        continue;
      }
      const parsed = GmailMessageSchema.safeParse(JSON.parse(readFileSync(join(gmailDir, file), 'utf8')));
      if (!parsed.success) {
        skip(file, `message illisible : ${parsed.error.issues.map((i) => i.message).join(' ; ')}`);
        continue;
      }
      const n = matchSender(config, parsed.data.from);
      if (!n) {
        skip(file, `expéditeur hors liste (${senderDomain(parsed.data.from) ?? 'adresse illisible'})`);
        continue;
      }
      const at = Date.parse(parsed.data.date);
      if (Number.isNaN(at)) issue('warning', `${file} : date « ${parsed.data.date} » illisible, message gardé`);
      else if (now.getTime() - at > MAX_AGE_MS) {
        skip(file, `message du ${new Date(at).toISOString()} : plus de 36 h`);
        continue;
      }
      kept.push({ file, n, m: parsed.data, at: Number.isNaN(at) ? now.getTime() : at });
    } catch (e) {
      skip(file, `message illisible : ${(e as Error).message}`);
    }
  }

  // Le plus récent de chaque newsletter, puis le plafond du jour, dans l'ordre de newsletters.json.
  const latest = new Map<string, Kept>();
  for (const k of kept) {
    const prev = latest.get(k.n.id);
    if (prev) skip(k.at >= prev.at ? prev.file : k.file, `autre envoi de ${k.n.name} le même jour`);
    if (!prev || k.at >= prev.at) latest.set(k.n.id, k);
  }
  const order = config.newsletters.map((n) => n.id);
  const chosen = [...latest.values()].sort((a, b) => order.indexOf(a.n.id) - order.indexOf(b.n.id));
  for (const k of chosen.slice(config.maxPerDay)) skip(k.file, `plafond de ${config.maxPerDay} newsletters par jour`);

  chosen.slice(0, config.maxPerDay).forEach((k, i) => {
    const body = k.m.html?.trim() ? htmlToMarkdown(k.m.html) : tidy(k.m.text ?? '');
    const name = `${String(i + 1).padStart(2, '0')}-${k.n.id}.md`;
    const header = `# ${tidy(k.m.subject) || k.n.name}\n\nNewsletter : ${k.n.name} (${k.n.publisher}) · ${senderDomain(k.m.from)} · ${k.m.date}`;
    try {
      writeAtomic(join(dir, name), `${header}\n\n${body}\n`);
      report.written.push({ file: name, newsletter: k.n.id, messageId: k.m.id, links: (body.match(/\]\(https?:\/\//g) ?? []).length + (body.match(/(^|[^(])https?:\/\//g) ?? []).length });
    } catch (e) {
      issue('error', `${name} impossible à écrire : ${(e as Error).message}`);
    }
  });
  return finish(0);
}
