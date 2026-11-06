import type { Stat } from '@daily-brief/schema';
import { normalizeForMatch } from './normalize';
import type { CheckResult } from './quotes';

const NUMBER = /\d+(?:[\s.,']\d+)*/g;
const SEP = "[\\s.,']?";
const GAP = '[\\s-]*';

const UNIT_ALIASES: Record<string, string> = {
  '%': '(?:%|pour ?cent|per ?cent|por ?ciento)',
  md: '(?:mds?|milliards?|mrds?|bn|billions?|mil millones)',
  mds: '(?:mds?|milliards?|mrds?|bn|billions?|mil millones)',
  bn: '(?:bn|billions?|milliards?|mds?|mil millones)',
  m: '(?:m\\b|mètres?|metros?|meters?|metres?|millions?|millones|mn|mio)',
  k: '(?:k\\b|000|mille|thousand|mil\\b)',
};

const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function unitPattern(unit: string): string {
  const key = unit.toLowerCase();
  return UNIT_ALIASES[key] ?? escapeRegex(key.slice(0, 3));
}

/**
 * Motifs de recherche d'une valeur de chiffre clé (R6) : un motif par nombre,
 * tolérant aux séparateurs (espace, espace fine, point, virgule) et suivi de son unité éventuelle.
 * Renvoie null si la valeur ne contient aucun chiffre.
 */
export function statPatterns(value: string): RegExp[] | null {
  const v = value.normalize('NFKC');
  const patterns: RegExp[] = [];
  for (const m of v.matchAll(NUMBER)) {
    const groups = m[0].split(/[\s.,']/);
    let p = '(?<!\\d)' + groups.join(SEP) + '(?!\\d)';
    const rest = v.slice(m.index! + m[0].length);
    const unit = rest.match(/^[\s-]*(%|[A-Za-zÀ-ÖØ-öø-ÿ]+)/);
    if (unit) p += GAP + unitPattern(unit[1]);
    patterns.push(new RegExp(p, 'iu'));
  }
  return patterns.length ? patterns : null;
}

/** R6 : la valeur figure dans le texte de sa source, aux variantes de format près. */
export function checkStat(stat: Pick<Stat, 'value'>, sourceText: string | undefined): CheckResult {
  if (!sourceText) return { ok: false, reason: 'texte source indisponible' };
  const text = sourceText.normalize('NFKC');
  const patterns = statPatterns(stat.value);
  if (!patterns) {
    return normalizeForMatch(text).includes(normalizeForMatch(stat.value))
      ? { ok: true }
      : { ok: false, reason: `« ${stat.value} » absent de la source` };
  }
  const missing = patterns.find((re) => !re.test(text));
  return missing ? { ok: false, reason: `« ${stat.value} » absent de la source` } : { ok: true };
}
