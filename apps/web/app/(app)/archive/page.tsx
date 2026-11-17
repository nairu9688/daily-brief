import Link from 'next/link';
import { getDataSource } from '@/lib/data';
import { monthFr } from '@/lib/dates';
import { monthBounds, monthGrid, parseMonth, shiftMonth } from '@/lib/calendar';

const DAYS = ['lun', 'mar', 'mer', 'jeu', 'ven', 'sam', 'dim'];

/** Archive : calendrier du mois vers les éditions passées (pointillés : édition allégée). */
export default async function ArchivePage({ searchParams }: { searchParams: Promise<{ m?: string }> }) {
  const ds = await getDataSource();
  const today = ds.today();
  const month = parseMonth((await searchParams).m) ?? today.slice(0, 7);
  const { first, last } = monthBounds(month);
  const days = new Map((await ds.days(first, last)).map((d) => [d.date, d]));
  return (
    <>
      <div className="page-head">
        <div className="kicker mono">
          <span className="acc">Archive</span>
          <i />
          {days.size} jour{days.size > 1 ? 's' : ''}
          <i />
          <Link href="/sante">Santé →</Link>
        </div>
        <h1>Les éditions passées</h1>
      </div>
      <div className="cal">
        <nav aria-label="Mois">
          <Link href={`/archive?m=${shiftMonth(month, -1)}`}>← préc.</Link>
          <b>{monthFr(month)}</b>
          <Link href={`/archive?m=${shiftMonth(month, 1)}`}>suiv. →</Link>
        </nav>
        <ol>
          {DAYS.map((d) => (
            <li className="h mono" key={d}>
              {d}
            </li>
          ))}
          {monthGrid(month).map((d, i) => {
            const day = d ? days.get(d) : undefined;
            return (
              <li key={d ?? `x${i}`}>
                {d && day ? (
                  <Link href={`/edition/${d}`} className={[day.light.length ? 'light' : '', d === today ? 'today' : ''].join(' ').trim() || undefined} aria-label={`Édition du ${d} (${day.langs.join(', ').toUpperCase()})`}>
                    {Number(d.slice(8))}
                  </Link>
                ) : (
                  d && Number(d.slice(8))
                )}
              </li>
            );
          })}
        </ol>
      </div>
    </>
  );
}
