import {
  parseEdition,
  RUBRIC_LABELS,
  type Edition,
  type OpenThread,
  type Section,
  type SourceRef,
  type Story,
} from '@daily-brief/schema';
import { normalizeUrl } from '../lib/url';
import { canReadFull, type Whitelist } from '../lib/whitelist';
import { checkDivergence } from './divergences';
import { MAX_OUTLET_SHARE, outletShares, storyOutletCount } from './diversity';
import type { Issue, Rule } from './issues';
import { checkStat } from './numbers';
import { checkPerimeter } from './perimeter';
import { isKnownPrepaSubject } from './prepa';
import { checkQuote } from './quotes';
import type { SourceTexts } from './sources';
import { resolveThread } from './threads';
import { arcProblem, DEFAULT_PHOTO_QUERY, photoQueryProblem } from './visuals';
import { vocabWarnings } from './vocab';

export type VerifyContext = {
  texts: SourceTexts;
  whitelist: Whitelist;
  prepaSubjects: Map<string, string>;
  openThreads: OpenThread[];
};

export type VerifyResult = { edition: Edition | null; issues: Issue[] };

const sameUrl = (a: string, b: string) => normalizeUrl(a) === normalizeUrl(b);

/**
 * Contrôle une édition et renvoie une copie corrigée qui respecte R1–R12.
 * Ne bloque jamais l'édition : seul un schéma invalide renvoie `edition: null`.
 */
