import type { Lang, OpenThread, StoryThread } from '@daily-brief/schema';
import { normalizeForMatch } from './normalize';

export type ThreadResult = { thread: StoryThread; fix?: string };

/**
 * R12 : un id doit désigner un Thread ouvert de la même langue ; sans id valide, un titre identique
 * à un Thread ouvert de la même langue y est rattaché ; sinon le sujet crée un nouveau Thread (id absent).
 */
export function resolveThread(thread: StoryThread, lang: Lang, open: OpenThread[]): ThreadResult {
  let dropped: string | undefined;
  let current = thread;
  if (thread.id) {
    if (open.some((t) => t.id === thread.id && t.lang === lang)) return { thread };
    const { id, ...rest } = thread;
    dropped = `Thread ${id} inconnu, fermé ou d'une autre langue`;
    current = rest;
  }
  const match = open.find((t) => t.lang === lang && normalizeForMatch(t.title) === normalizeForMatch(current.title));
  if (match) {
    const attached = `rattaché au Thread ouvert « ${match.title} »`;
    return { thread: { ...current, id: match.id }, fix: dropped ? `${dropped} ; ${attached}` : attached };
  }
  return dropped ? { thread: current, fix: `${dropped} : traité comme nouveau Thread` } : { thread: current };
}
