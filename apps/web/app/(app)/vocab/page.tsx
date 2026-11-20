import Link from 'next/link';
import { VocabCard } from '@/components/VocabCard';
import { currentUser } from '@/lib/auth';
import { getDataSource } from '@/lib/data';
import { isIsoDate, shortDate } from '@/lib/dates';
import { isLang } from '@/lib/edition-choice';

type Search = { langue?: string; date?: string; coche?: string };

const href = (s: Search) => {
  const q = new URLSearchParams(Object.entries(s).filter((e): e is [string, string] => typeof e[1] === 'string' && e[1] !== ''));
  return q.size ? `/vocab?${q}` : '/vocab';
};

/**
 * Tous les mots, avec filtres langue, date et coché (paramètres d'URL, validés). Page publique : le
 * filtre « Coché » et les cases ne s'affichent que pour l'utilisateur autorisé connecté.
 */
export default async function VocabPage({ searchParams }: { searchParams: Promise<Search> }) {
  const sp = await searchParams;
  const editable = (await currentUser()) !== null;
  const lang = isLang(sp.langue) && sp.langue !== 'fr' ? sp.langue : undefined;
  const date = sp.date && isIsoDate(sp.date) ? sp.date : undefined;
  const coche = editable && (sp.coche === 'oui' || sp.coche === 'non') ? sp.coche : undefined;
  const all = await (await getDataSource()).vocab({ lang, selected: coche === undefined ? undefined : coche === 'oui' });
  const dates = [...new Set(all.map((w) => w.date))].slice(0, 14);
  const words = date ? all.filter((w) => w.date === date) : all;
  const cur = { langue: lang, date, coche };
  const chip = (label: string, next: Search, on: boolean) => (
    <Link href={href(next)} aria-current={on ? 'true' : undefined} key={label}>
      {label}
    </Link>
  );
  return (
    <>
      <div className="page-head">
        <div className="kicker mono">
          <span className="acc">Vocab</span>
          <i />
          {words.length} mots
        </div>
        <h1>Tous les mots</h1>
      </div>
      <nav className="filters" aria-label="Langue">
        {chip('Toutes', { ...cur, langue: undefined }, !lang)}
        {chip('EN', { ...cur, langue: 'en' }, lang === 'en')}
        {chip('ES', { ...cur, langue: 'es' }, lang === 'es')}
      </nav>
      {editable && (
        <nav className="filters" aria-label="Coché">
          {chip('Tous', { ...cur, coche: undefined }, !coche)}
          {chip('Cochés', { ...cur, coche: 'oui' }, coche === 'oui')}
          {chip('Non cochés', { ...cur, coche: 'non' }, coche === 'non')}
        </nav>
      )}
      <nav className="filters" aria-label="Date">
        {chip('Toutes dates', { ...cur, date: undefined }, !date)}
        {dates.map((d) => chip(shortDate(d, 'fr'), { ...cur, date: d }, date === d))}
      </nav>
      {words.length === 0 ? (
        <p className="empty mono">Aucun mot pour ces filtres.</p>
      ) : (
        <div className="rub">
          <VocabCard
            key={href(cur)}
            kicker="Vocabulaire"
            title={lang ? lang.toUpperCase() : 'EN · ES'}
            words={words.map((w) => ({ ...w, meta: `${shortDate(w.date, 'fr')} · ${w.lang.toUpperCase()}` }))}
            editable={editable}
          />
        </div>
      )}
    </>
  );
}
