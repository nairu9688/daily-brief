import { loadMarkets } from '@/lib/markets';
import { direction, formatChange, formatPrice, type Quote } from '@/lib/markets/parse';

const parisClock = (iso: string) => new Intl.DateTimeFormat('fr-FR', { timeZone: 'Europe/Paris', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(iso));
const parisDay = (iso: string) => new Intl.DateTimeFormat('fr-FR', { timeZone: 'Europe/Paris', day: '2-digit', month: '2-digit' }).format(new Date(iso));

/** Heure d'un cours : « 10:13 », ou « 19/11 22:15 » s'il date d'un autre jour que le plus récent. */
function when(iso: string, latest: string): string {
  return parisDay(iso) === parisDay(latest) ? parisClock(iso) : `${parisDay(iso)} ${parisClock(iso)}`;
}

/**
 * Bloc « Marchés » : 6 à 9 instruments, dernier cours et variation du jour (hausse, baisse), cours
 * différés avec leur heure. Téléphone : bandeau horizontal sous le Morning Brief ; grand écran : tableau
 * dans la colonne de droite. Libellés en français dans toutes les éditions (comme le Vocab).
 */
export function MarketsView({ quotes }: { quotes: Quote[] }) {
  const latest = quotes.reduce((a, q) => (q.time > a ? q.time : a), quotes[0].time);
  return (
    <section className="mkts" aria-labelledby="mkts-h" lang="fr">
      <div className="mk-head">
        <h2 id="mkts-h">Marchés</h2>
        <span className="mono">
          Différé · <time dateTime={latest}>{parisClock(latest)}</time>
        </span>
      </div>
      <ul>
        {quotes.map((q) => (
          <li key={q.symbol} data-symbol={q.symbol} title={`${q.label} : cours de ${when(q.time, latest)} (heure de Paris)`}>
            <span className="mk-n">{q.label}</span>
            <span className="mk-v mono">{formatPrice(q)}</span>
            <span className="mk-c mono" data-dir={direction(q.change)}>
              {formatChange(q.change)}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Serveur : lit les cours (cache de 10 minutes) ; source en panne → rien, sans message. */
export async function MarketsWidget() {
  const quotes = await loadMarkets();
  return quotes ? <MarketsView quotes={quotes} /> : null;
}
