import { cookies } from 'next/headers';
import { Suspense } from 'react';
import { EditionScreen } from '@/components/EditionScreen';
import { MarketsWidget } from '@/components/Markets';
import { currentUser } from '@/lib/auth';
import { getDataSource } from '@/lib/data';
import { addDays } from '@/lib/dates';
import { chosenLang, EDITION_COOKIE } from '@/lib/edition-choice';

/**
 * Brief du jour. Sans édition du jour (pipeline pas encore passé, ou échec total : spec §12), la
 * dernière édition publiée s'affiche avec un bandeau : « brief de la veille » si elle date de la veille
 * (jour de Paris), « dernier brief » si elle est plus ancienne. Page publique : les cases du Vocab
 * et « Ajouter à Anki » ne s'affichent que pour l'utilisateur autorisé connecté. Le bloc « Marchés »
 * arrive en flux (Suspense) : une source lente ne retarde jamais le brief.
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
  const markets = (
    <Suspense fallback={null}>
      <MarketsWidget />
    </Suspense>
  );
  return <EditionScreen edition={edition} basePath="/" stale={stale} editable={(await currentUser()) !== null} markets={markets} />;
}
