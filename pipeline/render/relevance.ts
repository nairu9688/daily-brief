import type { Lang } from '@daily-brief/schema';
import { findPlaces, matchPlaces, normalizeText, type Place } from '../lib/places';

/**
 * Pertinence d'une photo Wikimedia Commons pour la requête d'un sujet (R11). Le moteur de Commons classe
 * par texte intégral, description comprise : le 20/11/2026, « television studio cameras debate » a donné,
 * pour un débat Sánchez–Feijóo, des pancartes de campagne à Des Moines (Iowa) dont la description parlait
 * d'un débat télévisé. Une photo hors sujet ou située ailleurs trompe le lecteur : mieux vaut aucune photo.
 */

/** Mots vides anglais, espagnols et français (la requête est en anglais, mais le modèle mêle parfois les langues). */
const STOP = new Set(
  (
    'a an the of in on at to for from by with and or near over under into about its his her their this that these those ' +
    'photo photograph image picture view de del la las el los lo un una unos unas y en con por para al sobre ' +
    'le les des du une et au aux dans sur pour par avec'
  ).split(' '),
);

/** Singulier approché (anglais, espagnol) : « cameras » → « camera », « studios » → « studio », « cities » → « city ». */
export function singular(t: string): string {
  if (t.length > 4 && t.endsWith('ies')) return `${t.slice(0, -3)}y`;
  if (t.length > 3 && t.endsWith('s') && !/(ss|us|is)$/.test(t)) return t.slice(0, -1);
  return t;
}

const tokenSet = (text: string): Set<string> => new Set(normalizeText(text).split(' ').filter(Boolean).map(singular));

export type QueryProfile = { terms: string[]; anchors: Place[] };

/** Mots significatifs de la requête (hors mots vides et noms de lieux) et lieux d'ancrage qu'elle nomme. */
export function queryProfile(query: string): QueryProfile {
  const matched = matchPlaces(query, { demonyms: true });
  // Les mots des noms de lieu ne comptent pas comme mots du sujet : « new » de « new york » non plus.
  let rest = ` ${normalizeText(query)} `;
  for (const { name } of matched) rest = rest.split(` ${name} `).join(' ');
  const terms = [...new Set(rest.split(' ').filter((w) => w.length >= 3 && !STOP.has(w) && !/^\d+$/.test(w)).map(singular))];
  return { terms, anchors: matched.map((m) => m.place) };
}

/** Pays attendus quand la requête ne nomme aucun lieu : périmètre de l'édition (R2). FR (« France · Monde ») : aucun. */
const IMPLICIT: Record<Lang, string[]> = { es: ['ES'], en: ['US', 'GB'], fr: [] };

/** Catégories de maintenance de Commons : elles ne disent rien du sujet (« Files with coordinates missing… »). */
const MAINTENANCE = /^(files?\b|flickr|self-published|uploaded|photographs taken on|taken with|cc-|license|pd-|gfdl|artworks|media\b|pages\b|images\b|.*\bsdc\b|.*flickrevie)/i;
/** Personne identifiable : jamais de photo de personnalité (R11). */
const PERSON = /\b(portraits?|politicians?|headshots?|selfies?|people of|men of|women of|members of)\b/;
/** Schéma, carte, logo : pas une photo du sujet (et une carte se fait avec `type: map`). */
const NOT_A_PHOTO = new Set(['diagram', 'chart', 'graph', 'logo', 'map', 'infographic', 'scheme', 'localizacion', 'plano']);
/** Vues neutres, préférées. */
const NEUTRAL = new Set(['building', 'palace', 'parliament', 'congress', 'flag', 'skyline', 'cityscape', 'facade', 'exterior', 'panorama', 'street', 'square', 'monument', 'headquarter', 'landscape', 'aerial']);
/** Scènes d'un événement précis, trompeuses hors de leur contexte. */
const EVENT = new Set(['rally', 'campaign', 'protest', 'protester', 'demonstration', 'demonstrator', 'supporter', 'sign', 'placard', 'march', 'riot', 'crowd']);

/** Page de résultat de l'API (formatversion 2), réduite à ce que lit le contrôle. */
export type CandidatePage = {
  title?: string;
  imageinfo: { extmetadata: Partial<Record<'ObjectName' | 'Categories' | 'ImageDescription', { value?: unknown }>> }[];
};

