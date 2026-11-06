import type { Divergence } from '@daily-brief/schema';
import { normalizeForMatch } from './normalize';
import type { CheckResult } from './quotes';

/** Mots qui ne changent pas le périmètre d'une mesure : ordres de grandeur, jours et mois (FR, EN, ES). */
const NEUTRAL = new Set(
  (
    'million millions milliard milliards millón millones mil billion billions bn md mds m k ' +
    'de del of the le la les el los ' +
    'lun mar mer jeu ven sam dim lundi mardi mercredi jeudi vendredi samedi dimanche ' +
    'janv janvier févr février fév mars avr avril mai juin juil juillet août sept septembre oct octobre nov novembre déc décembre ' +
    'mon tue wed thu fri sat sun monday tuesday wednesday thursday friday saturday sunday ' +
    'jan january feb february march apr april may june jul july aug august sep september october november dec december ' +
    'mié jue vie sáb lunes martes miércoles jueves viernes sábado domingo ' +
    'ene enero febrero marzo abr abril mayo junio julio ago agosto septiembre octubre noviembre dic diciembre'
  ).split(' '),
);

const hasDigit = (s: string) => /\d/.test(s);

/** Ce qui reste d'une valeur une fois retirés les nombres et les mots neutres : son « périmètre ». */
export function scopeWords(value: string): string {
  return value
    .normalize('NFKC')
    .toLowerCase()
    .replace(/\d+/g, ' ')
    .split(/[^\p{L}]+/u)
    .filter((w) => w && !NEUTRAL.has(w))
    .join(' ');
}

/** R7 : même mesure, même périmètre, deux sources distinctes, deux valeurs différentes. */
export function checkDivergence(d: Divergence): CheckResult {
  if (normalizeForMatch(d.a.by) === normalizeForMatch(d.b.by)) return { ok: false, reason: 'même source des deux côtés' };
  if (normalizeForMatch(d.a.value) === normalizeForMatch(d.b.value)) return { ok: false, reason: 'valeurs identiques' };
  if (hasDigit(d.a.value) !== hasDigit(d.b.value)) return { ok: false, reason: 'valeurs non comparables' };
  const sa = scopeWords(d.a.value);
  const sb = scopeWords(d.b.value);
  if (sa !== sb) return { ok: false, reason: `périmètres différents (« ${sa} » / « ${sb} »)` };
  return { ok: true };
}