export function verifyEdition(input: unknown, ctx: VerifyContext): VerifyResult {
  const parsed = parseEdition(input);
  if (!parsed.success) {
    return { edition: null, issues: parsed.errors.map((message) => ({ rule: 'SCHEMA', level: 'error', message })) };
  }
  const ed = structuredClone(parsed.data);
  const issues: Issue[] = [];
  const fix = (rule: Rule, message: string, storyId?: string) =>
    issues.push({ rule, level: 'fixed', lang: ed.lang, storyId, message });
  const warn = (rule: Rule, message: string, storyId?: string) =>
    issues.push({ rule, level: 'warning', lang: ed.lang, storyId, message });

  const people = ed.sections.flatMap((s) => s.stories.flatMap((st) => (st.quote ? [st.quote.speaker] : [])));

  const keepSource = (src: SourceRef, storyId?: string): boolean => {
    const p = checkPerimeter(ed.lang, src, ctx.whitelist);
    if (p) {
      fix('R2', `source retirée : ${p.remove}`, storyId);
      return false;
    }
    return true;
  };

  const enforceReadFull = (src: SourceRef, storyId?: string): SourceRef => {
    if (src.readFull && !canReadFull(ctx.whitelist, src.url) && !ctx.texts.inNewsletter(src.url)) {
      fix('R1', `${src.outlet} : domaine hors liste blanche, passé en « titre + lien »`, storyId);
      return { ...src, readFull: false };
    }
    return src;
  };

  /** Renvoie le sujet corrigé, ou une brève s'il est rétrogradé, ou null s'il est retiré. */
  const verifyStory = (input: Story, section: Section): Story | SourceRef | null => {
    const story = structuredClone(input);
    const id = story.id;

    story.sources = story.sources.filter((s) => keepSource(s, id)).map((s) => enforceReadFull(s, id));
    if (story.sources.length === 0) {
      fix('R2', 'sujet retiré : plus aucune source dans le périmètre', id);
      return null;
    }
    if (!story.sources.some((s) => s.readFull)) {
      fix('R4', 'aucune source lue en entier : sujet rétrogradé en brève', id);
      return { ...story.sources[0], readFull: false };
    }

    if (story.quote) {
      const q = story.quote;
      const src = story.sources.find((s) => sameUrl(s.url, q.sourceUrl));
      const verdict = checkQuote(q, ctx.texts.textFor(q.sourceUrl));
      if (!src) {
        fix('R5', 'citation retirée : sa source n’est pas dans les sources du sujet', id);
        story.quote = null;
      } else if (!verdict.ok) {
        fix('R5', `citation retirée : ${verdict.reason}`, id);
        story.quote = null;
      } else if (src.lang !== ed.lang && !q.translation) {
        fix('R5', `citation retirée : en « ${src.lang} » sans traduction`, id);
        story.quote = null;
      } else if (src.lang === ed.lang && q.translation) {
        warn('R5', 'traduction fournie pour une citation déjà dans la langue de l’édition', id);
      }
    }

    if (story.stats.length) {
      const failures = story.stats
        .map((s) => ({ s, r: checkStat(s, ctx.texts.textFor(s.sourceUrl)) }))
        .filter((x) => !x.r.ok);
      if (failures.length) {
        const reasons = [...new Set(failures.map((f) => (f.r.ok ? '' : f.r.reason)))].join(' ; ');
        fix('R6', `grille de chiffres retirée : ${reasons}`, id);
        story.stats = [];
      }
    }

    story.divergences = story.divergences.filter((d) => {
      const r = checkDivergence(d);
      if (!r.ok) fix('R7', `divergence « ${d.metric} » retirée : ${r.reason}`, id);
      return r.ok;
    });

    if (story.prepa && !isKnownPrepaSubject(story.prepa.subject, ctx.prepaSubjects)) {
      fix('R9', `lien prépa retiré : matière « ${story.prepa.subject} » absente de programme-ect.md`, id);
      story.prepa = null;
    }

    if (story.visual.type === 'photo') {
      const problem = photoQueryProblem(story.visual.query, people);
      if (problem) {
        fix('R11', `requête photo remplacée (${problem})`, id);
        story.visual = { type: 'photo', query: DEFAULT_PHOTO_QUERY[section.key] };
      }
    } else {
      const problem = arcProblem(story.visual.map);
      if (problem) {
        fix('R11', `arc retiré : ${problem}`, id);
        delete story.visual.map.arc;
      }
    }

    if (story.thread) {
      const r = resolveThread(story.thread, ed.lang, ctx.openThreads);
      story.thread = r.thread;
      if (r.fix) fix('R12', r.fix, id);
    }

    if (storyOutletCount(story) < 2) warn('R3', 'un seul média pour ce sujet (objectif : au moins deux)', id);
    return story;
  };

  for (const section of ed.sections) {
    section.title = RUBRIC_LABELS[ed.lang][section.key];
    const stories: Story[] = [];
    const briefs: SourceRef[] = section.briefs.filter((b) => keepSource(b)).map((b) => enforceReadFull(b));
    for (const st of section.stories) {
      const out = verifyStory(st, section);
      if (out === null) continue;
      if ('summary' in out) stories.push(out);
      else briefs.push(out);
    }
    section.stories = stories;
    section.briefs = briefs;
  }
  ed.sections = ed.sections.filter((s) => s.stories.length + s.briefs.length > 0);

  const storyIds = new Set(ed.sections.flatMap((s) => s.stories.map((st) => st.id)));
  for (const item of ed.morningBrief) {
    if (item.storyId && !storyIds.has(item.storyId)) {
      fix('R8', `Morning Brief : storyId ${item.storyId} ne désigne plus un sujet`);
      delete item.storyId;
    }
  }
  const perRubric = new Map<string, number>();
  for (const item of ed.morningBrief) perRubric.set(item.rubric, (perRubric.get(item.rubric) ?? 0) + 1);
  for (const [rubric, n] of perRubric) {
    if (n > 2) warn('R8', `Morning Brief déséquilibré : ${n} infos « ${rubric} »`);
  }

  for (const { outlet, share } of outletShares(ed)) {
    if (share > MAX_OUTLET_SHARE) warn('R3', `${outlet} pèse ${Math.round(share * 100)} % des sources (plafond 30 %)`);
  }

  if (ed.vocab) for (const w of vocabWarnings(ed.vocab)) warn('R10', w);

  return { edition: ed, issues };
}
