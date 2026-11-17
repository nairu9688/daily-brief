import Link from 'next/link';
import { notFound } from 'next/navigation';
import { z } from 'zod';
import { FollowButton } from '@/components/FollowButton';
import { MapSvg } from '@/components/MapSvg';
import { getDataSource } from '@/lib/data';
import { shortDate } from '@/lib/dates';
import { CHIP_LABELS, T } from '@/lib/i18n';

const LATEST = { fr: 'Dernier épisode', en: 'Latest', es: 'Último' } as const;

/** Frise d'un Thread (maquette, écran 2) : épisodes du plus récent au plus ancien, « Suivre ce thread ». */
export default async function ThreadPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const thread = await (await getDataSource()).thread(id);
  if (!thread) notFound();
  const t = T[thread.lang];
  const rubric = thread.events.find((e) => e.rubric)?.rubric;
  return (
    <div data-ed={thread.lang}>
      <div className="th-head">
        <Link className="back mono" href="/threads">
          ← THREADS
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
        <h2>{thread.title}</h2>
        {thread.events[0]?.text && <p>{thread.events[0].text}</p>}
        <FollowButton id={thread.id} followed={thread.followed} followLabel={t.follow} followingLabel={t.following} />
      </div>
      <ol className="timeline">
        {thread.events.map((e, i) => (
          <li key={`${e.date}-${i}`} className={i === 0 ? 'now' : undefined}>
            <span className="d mono">
              {shortDate(e.date, thread.lang)}
              {i === 0 ? ` · ${LATEST[thread.lang]}` : ''}
            </span>
            <h4>{e.title}</h4>
            {i > 0 && e.text && <p>{e.text}</p>}
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
