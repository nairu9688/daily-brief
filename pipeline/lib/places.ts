/**
 * Petit répertoire de lieux pour juger la pertinence d'une photo Wikimedia Commons (R11) :
 * pays (noms anglais, espagnols, français), États américains, régions et grandes villes,
 * chacun rattaché à son pays (ISO 3166 alpha-2). Volontairement court et sans ambiguïté :
 * les noms qui sont aussi des mots courants ou d'autres lieux sont exclus (georgia, nevada
 * — Sierra Nevada —, colorado, montana — « montaña » sans accent —, jordan, chad, turkey…).
 * Noms en minuscules, sans accents, mots séparés par une espace.
 */

export type PlaceKind = 'country' | 'region' | 'city';
/** `id` : nom canonique ; `demonym` : adjectif (« spanish »), compté seulement dans les titres et catégories. */
export type Place = { id: string; country: string; kind: PlaceKind; demonym?: boolean };

type Entry = { country: string; names: string[]; demonyms?: string[] };

const COUNTRIES: Entry[] = [
  { country: 'ES', names: ['spain', 'espana', 'espagne', 'reino de espana'], demonyms: ['spanish', 'espanol', 'espanola', 'espagnol', 'espagnole'] },
  { country: 'FR', names: ['france', 'francia'], demonyms: ['french', 'francais', 'francaise', 'frances', 'francesa'] },
  { country: 'GB', names: ['united kingdom', 'uk', 'great britain', 'britain', 'reino unido', 'royaume uni', 'england', 'scotland', 'wales', 'northern ireland'], demonyms: ['british', 'britanico', 'britannique', 'scottish', 'welsh'] },
  { country: 'US', names: ['united states', 'united states of america', 'usa', 'estados unidos', 'etats unis'], demonyms: ['american', 'estadounidense', 'americain', 'americaine'] },
  { country: 'DE', names: ['germany', 'alemania', 'allemagne', 'deutschland'], demonyms: ['german', 'aleman', 'alemana', 'allemand', 'allemande'] },
  { country: 'IT', names: ['italy', 'italia', 'italie'], demonyms: ['italian', 'italiano', 'italiana', 'italien', 'italienne'] },
  { country: 'PT', names: ['portugal'], demonyms: ['portuguese', 'portugues', 'portuguesa', 'portugais', 'portugaise'] },
  { country: 'BE', names: ['belgium', 'belgica', 'belgique'], demonyms: ['belgian', 'belga', 'belge'] },
  { country: 'NL', names: ['netherlands', 'holland', 'paises bajos', 'pays bas'], demonyms: ['dutch', 'neerlandais', 'neerlandes'] },
  { country: 'CH', names: ['switzerland', 'suiza', 'suisse'], demonyms: ['swiss', 'suizo'] },
  { country: 'AT', names: ['austria', 'autriche'], demonyms: ['austrian', 'austriaco', 'autrichien'] },
  { country: 'IE', names: ['ireland', 'irlanda', 'irlande', 'eire'], demonyms: ['irish', 'irlandes', 'irlandais'] },
  { country: 'PL', names: ['poland', 'polonia', 'pologne'], demonyms: ['polish', 'polaco', 'polonais'] },
  { country: 'UA', names: ['ukraine', 'ucrania'], demonyms: ['ukrainian', 'ucraniano', 'ukrainien'] },
  { country: 'RU', names: ['russia', 'rusia', 'russie'], demonyms: ['russian', 'ruso', 'rusa', 'russe'] },
  { country: 'CN', names: ['china', 'chine'], demonyms: ['chinese', 'chino', 'chinois'] },
  { country: 'JP', names: ['japan', 'japon'], demonyms: ['japanese', 'japones', 'japonais'] },
  { country: 'IN', names: ['india', 'inde'] },
  { country: 'BR', names: ['brazil', 'brasil', 'bresil'], demonyms: ['brazilian', 'brasileno', 'bresilien'] },
  { country: 'AR', names: ['argentina', 'argentine'], demonyms: ['argentinian', 'argentino'] },
  { country: 'MX', names: ['mexico', 'mexique'], demonyms: ['mexican', 'mexicano', 'mexicain'] },
  { country: 'CA', names: ['canada'], demonyms: ['canadian', 'canadiense', 'canadien'] },
  { country: 'AU', names: ['australia', 'australie'], demonyms: ['australian', 'australiano', 'australien'] },
  { country: 'IL', names: ['israel'], demonyms: ['israeli', 'israeli', 'israelien'] },
  { country: 'PS', names: ['palestine', 'palestina', 'gaza', 'gaza strip', 'west bank', 'cisjordania', 'cisjordanie'], demonyms: ['palestinian', 'palestino', 'palestinien'] },
  { country: 'IR', names: ['iran'], demonyms: ['iranian', 'irani', 'iranien'] },
  { country: 'IQ', names: ['iraq', 'irak'], demonyms: ['iraqi', 'irakien'] },
  { country: 'SY', names: ['syria', 'siria', 'syrie'], demonyms: ['syrian', 'sirio', 'syrien'] },
  { country: 'LB', names: ['lebanon', 'libano', 'liban'], demonyms: ['lebanese', 'libanes', 'libanais'] },
  { country: 'TR', names: ['turkiye', 'turquia', 'turquie'], demonyms: ['turkish', 'turco', 'turc'] },
  { country: 'EG', names: ['egypt', 'egipto', 'egypte'], demonyms: ['egyptian', 'egipcio', 'egyptien'] },
  { country: 'MA', names: ['morocco', 'marruecos', 'maroc'], demonyms: ['moroccan', 'marroqui', 'marocain'] },
  { country: 'DZ', names: ['algeria', 'argelia', 'algerie'], demonyms: ['algerian', 'argelino', 'algerien'] },
  { country: 'TN', names: ['tunisia', 'tunez', 'tunisie'] },
  { country: 'VE', names: ['venezuela'], demonyms: ['venezuelan', 'venezolano'] },
  { country: 'CO', names: ['colombia', 'colombie'], demonyms: ['colombian', 'colombiano', 'colombien'] },
  { country: 'CL', names: ['chile', 'chili'], demonyms: ['chilean', 'chileno', 'chilien'] },
  { country: 'PE', names: ['peru', 'perou'], demonyms: ['peruvian', 'peruano', 'peruvien'] },
  { country: 'CU', names: ['cuba'], demonyms: ['cuban', 'cubano', 'cubain'] },
  { country: 'GR', names: ['greece', 'grecia', 'grece'], demonyms: ['greek', 'griego', 'grec', 'grecque'] },
  { country: 'SE', names: ['sweden', 'suecia', 'suede'], demonyms: ['swedish', 'sueco', 'suedois'] },
  { country: 'NO', names: ['norway', 'noruega', 'norvege'], demonyms: ['norwegian', 'noruego', 'norvegien'] },
  { country: 'DK', names: ['denmark', 'dinamarca', 'danemark'], demonyms: ['danish', 'danes', 'danois'] },
  { country: 'FI', names: ['finland', 'finlandia', 'finlande'], demonyms: ['finnish', 'finlandes', 'finlandais'] },
  { country: 'HU', names: ['hungary', 'hungria', 'hongrie'], demonyms: ['hungarian', 'hungaro', 'hongrois'] },
  { country: 'RO', names: ['romania', 'rumania', 'roumanie'], demonyms: ['romanian', 'rumano', 'roumain'] },
  { country: 'CZ', names: ['czech republic', 'czechia', 'chequia', 'republica checa', 'tchequie'], demonyms: ['czech', 'checo', 'tcheque'] },
  { country: 'KR', names: ['south korea', 'corea del sur', 'coree du sud'] },
  { country: 'KP', names: ['north korea', 'corea del norte', 'coree du nord'] },
  { country: 'ZA', names: ['south africa', 'sudafrica', 'afrique du sud'] },
  { country: 'NG', names: ['nigeria'], demonyms: ['nigerian'] },
  { country: 'SA', names: ['saudi arabia', 'arabia saudi', 'arabia saudita', 'arabie saoudite'], demonyms: ['saudi'] },
  { country: 'AF', names: ['afghanistan', 'afganistan'], demonyms: ['afghan', 'afgano'] },
  { country: 'VN', names: ['vietnam', 'viet nam'], demonyms: ['vietnamese', 'vietnamita', 'vietnamien'] },
];

