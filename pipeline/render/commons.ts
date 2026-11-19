import { z } from 'zod';
import { ccLicenseUrl, isFreeLicense, isHttpsUrlOn, LICENSE_HOST, MAX_AUTHOR_LENGTH, PhotoSchema, type Photo } from '@daily-brief/schema';
import { fetchJson } from '../collect/http';
import { WIKIMEDIA_USER_AGENT, type FetchLike } from './http';

export { WIKIMEDIA_USER_AGENT };
import { MAX_IMAGE_BYTES } from './images';

export const COMMONS_API = 'https://commons.wikimedia.org/w/api.php';
export const WIKIMEDIA_HEADERS = { 'User-Agent': WIKIMEDIA_USER_AGENT, 'Api-User-Agent': WIKIMEDIA_USER_AGENT } as const;
/** Réponse de 10 fichiers avec métadonnées filtrées : environ 20 Ko ; au-delà de 1 Mo, elle est refusée. */
export const MAX_COMMONS_BYTES = 1_000_000;
/**
 * Largeur demandée pour la vignette (carte de l'appli ; le PDF la réduit encore à 1000 px). Commons arrondit
 * la largeur demandée à une taille standard supérieure : 1600 donnait des fichiers de 1920 px (0,5 à 0,8 Mo,
 * constat du 19/11/2026). 1280 est une taille standard : le fichier fait la largeur annoncée.
 */
export const THUMB_WIDTH = 1280;

const ALLOWED_MIME = ['image/jpeg', 'image/png', 'image/webp'];
const MIN_WIDTH = 1000;
const MIN_RATIO = 1.2;
const MAX_RATIO = 2.2;

const Meta = z.object({ value: z.unknown() }).optional();
const PageSchema = z.object({
  index: z.number(),
  imageinfo: z
    .array(
      z.object({
        mime: z.string(),
        width: z.number(),
        height: z.number(),
        size: z.number(),
        url: z.string(),
        descriptionurl: z.string(),
        thumburl: z.string().optional(),
        thumbwidth: z.number().optional(),
        thumbheight: z.number().optional(),
        extmetadata: z.object({ Artist: Meta, LicenseShortName: Meta, LicenseUrl: Meta, Restrictions: Meta, NonFree: Meta }).partial(),
      }),
    )
    .min(1),
});
const ResponseSchema = z.object({
  error: z.object({ code: z.string() }).optional(),
  query: z.object({ pages: z.array(z.unknown()) }).optional(),
});

/** Paramètres de la recherche : fichiers (espace 6) matriciels, vignette de THUMB_WIDTH px, métadonnées utiles seulement. */
export function commonsSearchUrl(query: string): string {
  const params = new URLSearchParams({
    action: 'query',
    format: 'json',
    formatversion: '2',
    generator: 'search',
    gsrsearch: `${query.slice(0, 100)} filetype:bitmap`,
    gsrnamespace: '6',
    gsrlimit: '10',
    prop: 'imageinfo',
    iiprop: 'url|extmetadata|mime|size',
    iiurlwidth: String(THUMB_WIDTH),
    iiextmetadatafilter: 'Artist|LicenseShortName|LicenseUrl|License|Restrictions|NonFree|AttributionRequired',
    iiextmetadatalanguage: 'en',
  });
  return `${COMMONS_API}?${params}`;
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

/** Balise HTML, attributs entre guillemets compris (un `>` dans `title="a>b"` ne la ferme pas). */
const TAG = `<(?:"[^"]*"|'[^']*'|[^'">])*>`;
const BLOCK_TAG = new RegExp(`<\\/?(?:br|p|div|li|ul|ol|tr|td|th|table)\\b(?:"[^"]*"|'[^']*'|[^'">])*>`, 'gi');

/**
 * Auteur affichable à partir du champ `Artist` (HTML) : commentaires puis balises retirés (contenu des
 * scripts et styles compris, blocs remplacés par un espace), entités décodées, contrôles, demi-paires
 * isolées et espaces ramenés à un espace, borné à 80 unités UTF-16 sans couper un caractère.
 */
export function cleanAuthor(html: string): string {
  const text = html
    .replace(/<!--[\s\S]*?(?:-->|$)/g, '')
    .replace(new RegExp(`<(script|style)\\b(?:"[^"]*"|'[^']*'|[^'">])*>[\\s\\S]*?<\\/\\1\\s*>`, 'gi'), ' ')
    .replace(BLOCK_TAG, ' ')
    .replace(new RegExp(TAG, 'g'), '')
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
      if (e[0] !== '#') return ENTITIES[e.toLowerCase()] ?? m;
      const code = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return code > 0 && code <= 0x10ffff && (code < 0xd800 || code > 0xdfff) ? String.fromCodePoint(code) : ' ';
    })
    .replace(/[\p{Cc}\p{Cf}\p{Cs}\p{Zl}\p{Zp}]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (text.length <= MAX_AUTHOR_LENGTH) return text;
  const chars = Array.from(text);
  while (chars.join('').length > MAX_AUTHOR_LENGTH - 1) chars.pop();
  return `${chars.join('').trimEnd()}…`;
}