const text = (v: { value?: unknown } | undefined): string => (typeof v?.value === 'string' ? v.value : '');
const stripHtml = (html: string): string =>
  html
    .replace(/<[^>]*>/g, ' ')
    .replace(/&(?:#\d+|#x[0-9a-f]+|[a-z]+);/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();

export type Verdict = { ok: true; score: number } | { ok: false; reason: string };

/**
 * Juge une photo candidate. Dans l'ordre :
 * 1. personne identifiable (catégories « Politicians », « Portraits »…) : refusée ;
 * 2. chaque lieu de la requête doit être nommé par la photo (titre, catégories ou description ; un pays
 *    est satisfait par l'une de ses villes ou régions) ;
 * 3. géographie : les pays attendus sont ceux de la requête, sinon celui de l'édition (ES : Espagne ;
 *    EN : États-Unis, Royaume-Uni ; FR : aucun). Un autre lieu dans le titre ou les catégories : refusée ;
 *    dans la description, refusée sauf si la photo nomme aussi un pays attendu ;
 * 4. pertinence : au moins un mot de la requête (ou un lieu d'ancrage) dans le titre ou les catégories,
 *    et au moins la moitié des mots de la requête, description comprise.
 * Le score classe les photos retenues : mots dans le titre ou les catégories (×3), dans la description (×1),
 * lieux d'ancrage dans le titre ou les catégories (×2), vue neutre (+1), scène d'événement (−2).
 */
export function assessCandidate(page: CandidatePage, profile: QueryProfile, lang: Lang): Verdict {
  const m = page.imageinfo[0]?.extmetadata ?? {};
  const title = (page.title ?? '').replace(/^File:/i, '').replace(/\.[a-z0-9]{2,5}$/i, '');
  const categories = text(m.Categories)
    .split('|')
    .filter((c) => c.trim() && !MAINTENANCE.test(c.trim()));
  const strong = [title, stripHtml(text(m.ObjectName)), ...categories].join(' | ');
  const weak = stripHtml(text(m.ImageDescription));
  const strongNorm = normalizeText(strong);

  if (PERSON.test(strongNorm)) return { ok: false, reason: 'personne identifiable (titre ou catégories)' };
  if (looksLikeNamedPerson(title, categories)) return { ok: false, reason: 'personne identifiable (catégorie à son nom)' };

  const strongPlaces = findPlaces(strong, { demonyms: true });
  const weakPlaces = findPlaces(weak, { demonyms: false });
  const all = [...strongPlaces, ...weakPlaces];
  const satisfies = (a: Place, h: Place) => h.country === a.country && (h.id === a.id || a.kind === 'country');
  const missing = profile.anchors.find((a) => !all.some((h) => satisfies(a, h)));
  if (missing) return { ok: false, reason: `lieu de la requête absent de la photo : ${missing.id}` };

  const expected = new Set(profile.anchors.length ? profile.anchors.map((a) => a.country) : IMPLICIT[lang]);
  const foreignStrong = strongPlaces.find((p) => !expected.has(p.country));
  if (foreignStrong) return { ok: false, reason: `lieu hors du pays attendu dans le titre ou les catégories : ${foreignStrong.id}` };
  const foreignWeak = weakPlaces.find((p) => !expected.has(p.country));
  if (foreignWeak && !all.some((p) => expected.has(p.country))) return { ok: false, reason: `lieu hors du pays attendu dans la description : ${foreignWeak.id}` };

  const strongTokens = tokenSet(strong);
  const weakTokens = tokenSet(weak);
  const notPhoto = [...strongTokens].find((t) => NOT_A_PHOTO.has(t));
  if (notPhoto) return { ok: false, reason: `schéma, carte ou logo plutôt qu'une photo (${notPhoto})` };
  const strongHits = profile.terms.filter((t) => strongTokens.has(t)).length;
  const weakHits = profile.terms.filter((t) => !strongTokens.has(t) && weakTokens.has(t)).length;
  const anchorsStrong = profile.anchors.filter((a) => strongPlaces.some((h) => satisfies(a, h))).length;
  if (profile.terms.length > 0) {
    if (strongHits === 0 && anchorsStrong === 0) return { ok: false, reason: 'aucun mot de la requête dans le titre ni les catégories' };
    if (strongHits + weakHits < Math.ceil(profile.terms.length / 2)) return { ok: false, reason: `trop peu de mots de la requête (${strongHits + weakHits}/${profile.terms.length})` };
  }
  const neutral = [...strongTokens].some((t) => NEUTRAL.has(t)) ? 1 : 0;
  const event = [...strongTokens].some((t) => EVENT.has(t)) ? 2 : 0;
  return { ok: true, score: 3 * strongHits + weakHits + 2 * anchorsStrong + neutral - event };
}

/**
 * Titre qui est aussi le nom d'une catégorie et qui a la forme d'un nom de personne (deux à quatre mots
 * capitalisés, sans chiffre ni mot en minuscules ni lieu) : « Paloma Gázquez », catégorie « Paloma Gázquez ».
 * Un monument au nom propre (« Eiffel Tower ») est refusé aussi : faux positif accepté, R11 d'abord.
 */
function looksLikeNamedPerson(title: string, categories: string[]): boolean {
  const t = title.trim();
  if (!categories.some((c) => c.trim().toLowerCase() === t.toLowerCase())) return false;
  const words = t.split(/\s+/);
  return words.length >= 2 && words.length <= 4 && words.every((w) => /^\p{Lu}[\p{L}'’.-]*$/u.test(w)) && findPlaces(t, { demonyms: true }).length === 0;
}
