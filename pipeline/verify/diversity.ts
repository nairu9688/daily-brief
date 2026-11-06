import type { Edition, SourceRef, Story } from '@daily-brief/schema';
import { outletKey } from '../lib/url';

export const MAX_OUTLET_SHARE = 0.3;

export function storyOutletCount(story: Story): number {
  return new Set(story.sources.map((s) => outletKey(s.url))).size;
}

/** Part de chaque média (domaine enregistrable) dans toutes les sources de l'édition, sujets et brèves. */
export function outletShares(ed: Edition): { outlet: string; share: number }[] {
  const all: SourceRef[] = ed.sections.flatMap((s) => [...s.stories.flatMap((st) => st.sources), ...s.briefs]);
  const counts = new Map<string, number>();
  for (const s of all) counts.set(outletKey(s.url), (counts.get(outletKey(s.url)) ?? 0) + 1);
  return [...counts.entries()]
    .map(([outlet, n]) => ({ outlet, share: n / all.length }))
    .sort((a, b) => b.share - a.share);
}
