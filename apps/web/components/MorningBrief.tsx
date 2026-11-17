import type { EditionView } from '@/lib/data/types';
import { T } from '@/lib/i18n';
import { Player } from './Player';

/** Morning Brief : titre du jour, lecteur (s'il y a un MP3) et cinq infos. Pas de lecteur, pas de message. */
export function MorningBrief({ edition }: { edition: EditionView }) {
  const t = T[edition.lang];
  return (
    <div className="mb">
      <div className="kicker mono">
        <span className="acc">Morning Brief</span>
        <i />
        {edition.morningBrief.length} {t.infos}
        <i />
        10 min
      </div>
      <h1>{edition.headline}</h1>
      {edition.hasAudio && <Player src={`/audio/${edition.date}/${edition.lang}`} lang={edition.lang} listenLabel={t.listen} pauseLabel={t.pause} />}
      <ol className="points">
        {edition.morningBrief.map((m, i) => (
          <li key={i}>
            <span className="n mono">{String(i + 1).padStart(2, '0')}</span>
            <p>
              <b>{m.lead}</b> {m.text}
              <span className="tag mono">{m.rubric}</span>
            </p>
          </li>
        ))}
      </ol>
    </div>
  );
}
