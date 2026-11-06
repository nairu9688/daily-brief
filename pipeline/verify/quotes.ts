import type { Quote } from '@daily-brief/schema';
import { normalizeForMatch } from './normalize';

export type CheckResult = { ok: true } | { ok: false; reason: string };

type Span = { start: number; end: number; inner: string };

const SPAN_PATTERNS = [/«([^«»]+)»/g, /“([^“”]+)”/g, /"([^"]+)"/g, /„([^„“”]+)[“”]/g];
const SPEAKER_WINDOW = 160;

/** Passages entre guillemets du texte source (« », “ ”, " ", „ “). */
export function quotedSpans(text: string): Span[] {
  const spans: Span[] = [];
  for (const re of SPAN_PATTERNS) {
    for (const m of text.matchAll(re)) spans.push({ start: m.index!, end: m.index! + m[0].length, inner: m[1] });
  }
  return spans;
}

/** Nom de famille de l'orateur : « Sophie Binet · CGT » → « Binet », « J.D. Vance » → « Vance ». */
export function speakerSurname(speaker: string): string {
  const name = speaker.split('·')[0].replace(/\(.*?\)/g, '').trim();
  const words = name.split(/\s+/).filter((w) => w.length >= 2);
  return words[words.length - 1] ?? name;
}

/** Le nom doit figurer dans le même paragraphe que la citation, à moins de 160 caractères. */
function speakerNear(text: string, span: Span, surname: string): boolean {
  const paraStart = text.lastIndexOf('\n', span.start) + 1;
  const nextBreak = text.indexOf('\n', span.end);
  const paraEnd = nextBreak === -1 ? text.length : nextBreak;
  const from = Math.max(paraStart, span.start - SPEAKER_WINDOW);
  const to = Math.min(paraEnd, span.end + SPEAKER_WINDOW);
  return normalizeForMatch(text.slice(from, to)).includes(normalizeForMatch(surname));
}

/** R5 : citation mot pour mot, entre guillemets dans la source, orateur nommé à côté. */
export function checkQuote(quote: Pick<Quote, 'text' | 'speaker'>, sourceText: string | undefined): CheckResult {
  if (!sourceText) return { ok: false, reason: 'texte source indisponible' };
  const target = normalizeForMatch(quote.text);
  const matching = quotedSpans(sourceText).filter((s) => normalizeForMatch(s.inner).includes(target));
  if (matching.length === 0) {
    return normalizeForMatch(sourceText).includes(target)
      ? { ok: false, reason: 'paraphrase : le passage existe dans la source, mais hors guillemets' }
      : { ok: false, reason: 'citation introuvable mot pour mot dans la source' };
  }
  const surname = speakerSurname(quote.speaker);
  if (!matching.some((s) => speakerNear(sourceText, s, surname))) {
    return { ok: false, reason: `orateur « ${surname} » non nommé à côté de la citation` };
  }
  return { ok: true };
}
