import Link from 'next/link';
import { notFound } from 'next/navigation';
import { z } from 'zod';
import { FollowButton } from '@/components/FollowButton';
import { MapSvg } from '@/components/MapSvg';
import { getDataSource } from '@/lib/data';
import { shortDate } from '@/lib/dates';
import { CHIP_LABELS, T } from '@/lib/i18n';

const LATEST = { fr: 'Dernier épisode', en: 'Latest', es: 'Último' } as const;

/**
 * Frise d'un Thread (maquette, écran 2) : retour au Brief, titre (h1), description du Thread, « Suivre ce
 * thread », puis les épisodes du plus récent au plus ancien, chacun avec son texte ; l'épisode du jour
 * porte « Aujourd'hui », sinon le plus récent porte « Dernier épisode ». `lang` : langue du Thread.
 */
export default async function ThreadPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const ds = await getDataSource();
  const thread = await ds.thread(id);
  if (!thread) notFound();
  const today = ds.today();
  const t = T[thread.lang];
  const rubric = thread.events.find((e) => e.rubric)?.rubric;
  return (
    <div data-ed={thread.lang} lang={thread.lang}>
      <div className="th-head">
        <Link className="back mono" href="/">
          ← BRIEF
        </Link>
        <div className="kicker mono" style={{ marginTop: 14 }}>
          <span className="acc">Thread</span>
          {rubric && (
            <>
              <i />
              {CHIP_LABELS[thread.lang][rubric]}
            </>
          )}
          <i />
          {t.episodes(thread.eventCount)}
        </div>
        <h1>{thread.title}</h1>
        {thread.description && <p>{thread.description}</p>}
        <FollowButton id={thread.id} followed={thread.followed} followLabel={t.follow} followingLabel={t.following} />
      </div>
      <ol className="timeline">
        {thread.events.map((e, i) => (
          <li key={`${e.date}-${i}`} className={i === 0 ? 'now' : undefined}>
            <span className="d mono">
              {shortDate(e.date, thread.lang)}
              {i === 0 ? ` · ${e.date === today ? t.today : LATEST[thread.lang]}` : ''}
            </span>
            <h4>{e.title}</h4>
            {e.text && <p>{e.text}</p>}
            {i === 0 && e.map && (
              <div className="mini">
                <MapSvg spec={e.map.spec} label={e.map.caption} />
              </div>
            )}
            {e.source && (
              <a className="s mono" href={e.source.url} target="_blank" rel="noopener noreferrer">
                {e.source.outlet} ↗
              </a>
            )}
          </li>
        ))}
      </ol>
    </div>
  );
}
