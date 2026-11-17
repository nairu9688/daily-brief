import type { Lang, SourceRef } from '@daily-brief/schema';
import { T } from '@/lib/i18n';
import { Ext } from './icons';
import { Fav } from './StoryCard';

/** « En bref » : titres et liens des brèves d'une rubrique. */
export function Briefs({ briefs, lang }: { briefs: SourceRef[]; lang: Lang }) {
  if (briefs.length === 0) return null;
  return (
    <div className="briefs">
      <div className="bh mono">{T[lang].briefs}</div>
      {briefs.map((b, i) => (
        <a className="brief" key={i} target="_blank" rel="noopener noreferrer" href={b.url}>
          <Fav outlet={b.outlet} small />
          <span className="bt">
            {b.title}
            <small className="mono">{b.outlet}</small>
          </span>
          <Ext />
        </a>
      ))}
    </div>
  );
}
