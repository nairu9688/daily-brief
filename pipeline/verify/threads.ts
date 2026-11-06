import type { Lang, OpenThread, StoryThread } from '@daily-brief/schema';
import { normalizeForMatch } from './normalize';

export type ThreadResult = { thread: StoryThread; fix?: string };

/**
 * R12 : un id doit désigner un Thread ouvert ; sans id, un titre identique à un Thread ouvert
 * de la même langue y est rattaché ; sinon le sujet crée un nouveau Thread (id absent).
 */
export function resolveThread(thread: StoryThread, lang: Lang, open: OpenThread[]): ThreadResult {
  if (thread.id) {
    if (open.some((t) => t.id === thread.id)) return { thread };
    const { id, ...rest } = thread;
    return { thread: rest, fix: `Thread ${id} inconnu ou fermé : traité comme nouveau Thread` };
  }
  const match = open.find((t) => t.lang === lang && normalizeForMatch(t.title) === normalizeForMatch(thread.title));
  if (match) return { thread: { ...thread, id: match.id }, fix: `rattaché au Thread ouvert « ${match.title} »` };
  return { thread };
}
