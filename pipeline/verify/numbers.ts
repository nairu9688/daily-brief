import type { Stat } from '@daily-brief/schema';
import { normalizeForMatch } from './normalize';
import type { CheckResult } from './result';

const NUMBER = /\d+(?:[\s.,']\d+)*/g;
const SEP = "[\\s.,']?";
const GAP = '[\\s-]*';

// Limites connues : « m » couvre à la fois mètres et millions, le signe (+/−) est ignoré,
// et les petits nombres ou les années peuvent correspondre n'importe où dans la source.
// « 1,500 m » est lu comme des milliers ; une citation peut couper une négation (relu à la main, côté éditorial).
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

const CURRENCIES: Record<string, string> = {
  '€': '(?:€|euros?(?![\\p{L}]))',
  $: '(?:\\$|dollars?(?![\\p{L}])|USD)',
  '£': '(?:£|pounds?(?![\\p{L}])|livres? sterling|libras?(?![\\p{L}]))',
};

/**
 * Motifs de recherche d'une valeur de chiffre clé (R6) : pour chaque nombre, une liste d'alternatives
 * (au moins une doit correspondre). Les séparateurs de milliers (groupe de 3 chiffres) sont tolérés,
 * pas les décimales ; le nombre ne doit pas être collé à d'autres chiffres ; l'unité et la devise éventuelles
 * doivent suivre. Renvoie null si la valeur ne contient aucun chiffre.
 */
export function statPatterns(value: string): RegExp[][] | null {
  const v = value.normalize('NFKC');
  const currencies = Object.keys(CURRENCIES).filter((c) => v.includes(c));
  const patterns: RegExp[][] = [];
  for (const m of v.matchAll(NUMBER)) {
    const groups = m[0].split(/[\s.,']/);
    const num = groups.map((g, i) => (i === 0 ? g : (g.length === 3 ? SEP : '[.,]') + g)).join('');
    let base = "(?<!\\d[\\s.,']?)" + num + "(?![.,]\\d|[\\s']?\\d)";
    const rest = v.slice(m.index! + m[0].length);
    const unit = rest.match(/^[\s-]*(%|[A-Za-zÀ-ÖØ-öø-ÿ]+)/);
    if (unit) base += GAP + unitPattern(unit[1]);
    if (currencies.length === 0) {
      patterns.push([new RegExp(base, 'iu')]);
      continue;
    }
    const cur = '(?:' + currencies.map((c) => CURRENCIES[c]).join('|') + ')';
    patterns.push([new RegExp(base + '[^\\d€$£\\n]{0,30}?' + cur + '(?!\\s?\\d)', 'iu'), new RegExp(cur + '\\s?' + base, 'iu')]);
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
  const missing = patterns.find((alts) => !alts.some((re) => re.test(text)));
  return missing ? { ok: false, reason: `« ${stat.value} » absent de la source` } : { ok: true };
}
