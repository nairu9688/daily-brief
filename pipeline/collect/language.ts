import type { RawArticle } from '@daily-brief/schema';

/**
 * Mots-outils propres à chaque langue des éditions. Les mots communs à deux langues (la, de, en, que,
 * un, se, on…) sont exclus : chaque occurrence ne vote que pour une langue.
 */
const STOPWORDS: Record<'fr' | 'en' | 'es', ReadonlySet<string>> = {
  fr: new Set(['le', 'les', 'des', 'du', 'et', 'est', 'dans', 'pour', 'qui', 'sur', 'au', 'aux', 'avec', 'pas', 'ce', 'cette', 'sont', 'il', 'elle', 'une', 'ont', 'été', 'ses', 'leur', 'mais', 'qu', 'l', 'd']),
  en: new Set(['the', 'and', 'of', 'to', 'is', 'that', 'for', 'with', 'was', 'are', 'by', 'from', 'it', 'this', 'be', 'have', 'has', 'at', 'which', 'were', 'will', 'an', 'its', 'their', 'said']),
  es: new Set(['el', 'los', 'las', 'del', 'y', 'por', 'con', 'para', 'una', 'es', 'su', 'al', 'lo', 'como', 'más', 'pero', 'sus', 'fue', 'han', 'ha', 'sobre', 'este', 'esta', 'entre', 'según']),
};

type Lang = keyof typeof STOPWORDS;
/** Au moins MIN_HITS mots-outils reconnus, et la langue gagnante en compte au moins RATIO fois plus que la suivante. */
const MIN_HITS = 8;
const RATIO = 2;
/** Le début du texte suffit et borne le coût. */
const MAX_CHARS = 3000;

/** Langue (fr, en, es) d'un texte, par comptage de mots-outils ; undefined si le texte est trop court ou ambigu. */
export function detectLang(text: string): Lang | undefined {
  const counts: Record<Lang, number> = { fr: 0, en: 0, es: 0 };
  for (const word of text.slice(0, MAX_CHARS).toLowerCase().split(/[^\p{L}]+/u)) {
    for (const lang of Object.keys(STOPWORDS) as Lang[]) if (STOPWORDS[lang].has(word)) counts[lang]++;
  }
  const [first, second] = (Object.entries(counts) as [Lang, number][]).sort((a, b) => b[1] - a[1]);
  return first[1] >= MIN_HITS && first[1] >= RATIO * second[1] ? first[0] : undefined;
}

/**
 * Écarte les articles dont le texte (ou, sans texte, le titre et le chapô) est nettement dans une autre
 * langue que celle annoncée : un média espagnol qui publie aussi en anglais (democrata.es/en/…) ne doit
 * pas entrer dans l'édition ES. Une langue incertaine, ou hors FR/EN/ES, garde l'article.
 */
export function dropWrongLanguage(articles: RawArticle[]): { kept: RawArticle[]; dropped: RawArticle[] } {
  const kept: RawArticle[] = [];
  const dropped: RawArticle[] = [];
  for (const a of articles) {
    const detected = a.lang in STOPWORDS ? detectLang([a.title, a.description ?? '', a.text ?? ''].join('\n')) : undefined;
    (detected !== undefined && detected !== a.lang ? dropped : kept).push(a);
  }
  return { kept, dropped };
}
