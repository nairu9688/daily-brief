const TRACKING = /^(utm_.*|fbclid|gclid|mc_cid|mc_eid)$/;

/** Forme canonique d'une URL : sans fragment, sans `www.`, sans paramètres de suivi, sans `/` final. */
export function normalizeUrl(raw: string): string {
  const u = new URL(raw);
  u.hash = '';
  u.hostname = u.hostname.toLowerCase().replace(/^www\./, '');
  for (const k of [...u.searchParams.keys()]) if (TRACKING.test(k)) u.searchParams.delete(k);
  const s = u.toString();
  return s.endsWith('/') ? s.slice(0, -1) : s;
}

export function hostOf(raw: string): string {
  return new URL(raw).hostname.toLowerCase().replace(/^www\./, '');
}

/** Clé « média » d'une URL : domaine enregistrable (fr.euronews.com → euronews.com, news.bbc.co.uk → bbc.co.uk). */
export function outletKey(raw: string): string {
  const parts = hostOf(raw).split('.');
  const n = parts.length;
  const secondLevel = ['co', 'com', 'gob', 'gov', 'org', 'ac', 'net'];
  if (n >= 3 && parts[n - 1].length === 2 && secondLevel.includes(parts[n - 2])) return parts.slice(-3).join('.');
  return parts.slice(-2).join('.');
}