/** États américains (sans georgia, nevada, colorado, montana ni maine — aussi une région française — : ambigus). */
const US_STATES = [
  'alabama', 'alaska', 'arizona', 'arkansas', 'california', 'connecticut', 'delaware', 'florida', 'hawaii', 'idaho',
  'illinois', 'indiana', 'iowa', 'kansas', 'kentucky', 'louisiana', 'maryland', 'massachusetts', 'michigan',
  'minnesota', 'mississippi', 'missouri', 'nebraska', 'new hampshire', 'new jersey', 'new mexico', 'new york',
  'north carolina', 'north dakota', 'ohio', 'oklahoma', 'oregon', 'pennsylvania', 'rhode island', 'south carolina',
  'south dakota', 'tennessee', 'texas', 'utah', 'vermont', 'virginia', 'west virginia', 'washington', 'wisconsin', 'wyoming',
];

const REGIONS: Entry[] = [
  { country: 'ES', names: ['catalonia', 'cataluna', 'catalunya', 'catalogne', 'andalusia', 'andalucia', 'andalousie', 'basque country', 'pais vasco', 'euskadi', 'pays basque', 'galicia', 'canary islands', 'canarias', 'balearic islands', 'baleares', 'asturias', 'extremadura', 'aragon', 'castilla y leon', 'castilla la mancha', 'comunidad valenciana', 'navarra', 'cantabria', 'murcia'] },
  { country: 'FR', names: ['brittany', 'bretagne', 'normandy', 'normandie', 'corsica', 'corse', 'occitanie', 'provence', 'ile de france'] },
  { country: 'US', names: US_STATES },
];

