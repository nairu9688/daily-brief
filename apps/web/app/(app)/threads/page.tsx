import Link from 'next/link';
import { getDataSource } from '@/lib/data';
import { shortDate } from '@/lib/dates';

/** Liste des Threads : suivis d'abord, puis ouverts, puis fermés. */
export default async function ThreadsPage() {
  const ds = await getDataSource();
  const rank = (t: { followed: boolean; status: string }) => (t.followed ? 0 : t.status === 'open' ? 1 : 2);
  const threads = (await ds.threads()).sort((a, b) => rank(a) - rank(b) || ((b.lastDate ?? '') > (a.lastDate ?? '') ? 1 : -1));
  return (
    <>
      <div className="page-head">
        <div className="kicker mono">
          <span className="acc">Threads</span>
          <i />
          {threads.length}
        </div>
        <h1>Les histoires suivies</h1>
      </div>
      {threads.length === 0 ? (
        <p className="empty mono">Aucun Thread pour l’instant.</p>
      ) : (
        <ul className="list">
          {threads.map((t) => (
            <li key={t.id} data-ed={t.lang}>
              <Link className="item" href={`/threads/${t.id}`}>
                <b>{t.title}</b>
                {t.lastTitle && <span>{t.lastTitle}</span>}
                <small className="mono">
                  {t.lang.toUpperCase()} · {t.eventCount} épisode{t.eventCount > 1 ? 's' : ''}
                  {t.lastDate ? ` · ${shortDate(t.lastDate, 'fr')}` : ''}
                  {t.followed ? ' · suivi' : ''}
                  {t.status === 'closed' ? ' · fermé' : ''}
                </small>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