const str = (m: { value: unknown } | undefined): string => (typeof m?.value === 'string' ? m.value.trim() : '');

/** URL sans paramètres ni fragment (les `utm_*` ajoutés par l'API). */
const bare = (url: string): string => {
  try {
    const u = new URL(url);
    u.search = '';
    u.hash = '';
    return u.href;
  } catch {
    return url;
  }
};

/**
 * Lien de licence du crédit. CC BY et CC BY-SA : lien canonique dérivé du nom (jamais `LicenseUrl`),
 * null s'il ne peut pas l'être (la photo est alors écartée). CC0 et domaine public : `LicenseUrl` s'il
 * est sur creativecommons.org (`http` réécrit en `https`), sinon pas de lien.
 */
export function licenseLinkFor(license: string, apiUrl: string): string | undefined | null {
  if (/^(?:CC0(?: 1\.0)?|Public domain)$/i.test(license.trim())) {
    const url = apiUrl.trim().replace(/^http:\/\/creativecommons\.org\//i, 'https://creativecommons.org/');
    return isHttpsUrlOn(url, [LICENSE_HOST]) ? url : undefined;
  }
  return ccLicenseUrl(license) ?? null;
}

/** Photo d'une page de résultat si elle convient (format, cadrage, licence, auteur, hôtes), sinon null. */
function toPhoto(page: z.infer<typeof PageSchema>): Photo | null {
  const ii = page.imageinfo[0];
  const m = ii.extmetadata;
  if (!ALLOWED_MIME.includes(ii.mime)) return null;
  const ratio = ii.width / ii.height;
  if (ii.width < MIN_WIDTH || ratio < MIN_RATIO || ratio > MAX_RATIO) return null;
  const license = str(m.LicenseShortName);
  if (!isFreeLicense(license) || /^true$/i.test(str(m.NonFree))) return null;
  if (/personality/i.test(str(m.Restrictions))) return null;
  const author = cleanAuthor(str(m.Artist));
  if (!author) return null;
  // Une vignette plus petite que l'original n'existe que si l'original dépasse la largeur demandée :
  // sinon l'API renvoie l'original, qui doit alors tenir sous la limite de téléchargement.
  const scaled = ii.width > THUMB_WIDTH && ii.thumburl !== undefined && ii.thumbwidth !== undefined && ii.thumbheight !== undefined;
  if (!scaled && ii.size > MAX_IMAGE_BYTES) return null;
  const licenseUrl = licenseLinkFor(license, str(m.LicenseUrl));
  if (licenseUrl === null) return null;
  const photo = {
    provider: 'wikimedia' as const,
    src: bare(scaled ? ii.thumburl! : ii.url),
    width: scaled ? ii.thumbwidth! : ii.width,
    height: scaled ? ii.thumbheight! : ii.height,
    author,
    license,
    ...(licenseUrl ? { licenseUrl } : {}),
    pageUrl: ii.descriptionurl,
  };
  const parsed = PhotoSchema.safeParse(photo);
  return parsed.success ? parsed.data : null;
}

/**
 * Meilleure photo d'une réponse de recherche : dans l'ordre du moteur, le premier JPEG qui convient,
 * sinon le premier PNG ou WebP (une vignette PNG de photo dépasse vite 3 Mo). Null si aucune.
 */
export function pickPhoto(json: unknown): Photo | null {
  const pages = ResponseSchema.parse(json).query?.pages ?? [];
  const candidates = pages
    .flatMap((p) => {
      const parsed = PageSchema.safeParse(p);
      return parsed.success ? [parsed.data] : [];
    })
    .sort((a, b) => a.index - b.index)
    .flatMap((p) => {
      const photo = toPhoto(p);
      return photo ? [{ photo, jpeg: p.imageinfo[0].mime === 'image/jpeg' }] : [];
    });
  return (candidates.find((c) => c.jpeg) ?? candidates[0])?.photo ?? null;
}

/**
 * Cherche une photo libre sur Wikimedia Commons (R11 : la requête a déjà été validée par brief:verify).
 * L'URL d'image vient uniquement de la réponse de l'API. Renvoie null sans photo convenable ; lève
 * `HttpError` sur un statut en erreur, une erreur sur une réponse d'erreur de l'API, trop lourde ou hors délai.
 */
export async function findCommonsPhoto(query: string, opts: { fetch: FetchLike; timeoutMs?: number }): Promise<Photo | null> {
  const json = await fetchJson(opts.fetch, commonsSearchUrl(query), {
    headers: { ...WIKIMEDIA_HEADERS, Accept: 'application/json' },
    timeoutMs: opts.timeoutMs ?? 10_000,
    maxBytes: MAX_COMMONS_BYTES,
  });
  const err = ResponseSchema.parse(json).error;
  if (err) throw new Error(`Commons : ${err.code.slice(0, 40)}`);
  return pickPhoto(json);
}
