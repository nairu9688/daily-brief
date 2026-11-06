const TRACKING = /^(utm_.*|fbclid|gclid|mc_cid|mc_eid|xtor|at_.*|ocid|cmpid)$/i;

/** Forme canonique d'une URL http(s) : sans fragment, sans `www.`, sans paramètres de suivi, requête triée, sans `/` final. Lève si l'URL est illisible ou non http(s). */
export function normalizeUrl(raw: string): string {
  const u = new URL(raw);
  if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new Error(`schéma non pris en charge : ${u.protocol}`);
  u.hash = '';
  u.hostname = u.hostname.toLowerCase().replace(/^www\./, '');
  if (u.pathname !== '/' && u.pathname.endsWith('/')) u.pathname = u.pathname.slice(0, -1);
  u.search = new URLSearchParams(
    [...u.searchParams].filter(([k]) => !TRACKING.test(k)).sort(([a], [b]) => a.localeCompare(b)),
  ).toString();
  return u.toString();
}

/** Comme normalizeUrl, mais renvoie null au lieu de lever. */
export function tryNormalizeUrl(raw: string): string | null {
  try {
    return normalizeUrl(raw);
  } catch {
    return null;
  }
}

export function hostOf(raw: string): string {
  return new URL(raw).hostname.toLowerCase().replace(/^www\./, '');
}

/** Clé « média » d'une URL : domaine enregistrable (fr.euronews.com → euronews.com, news.bbc.co.uk → bbc.co.uk). */
export function outletKey(raw: string): string {
  const parts = hostOf(raw).split('.');
  const n = parts.length;
  const secondLevel = ['co', 'com', 'gob', 'gouv', 'gov', 'org', 'ac', 'net'];
  if (n >= 3 && parts[n - 1].length === 2 && secondLevel.includes(parts[n - 2])) return parts.slice(-3).join('.');
  return parts.slice(-2).join('.');
}
