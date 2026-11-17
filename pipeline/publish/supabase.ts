import { z } from 'zod';
import type { Edition, Lang } from '@daily-brief/schema';
import { messageOf } from '../collect/http';
import type { CallOptions, SupabaseClient } from '../supabase/client';
import type { DayFile } from './files';
import type { LocalFile, PublishIssue } from './inputs';
import { editionPayload } from './rows';

/** Réponse de la fonction SQL `publish_edition`. */
const PublishedSchema = z.object({
  editionId: z.string().min(1),
  stories: z.number().int().min(0),
  sources: z.number().int().min(0),
  vocab: z.number().int().min(0),
  threadsCreated: z.array(z.string()),
  threadsRemoved: z.number().int().min(0),
  warnings: z.array(z.string()),
});

export type EditionResult = { lang: Lang; published: boolean; stories: number; sources: number; vocab: number; threadsCreated: number };

/**
 * Dépose le PDF et les MP3 dans Supabase Storage (remplacement autorisé : relancer une date écrase
 * ses fichiers). Un envoi en échec donne un avertissement et l'édition sera publiée sans ce fichier.
 */
export async function uploadFiles(client: SupabaseClient, files: LocalFile[], opts?: CallOptions): Promise<{ stored: DayFile[]; issues: PublishIssue[] }> {
  const stored: DayFile[] = [];
  const issues: PublishIssue[] = [];
  for (const { bytes, lang, ...file } of files) {
    try {
      await client.upload(file.bucket, file.path, bytes, file.mimeType, opts);
      stored.push(file);
    } catch (e) {
      issues.push({ level: 'warning', ...(lang ? { lang } : {}), message: `${file.name} non déposé dans Supabase Storage : ${messageOf(e)}` });
    }
  }
  return { stored, issues };
}

export type PublishMeta = {
  /** Fichiers réellement présents dans Storage : seuls leurs chemins sont écrits dans `editions`. */
  stored: DayFile[];
  light: Partial<Record<Lang, boolean>>;
  generatedAt: string;
};

/**
 * Publie chaque édition par un appel à `publish_edition` : une transaction par édition, donc jamais
 * d'édition à moitié écrite. Une édition en échec n'empêche pas les autres.
 */
export async function publishEditions(client: SupabaseClient, editions: Edition[], meta: PublishMeta, opts?: CallOptions): Promise<{ results: EditionResult[]; issues: PublishIssue[] }> {
  const results: EditionResult[] = [];
  const issues: PublishIssue[] = [];
  const pdfPath = meta.stored.find((f) => f.bucket === 'pdf')?.path ?? null;
  for (const edition of editions) {
    const lang = edition.lang;
    const audioPath = meta.stored.find((f) => f.bucket === 'audio' && f.path === `${edition.date}/${lang}.mp3`)?.path ?? null;
    const payload = editionPayload(edition, { pdfPath, audioPath, light: meta.light[lang] ?? false, generatedAt: meta.generatedAt });
    try {
      const r = await client.rpc('publish_edition', { payload }, PublishedSchema, opts);
      results.push({ lang, published: true, stories: r.stories, sources: r.sources, vocab: r.vocab, threadsCreated: r.threadsCreated.length });
      for (const w of r.warnings) issues.push({ level: 'warning', lang, message: w });
    } catch (e) {
      results.push({ lang, published: false, stories: 0, sources: 0, vocab: 0, threadsCreated: 0 });
      issues.push({ level: 'error', lang, message: `édition non publiée : ${messageOf(e)}` });
    }
  }
  return { results, issues };
}
