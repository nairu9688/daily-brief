import type { Edition, Lang, SourceRef, Story } from '@daily-brief/schema';
import { outletOf, type Whitelist } from '../lib/whitelist';

export const MAX_OUTLET_SHARE = 0.3;

/** Médias distincts d'un sujet, comptés par clé normalisée (bbc.com et bbc.co.uk : un seul média). */
export function storyOutletCount(story: Pick<Story, 'sources'>, wl: Whitelist): number {
  return new Set(story.sources.map((s) => outletOf(wl, s.url).key)).size;
}

const allSources = (ed: Edition): SourceRef[] => ed.sections.flatMap((s) => [...s.stories.flatMap((st) => st.sources), ...s.briefs]);

/** Part de chaque média (clé normalisée, nom affiché) dans toutes les sources de l'édition, sujets et brèves ; du plus cité au moins cité. */
export function outletShares(ed: Edition, wl: Whitelist): { key: string; outlet: string; sources: number; share: number }[] {
  const all = allSources(ed);
  const counts = new Map<string, { outlet: string; sources: number }>();
  for (const s of all) {
    const id = outletOf(wl, s.url);
    const c = counts.get(id.key) ?? counts.set(id.key, { outlet: id.name, sources: 0 }).get(id.key)!;
    c.sources++;
  }
  return [...counts.entries()]
    .map(([key, c]) => ({ key, outlet: c.outlet, sources: c.sources, share: c.sources / all.length }))
    .sort((a, b) => b.sources - a.sources || a.outlet.localeCompare(b.outlet, 'fr'));
}

const fold = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
/** Complément admis après le nom du média : « Sud Radio · AFP », « franceinfo (AFP) ». */
const SUFFIX = /^\s*[·\-–—/(,|]/;

/**
 * Nom affiché d'une source : celui de la liste blanche pour un média connu (un seul nom par média),
 * complément éventuel conservé (« Sud Radio · AFP ») ; hors liste, le nom écrit par la rédaction.
 */
export function displayOutlet(wl: Whitelist, outlet: string, url: string): string {
  const id = outletOf(wl, url);
  if (!id.known) return outlet;
  const o = outlet.trim();
  const rest = o.slice(id.name.length);
  if (fold(o.slice(0, id.name.length)) === fold(id.name) && SUFFIX.test(rest)) return id.name + rest;
  return id.name;
}

export type DiversitySummary = {
  sources: number;
  outlets: number;
  /** Trois médias les plus cités ; part arrondie au centième. */
  top: { outlet: string; sources: number; share: number }[];
  /** Médias au-delà de 30 % des sources (R3). */
  overCap: string[];
  /** Sujets à un seul média (objectif R3 : au moins deux). */
  singleOutletStories: string[];
};

/** Bilan R3 d'une édition, écrit dans verify-report.json et affiché par brief:verify. */
export function diversitySummary(ed: Edition, wl: Whitelist): DiversitySummary {
  const shares = outletShares(ed, wl);
  return {
    sources: allSources(ed).length,
    outlets: shares.length,
    top: shares.slice(0, 3).map((s) => ({ outlet: s.outlet, sources: s.sources, share: Math.round(s.share * 100) / 100 })),
    overCap: shares.filter((s) => s.share > MAX_OUTLET_SHARE).map((s) => s.outlet),
    singleOutletStories: ed.sections.flatMap((s) => s.stories.filter((st) => storyOutletCount(st, wl) < 2).map((st) => st.id)),
  };
}

/** Une ligne lisible : « R3 FR : 31 sources, 12 médias ; en tête : franceinfo 23 %, … ; 2 sujets à un seul média (…) ». */
export function formatDiversity(lang: Lang, d: DiversitySummary): string {
  const parts = [`R3 ${lang.toUpperCase()} : ${d.sources} source${d.sources > 1 ? 's' : ''}, ${d.outlets} média${d.outlets > 1 ? 's' : ''}`];
  if (d.top.length) parts.push(`en tête : ${d.top.map((t) => `${t.outlet} ${Math.round(t.share * 100)} %`).join(', ')}`);
  if (d.overCap.length) parts.push(`au-delà de 30 % : ${d.overCap.join(', ')}`);
  const n = d.singleOutletStories.length;
  if (n) parts.push(`${n} sujet${n > 1 ? 's' : ''} à un seul média (${d.singleOutletStories.join(', ')})`);
  return parts.join(' ; ');
}
