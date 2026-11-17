/**
 * Découpage d'un `audioScript` en morceaux sous la limite d'une requête Text-to-Speech.
 *
 * La documentation de Google Cloud Text-to-Speech fixe 5 000 octets de texte par requête
 * `text:synthesize` (quotas et limites). On vise 4 500 octets UTF-8 (10 % de marge, consigne de
 * la feuille de route) : un accent compte deux octets, une espace insécable aussi.
 */

/** Limite documentée d'une requête (octets de texte). */
export const TTS_MAX_REQUEST_BYTES = 5000;
/** Taille maximale d'un morceau (octets UTF-8). */
export const MAX_CHUNK_BYTES = 4500;

export const utf8Bytes = (s: string): number => Buffer.byteLength(s, 'utf8');

/** Nombre de caractères facturés (points de code, espaces comprises). */
export const billedChars = (s: string): number => [...s].length;

/**
 * Texte normalisé : forme NFC, toute suite d'espaces (espaces insécables, fines, tabulations et
 * retours à la ligne compris) ramenée à une espace simple, sans espace en tête ni en fin.
 */
export function normalizeScript(text: string): string {
  return text.normalize('NFC').replace(/[\s   ⁠﻿]+/gu, ' ').trim();
}

/** Ponctuation isolée qui s'accroche au mot suivant : « ¿ ¡ ( [ “ ‘ et les guillemets droits. */
const OPENING = /^[«¿¡(\[“‘"']+$/u;
/** Ponctuation isolée qui s'accroche au mot précédent : » : ; ! ? , . … ) ] ” ’ et les tirets. */
const CLOSING = /^[»:;!?,.…)\]”’\-—–]+$/u;
/** Fin de phrase : . ! ? … éventuellement suivis de guillemets ou parenthèses fermants. */
const SENTENCE_END = /[.!?…]+[»”’"')\]]*$/u;
/** Fin de proposition : virgule, point-virgule, deux-points ou tiret. */
const CLAUSE_END = /(?:[,;:]|[—–])[»”’"')\]]*$/u;
/** Abréviations courantes (FR, EN, ES) qui ne terminent pas une phrase. */
const ABBREVIATIONS = new Set(['m.', 'mm.', 'mme.', 'mmes.', 'mlle.', 'dr.', 'pr.', 'st.', 'mr.', 'mrs.', 'ms.', 'sr.', 'sra.', 'srta.', 'dña.', 'd.', 'ee.', 'uu.', 'p.', 'ex.', 'cf.', 'vs.', 'no.', 'n.º', 'art.', 'av.', 'gen.', 'gov.', 'sen.', 'rep.']);

/** Mots du texte normalisé, la ponctuation isolée (« « », « ? », « — ») accrochée à son voisin. */
function words(text: string): string[] {
  const out: string[] = [];
  let pending = '';
  for (const raw of text.split(' ')) {
    if (raw === '') continue;
    if (OPENING.test(raw)) {
      pending += (pending ? ' ' : '') + raw;
      continue;
    }
    const w = pending ? `${pending} ${raw}` : raw;
    pending = '';
    if (CLOSING.test(raw) && out.length > 0) out[out.length - 1] += ` ${w}`;
    else out.push(w);
  }
  if (pending) {
    if (out.length > 0) out[out.length - 1] += ` ${pending}`;
    else out.push(pending);
  }
  return out;
}

/** Vrai si le mot clôt une phrase (et n'est ni une abréviation ni une initiale). */
function endsSentence(word: string): boolean {
  if (!SENTENCE_END.test(word)) return false;
  const last = word.split(' ').pop()!.toLowerCase();
  if (ABBREVIATIONS.has(last)) return false;
  return !/^\p{Lu}\.$/u.test(word.split(' ').pop()!); // initiale : « J. »
}

/** Regroupe les mots en segments, coupés après chaque mot qui vérifie `cut`. */
function group(ws: string[], cut: (w: string) => boolean): string[][] {
  const out: string[][] = [];
  let cur: string[] = [];
  for (const w of ws) {
    cur.push(w);
    if (cut(w)) {
      out.push(cur);
      cur = [];
    }
  }
  if (cur.length) out.push(cur);
  return out;
}

/** Unités à empaqueter : la phrase si elle tient, sinon ses propositions, sinon ses mots. */
function units(ws: string[], max: number): string[] {
  const out: string[] = [];
  for (const sentence of group(ws, endsSentence)) {
    const s = sentence.join(' ');
    if (utf8Bytes(s) <= max) {
      out.push(s);
      continue;
    }
    for (const clause of group(sentence, (w) => CLAUSE_END.test(w))) {
      const c = clause.join(' ');
      if (utf8Bytes(c) <= max) out.push(c);
      else
        for (const w of clause) {
          if (utf8Bytes(w) > max) throw new Error(`mot de ${utf8Bytes(w)} octets : impossible à découper sous ${max} octets`);
          out.push(w);
        }
    }
  }
  return out;
}

/**
 * Découpe le texte en morceaux d'au plus `maxBytes` octets UTF-8. Les phrases entières sont
 * regroupées tant qu'elles tiennent ; une phrase trop longue est coupée aux virgules,
 * points-virgules, deux-points ou tirets, puis entre les mots. Un mot n'est jamais coupé, et la
 * ponctuation isolée (« guillemets », ¿ ¡, ? !) reste avec son mot. Les morceaux recollés par une
 * espace redonnent exactement `normalizeScript(text)`.
 */
export function chunkScript(text: string, maxBytes = MAX_CHUNK_BYTES): string[] {
  if (maxBytes > TTS_MAX_REQUEST_BYTES) throw new Error(`limite de ${maxBytes} octets au-dessus de celle de l'API (${TTS_MAX_REQUEST_BYTES})`);
  const ws = words(normalizeScript(text));
  const chunks: string[] = [];
  let cur = '';
  for (const u of units(ws, maxBytes)) {
    const next = cur ? `${cur} ${u}` : u;
    if (utf8Bytes(next) <= maxBytes) cur = next;
    else {
      chunks.push(cur);
      cur = u;
    }
  }
  if (cur) chunks.push(cur);
  return chunks;
}
