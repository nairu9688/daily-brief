import { cookies } from 'next/headers';
import { EditionScreen } from '@/components/EditionScreen';
import { getDataSource } from '@/lib/data';
import { addDays } from '@/lib/dates';
import { chosenLang, EDITION_COOKIE } from '@/lib/edition-choice';

/**
 * Brief du jour. Sans édition du jour (pipeline pas encore passé, ou échec total : spec §12), la
 * dernière édition publiée s'affiche avec un bandeau : « brief de la veille » si elle date de la veille
 * (jour de Paris), « dernier brief » si elle est plus ancienne.
 */
export default async function BriefPage() {
  const lang = chosenLang((await cookies()).get(EDITION_COOKIE)?.value);
  const ds = await getDataSource();
  const today = ds.today();
  const date = await ds.latestDate(lang, today);
  const edition = date ? await ds.edition(date, lang) : null;
  if (!edition) {
    return (
      <div className="page-head">
        <div className="kicker mono">
          <span className="acc">Daily Brief</span>
        </div>
        <h1>Aucune édition publiée</h1>
        <p>Le premier brief apparaîtra ici après le passage de la routine.</p>
      </div>
    );
  }
  const stale = edition.date >= today ? undefined : edition.date === addDays(today, -1) ? 'yesterday' : 'latest';
  return <EditionScreen edition={edition} basePath="/" stale={stale} />;
}
