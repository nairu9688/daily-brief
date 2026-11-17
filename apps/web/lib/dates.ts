/** Dates civiles (AAAA-MM-JJ) et heures de Paris. Aucune date civile ne passe par le fuseau du serveur. */

export const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Vrai pour une date civile valide (« 2026-02-30 » est refusée). */
export function isIsoDate(s: string): boolean {
  if (!ISO_DATE.test(s)) return false;
  const d = new Date(`${s}T12:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

/** Date du jour à Paris. */
export function parisToday(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

/** Heure de Paris d'un horodatage ISO (« 05:41 »). */
export function parisTime(iso: string): string {
  return new Intl.DateTimeFormat('fr-FR', { timeZone: 'Europe/Paris', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(iso));
}

const civil = (iso: string) => new Date(`${iso}T12:00:00Z`);
const fmt = (locale: string, opts: Intl.DateTimeFormatOptions) => (iso: string) => new Intl.DateTimeFormat(locale, { ...opts, timeZone: 'UTC' }).format(civil(iso));

/** En-tête de l'appli : « VEN 06.11.26 ». */
export function headerDate(iso: string): string {
  const day = fmt('fr-FR', { weekday: 'short' })(iso).replace('.', '').slice(0, 3).toUpperCase();
  const [y, m, d] = iso.split('-');
  return `${day} ${d}.${m}.${y.slice(2)}`;
}

/** Date courte d'une ligne de frise ou de vocabulaire : « Ven 6 nov. », « Thu 5 Nov », « Mar 3 nov ». */
export function shortDate(iso: string, lang: 'fr' | 'en' | 'es'): string {
  const locale = { fr: 'fr-FR', en: 'en-GB', es: 'es-ES' }[lang];
  const s = fmt(locale, { weekday: 'short', day: 'numeric', month: 'short' })(iso).replace(/,/g, '');
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Date longue en français : « vendredi 6 novembre 2026 ». */
export const longDateFr = fmt('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

/** Mois en français : « novembre 2026 ». */
export const monthFr = (yyyyMm: string) => fmt('fr-FR', { month: 'long', year: 'numeric' })(`${yyyyMm}-01`);

/** Décale une date civile de `days` jours. */
export function addDays(iso: string, days: number): string {
  const d = civil(iso);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
