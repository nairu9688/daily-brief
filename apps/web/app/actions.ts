'use server';
import { z } from 'zod';
import { currentUser } from '@/lib/auth';
import { getDataSource } from '@/lib/data';

/**
 * Actions serveur de l'appli : les seules écritures, et seulement sur les colonnes que la RLS ouvre
 * (vocab_items.selected, vocab_items.anki_status → queued, threads.followed). Chaque entrée est
 * validée par zod, l'utilisateur est revérifié, et la base refuse de toute façon le reste.
 */

export type ActionResult = { ok: true; count: number } | { ok: false; error: string };

const Ids = z.array(z.uuid()).min(1).max(50);
const SelectInput = z.strictObject({ ids: Ids, selected: z.boolean() });
const AnkiInput = z.strictObject({ ids: Ids });
const FollowInput = z.strictObject({ id: z.uuid(), followed: z.boolean() });

const INVALID: ActionResult = { ok: false, error: 'Demande invalide.' };
const SESSION: ActionResult = { ok: false, error: 'Session expirée : reconnecte-toi.' };
const FAILED: ActionResult = { ok: false, error: 'Enregistrement impossible, réessaie.' };

async function run<T>(schema: z.ZodType<T>, input: unknown, write: (value: T) => Promise<number>): Promise<ActionResult> {
  const parsed = schema.safeParse(input);
  if (!parsed.success) return INVALID;
  if (!(await currentUser())) return SESSION;
  try {
    return { ok: true, count: await write(parsed.data) };
  } catch (e) {
    console.error('[daily-brief] écriture refusée', e instanceof Error ? e.message : e);
    return FAILED;
  }
}

export async function setVocabSelected(input: unknown): Promise<ActionResult> {
  return run(SelectInput, input, async ({ ids, selected }) => (await getDataSource()).setSelected(ids, selected));
}

export async function queueAnki(input: unknown): Promise<ActionResult> {
  return run(AnkiInput, input, async ({ ids }) => (await getDataSource()).queueAnki(ids));
}

export async function setThreadFollowed(input: unknown): Promise<ActionResult> {
  return run(FollowInput, input, async ({ id, followed }) => (await getDataSource()).setFollowed(id, followed));
}
