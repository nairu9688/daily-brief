import type { Edition, Story } from '@daily-brief/schema';
import { tryNormalizeUrl } from '../lib/url';

/** R13 : environ 10 sujets par édition, jamais plus de 15. */
export const MAX_STORIES = 15;
/** R13 : script audio d'environ 3 minutes (≈ 2,75 mots/s mesurés le 19/11/2026 : 360 mots → 2 min 11). */
export const AUDIO_WORDS = { min: 450, max: 520 } as const;

export const wordCount = (text: string): number => text.split(/\s+/).filter(Boolean).length;

/**
 * Ramène l'édition à `MAX_STORIES` sujets : tant qu'il y en a trop, le dernier sujet de la rubrique la plus
 * fournie (à égalité, la plus loin dans l'ordre des rubriques) est rétrogradé en brève de sa rubrique
 * (sa première source, en « titre + lien »). Un sujet du Morning Brief (`protectedIds`) n'est jamais
 * rétrogradé. Modifie `ed` et renvoie les id rétrogradés, dans l'ordre.
 */
export function capStories(ed: Edition, protectedIds: ReadonlySet<string>): string[] {
  const demoted: string[] = [];
  const removable = (stories: Story[]) => stories.filter((st) => !protectedIds.has(st.id));
  let total = ed.sections.reduce((n, s) => n + s.stories.length, 0);
  while (total > MAX_STORIES) {
    let pick: Edition['sections'][number] | undefined;
    for (const s of ed.sections) if (removable(s.stories).length > 0 && (!pick || s.stories.length >= pick.stories.length)) pick = s;
    if (!pick) break;
    const story = removable(pick.stories).at(-1)!;
    pick.stories = pick.stories.filter((st) => st !== story);
    const brief = { ...story.sources[0], readFull: false };
    const key = (url: string) => tryNormalizeUrl(url) ?? url;
    if (!pick.briefs.some((b) => key(b.url) === key(brief.url))) pick.briefs.push(brief);
    demoted.push(story.id);
    total--;
  }
  return demoted;
}
