import type { Quote } from '@daily-brief/schema';
import { normalizeForMatch, wordsForMatch } from './normalize';

import type { CheckResult } from './result';

type Span = { start: number; end: number; inner: string };
type Paragraph = { text: string; spans: Span[] };

const SPAN_PATTERNS = [/«([^«»\n]+)»/g, /“([^“”\n]+)”/g, /"([^"\n]+)"/g, /„([^„“”\n]+)[“”]/g];
const SPEAKER_WINDOW = 160;
const PARTICLES = new Set(['le', 'la', 'de', 'du', 'des', 'von', 'van', 'der', 'den', 'di', 'da', 'del', 'dos']);
const TOO_SHORT = 'citation trop courte (3 mots et 15 caractères minimum)';

const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Passages entre guillemets d'un paragraphe (« », “ ”, " ", „ “) ; jamais à cheval sur une ligne. */
function paragraphSpans(text: string): Span[] {
  const oddStraight = ((text.match(/"/g) ?? []).length % 2) === 1;
  const spans: Span[] = [];
  for (const re of SPAN_PATTERNS) {
    if (oddStraight && re.source.startsWith('"')) continue;
    for (const m of text.matchAll(re)) spans.push({ start: m.index!, end: m.index! + m[0].length, inner: m[1] });
  }
  return spans;
}

function paragraphs(text: string): Paragraph[] {
  return text.split('\n').map((p) => ({ text: p, spans: paragraphSpans(p) }));
}

/** Passages entre guillemets du texte source, paragraphe par paragraphe. */
export function quotedSpans(text: string): Span[] {
  return paragraphs(text).flatMap((p) => p.spans);
}

/** Nom de famille de l'orateur, particules comprises : « Marine Le Pen » → « Le Pen », « J.D. Vance » → « Vance ». */
export function speakerSurname(speaker: string): string {
  const name = speaker.split('·')[0].replace(/\(.*?\)/g, '').trim();
  const words = name.split(/\s+/).filter((w) => w.length >= 2);
  if (words.length === 0) return name;
  let i = words.length - 1;
  while (i > 0 && PARTICLES.has(words[i - 1].toLowerCase())) i--;
  return words.slice(i).join(' ');
}

/** Le nom, mot entier, doit figurer dans le même paragraphe, à 160 caractères au plus de la citation. */
function speakerNear(para: Paragraph, span: Span, surname: string): boolean {
  const from = Math.max(0, span.start - SPEAKER_WINDOW);
  const to = Math.min(para.text.length, span.end + SPEAKER_WINDOW);
  const re = new RegExp('(?<![\\p{L}\\p{N}])' + escapeRegex(normalizeForMatch(surname)) + '(?![\\p{L}\\p{N}])', 'u');
  return re.test(normalizeForMatch(para.text.slice(from, to)));
}

/** R5 : citation mot pour mot, entre guillemets dans la source, orateur nommé à côté. */
export function checkQuote(quote: Pick<Quote, 'text' | 'speaker'>, sourceText: string | undefined): CheckResult {
  if (!sourceText) return { ok: false, reason: 'texte source indisponible' };
  const target = wordsForMatch(quote.text);
  if (target.trim().split(' ').filter(Boolean).length < 3 || normalizeForMatch(quote.text).length < 15) {
    return { ok: false, reason: TOO_SHORT };
  }
  const surname = speakerSurname(quote.speaker);
  let inSpan = false;
  for (const para of paragraphs(sourceText)) {
    for (const span of para.spans) {
      if (!wordsForMatch(span.inner).includes(target)) continue;
      inSpan = true;
      if (speakerNear(para, span, surname)) return { ok: true };
    }
  }
  if (inSpan) return { ok: false, reason: `orateur « ${surname} » non nommé à côté de la citation` };
  return wordsForMatch(sourceText).includes(target)
    ? { ok: false, reason: 'paraphrase : le passage existe dans la source, mais hors guillemets' }
    : { ok: false, reason: 'citation introuvable mot pour mot dans la source' };
}
