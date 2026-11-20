import { redirect } from 'next/navigation';
import { currentUser } from '@/lib/auth';
import { getDataSource } from '@/lib/data';
import { longDateFr, parisTime } from '@/lib/dates';
import { runView } from '@/lib/runs';

/**
 * Santé : derniers passages de la routine (table `runs`), étape par étape. Réservée à l'utilisateur
 * autorisé : le proxy renvoie déjà les autres vers /login, la page le revérifie (défense en profondeur),
 * et la RLS ne leur montrerait de toute façon aucun passage.
 */
export default async function SantePage() {
  if (!(await currentUser())) redirect('/login');
  const now = new Date();
  const runs = (await (await getDataSource()).runs(14)).map((r) => runView(r, now));
  return (
    <>
      <div className="page-head">
        <div className="kicker mono">
          <span className="acc">Santé</span>
          <i />
          {runs.length} passages
        </div>
        <h1>Les derniers passages</h1>
        <p>Une ligne restée « en cours » plus de 6 h est un passage interrompu : la publication n’a pas eu lieu.</p>
      </div>
      {runs.length === 0 ? (
        <p className="empty mono">Aucun passage enregistré.</p>
      ) : (
        <ol className="runs">
          {runs.map((r) => (
            <li className="run" key={r.date} data-status={r.status}>
              <header>
                <b>{longDateFr(r.date)}</b>
                <span className={`st mono ${r.status}`}>{r.label}</span>
              </header>
              <table>
                <tbody>
                  {r.steps.map((s) => (
                    <tr key={s.name}>
                      <td>{s.name}</td>
                      <td>
                        {s.status}
                        {s.finishedAt ? ` · ${parisTime(s.finishedAt)}` : ''}
                        {s.durationMs !== null ? ` · ${Math.round(s.durationMs / 1000)} s` : ''}
                      </td>
                      <td>
                        {s.counters.map(([k, v]) => `${k} ${v}`).join(' · ')}
                        {s.errors.length > 0 && <span className="mono"> — {s.errors.join(' ; ')}</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="mono">
                Mise à jour {parisTime(r.updatedAt)}
                {r.closedThreads ? ` · ${r.closedThreads} Thread(s) fermé(s)` : ''}
                {r.light.length ? ` · allégée : ${r.light.join(', ').toUpperCase()}` : ''}
                {r.notes ? ` · ${r.notes}` : ''}
              </p>
            </li>
          ))}
        </ol>
      )}
      <form className="signout" action="/auth/signout" method="post">
        <button type="submit" className="mono">
          Se déconnecter
        </button>
      </form>
    </>
  );
}
