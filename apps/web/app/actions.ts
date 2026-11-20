'use server';
import { revalidatePath, updateTag } from 'next/cache';
import { z } from 'zod';
import { currentUser } from '@/lib/auth';
import { getDataSource } from '@/lib/data';
import { EDITIONS_TAG } from '@/lib/data/cache-tags';
import { MAX_IDS } from '@/lib/data/limits';

/**
 * Actions serveur de l'appli : les seules écritures, et seulement sur les colonnes que la RLS ouvre
 * (vocab_items.selected, vocab_items.anki_status → queued, threads.followed). Chaque entrée est
 * validée par zod, l'utilisateur est revérifié, et la base refuse de toute façon le reste.
 */

export type ActionResult = { ok: true; count: number } | { ok: false; error: string };

/** Autant que /vocab en affiche (limite de la requête), pour que « Tout cocher » passe en un appel. */
const Ids = z.array(z.uuid()).min(1).max(MAX_IDS);
const SelectInput = z.strictObject({ ids: Ids, selected: z.boolean() });
const AnkiInput = z.strictObject({ ids: Ids });
const FollowInput = z.strictObject({ id: z.uuid(), followed: z.boolean() });

const INVALID: ActionResult = { ok: false, error: 'Demande invalide.' };
const SESSION: ActionResult = { ok: false, error: 'Session expirée : reconnecte-toi.' };
const FAILED: ActionResult = { ok: false, error: 'Enregistrement impossible, réessaie.' };

/**
 * Pages dont le rendu dépend de la colonne écrite (rendu dynamique, mais le cache client de Next les garde).
 * Cocher ne revalide pas /vocab : filtrée sur « Non cochés », la liste perdrait aussitôt le mot coché.
 */
const SELECT_PAGES = ['/', '/edition/[date]'];
const ANKI_PAGES = ['/', '/edition/[date]', '/vocab'];
const THREAD_PAGES = ['/threads', '/threads/[id]'];

/** Utilisateur d'abord (une requête sans session ne voit même pas la validation), puis entrée, écriture et revalidation (cache des éditions compris). */
async function run<T>(schema: z.ZodType<T>, input: unknown, write: (value: T) => Promise<number>, pages: string[], tags: string[] = []): Promise<ActionResult> {
  if (!(await currentUser())) return SESSION;
  const parsed = schema.safeParse(input);
  if (!parsed.success) return INVALID;
  let count: number;
  try {
    count = await write(parsed.data);
  } catch (e) {
    console.error('[daily-brief] écriture refusée', e instanceof Error ? e.message : e);
    return FAILED;
  }
  for (const t of tags) updateTag(t);
  for (const p of pages) revalidatePath(p, p.includes('[') ? 'page' : undefined);
  return { ok: true, count };
}

export async function setVocabSelected(input: unknown): Promise<ActionResult> {
  return run(SelectInput, input, async ({ ids, selected }) => (await getDataSource()).setSelected(ids, selected), SELECT_PAGES, [EDITIONS_TAG]);
}

export async function queueAnki(input: unknown): Promise<ActionResult> {
  return run(AnkiInput, input, async ({ ids }) => (await getDataSource()).queueAnki(ids), ANKI_PAGES, [EDITIONS_TAG]);
}

export async function setThreadFollowed(input: unknown): Promise<ActionResult> {
  return run(FollowInput, input, async ({ id, followed }) => (await getDataSource()).setFollowed(id, followed), THREAD_PAGES);
}