const CITIES: Entry[] = [
  { country: 'ES', names: ['madrid', 'barcelona', 'barcelone', 'seville', 'sevilla', 'valencia', 'bilbao', 'malaga', 'zaragoza', 'saragosse', 'palma de mallorca', 'las palmas', 'alicante', 'san sebastian', 'donostia', 'valladolid', 'pamplona', 'salamanca', 'cadiz', 'vigo', 'oviedo', 'santander'] },
  { country: 'FR', names: ['paris', 'marseille', 'marsella', 'lyon', 'toulouse', 'lille', 'bordeaux', 'strasbourg', 'nantes', 'rennes', 'montpellier'] },
  { country: 'GB', names: ['london', 'londres', 'manchester', 'liverpool', 'edinburgh', 'glasgow', 'cardiff', 'belfast', 'westminster'] },
  { country: 'US', names: ['washington dc', 'los angeles', 'chicago', 'san francisco', 'boston', 'des moines', 'miami', 'houston', 'philadelphia', 'seattle', 'detroit', 'atlanta', 'new orleans', 'manhattan', 'brooklyn'] },
  { country: 'DE', names: ['berlin', 'munich', 'munchen', 'hamburg', 'frankfurt', 'cologne'] },
  { country: 'IT', names: ['rome', 'roma', 'milan', 'milano', 'naples', 'napoli', 'venice', 'venezia', 'florence', 'firenze'] },
  { country: 'PT', names: ['lisbon', 'lisboa', 'lisbonne'] },
  { country: 'BE', names: ['brussels', 'bruselas', 'bruxelles'] },
  { country: 'NL', names: ['amsterdam', 'rotterdam', 'the hague'] },
  { country: 'RU', names: ['moscow', 'moscu', 'moscou', 'saint petersburg'] },
  { country: 'UA', names: ['kyiv', 'kiev', 'kharkiv', 'odesa', 'odessa'] },
  { country: 'CN', names: ['beijing', 'pekin', 'shanghai', 'hong kong'] },
  { country: 'JP', names: ['tokyo', 'osaka'] },
  { country: 'IL', names: ['jerusalem', 'tel aviv'] },
  { country: 'MX', names: ['mexico city', 'ciudad de mexico'] },
  { country: 'AR', names: ['buenos aires'] },
];

/** Tous les noms, du plus long au plus court (en mots) : « new mexico » est trouvé avant « mexico ». */
const NAMES: { name: string; place: Place }[] = [
  ...COUNTRIES.flatMap((e) => [
    ...e.names.map((n) => ({ name: n, place: { id: e.names[0], country: e.country, kind: 'country' as const } })),
    ...(e.demonyms ?? []).map((n) => ({ name: n, place: { id: e.names[0], country: e.country, kind: 'country' as const, demonym: true } })),
  ]),
  ...REGIONS.flatMap((e) => e.names.map((n) => ({ name: n, place: { id: n, country: e.country, kind: 'region' as const } }))),
  ...CITIES.flatMap((e) => e.names.map((n) => ({ name: n, place: { id: n, country: e.country, kind: 'city' as const } }))),
].sort((a, b) => b.name.split(' ').length - a.name.split(' ').length || b.name.length - a.name.length);

/** Texte réduit à ses mots : minuscules, sans accents ni ponctuation, séparés par une espace. */
export function normalizeText(text: string): string {
  return text
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean)
    .join(' ');
}

/**
 * Lieux cités dans un texte, chacun une fois, avec le nom trouvé. Un nom trouvé est retiré du texte avant les noms
 * plus courts (« new mexico » ne compte pas aussi pour le Mexique). `demonyms` : compter aussi les adjectifs (« spanish »).
 */
export function matchPlaces(text: string, opts: { demonyms: boolean }): { name: string; place: Place }[] {
  let t = ` ${normalizeText(text)} `;
  const found = new Map<string, { name: string; place: Place }>();
  for (const { name, place } of NAMES) {
    if (place.demonym && !opts.demonyms) continue;
    const needle = ` ${name} `;
    if (!t.includes(needle)) continue;
    t = t.split(needle).join(' | ');
    const key = `${place.country}:${place.id}`;
    const prev = found.get(key);
    if (!prev || prev.place.demonym) found.set(key, { name, place });
  }
  return [...found.values()];
}

/** Lieux cités dans un texte (voir matchPlaces). */
export function findPlaces(text: string, opts: { demonyms: boolean }): Place[] {
  return matchPlaces(text, opts).map((m) => m.place);
}
