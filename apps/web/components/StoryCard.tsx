import Link from 'next/link';
import { isHttpsUrlOn, LICENSE_HOST, PHOTO_PAGE_HOST, type Lang, type SourceRef } from '@daily-brief/schema';
import { photoSrc } from '@/lib/data/rows';
import type { StoryView } from '@/lib/data/types';
import { favColor, initials, QUOTE_MARKS, T, uniqueOutlets } from '@/lib/i18n';
import { Cap, Chev, Split, Spark, ThreadIcon } from './icons';
import { MapSvg } from './MapSvg';
import { SourcesToggle } from './SourcesToggle';

/** Pastille d'un média (initiales sur sa couleur). */
export function Fav({ outlet, small }: { outlet: string; small?: boolean }) {
  return (
    <span className={small ? 'fav sm' : 'fav'} style={{ background: favColor(outlet) }} aria-hidden="true">
      {initials(outlet)}
    </span>
  );
}

function Visual({ story }: { story: StoryView }) {
  const v = story.visual;
  if (v.type === 'map') {
    return (
      <div className="media">
        <MapSvg spec={v.map} label={v.caption} />
        <span className="cap mono">{v.caption}</span>
      </div>
    );
  }
  const p = v.photo;
  const src = photoSrc(p?.src);
  // Crédit exigé par la licence : auteur (vers la page du fichier), licence (vers son texte), source. Sans image, rien à créditer.
  const page = p && isHttpsUrlOn(p.pageUrl, [PHOTO_PAGE_HOST]) ? p.pageUrl : null;
  const license = p?.licenseUrl && isHttpsUrlOn(p.licenseUrl, [LICENSE_HOST]) ? p.licenseUrl : null;
  const link = (href: string, text: string) => (
    <a href={href} target="_blank" rel="noopener noreferrer">
      {text}
    </a>
  );
  return (
    <div className="photo">
      {src ? <img src={src} alt="" loading="lazy" decoding="async" referrerPolicy="no-referrer" /> : <div className="ph" style={{ background: 'linear-gradient(165deg,var(--surface-2) 0%,var(--line-2) 100%)' }} />}
      {p && src ? (
        <span className="credit mono">
          Photo : {page ? link(page, p.author) : p.author} — {license ? link(license, p.license) : p.license} · Wikimedia Commons
        </span>
      ) : null}
      <span className="cap mono">Photo libre · « {v.query} »</span>
    </div>
  );
}

/** Première source lue en entier (bouton « Lire »), sinon la première. */
export const primarySource = (sources: SourceRef[]) => sources.find((s) => s.readFull) ?? sources[0];

/**
 * Carte d'un sujet (spec §8.2), dans l'ordre : visuel, kicker et date, titre, « Résumé IA », résumé,
 * chiffres, citation, divergences, Thread, lien prépa, sources. Un élément absent ne laisse pas de trou.
 * Tous les textes passent par JSX (échappés par React).
 */
export function StoryCard({ story, lang }: { story: StoryView; lang: Lang }) {
  const t = T[lang];
  const [open, close] = QUOTE_MARKS[lang];
  const outlets = uniqueOutlets(story.sources);
  const primary = primarySource(story.sources);
  return (
    <article className="card" data-story={story.id}>
      <Visual story={story} />
      <div className="body">
        <div className="kicker mono">
          <span className="acc">{story.kicker}</span>
          <i />
          {story.date}
        </div>
        <h3>{story.title}</h3>
        <div className="ai mono">
          <Spark />
          {t.ai}
        </div>
        <p className="sum">{story.summary}</p>
        {story.stats.length > 0 && (
          <div className="stats">
            {story.stats.map((s, i) => (
              <div className="stat" key={i}>
                <b>{s.value}</b>
                <span>{s.label}</span>
              </div>
            ))}
          </div>
        )}
        {story.quote && (
          <blockquote className="quote">
            <p>
              {open}
              {story.quote.text}
              {close}
            </p>
            {story.quote.translation && (
              <p className="tr">
                <span className="mono">{t.translation}</span> {story.quote.translation}
              </p>
            )}
            <cite className="mono">{story.quote.speaker}</cite>
          </blockquote>
        )}
        {story.divergences.length > 0 && (
          <div className="diverge">
            <div className="dh mono">
              <Split />
              {t.diverge}
            </div>
            {story.divergences.map((d, i) => (
              <div className="drow" key={i}>
                <span className="dk">{d.metric}</span>
                <div className="dv">
                  <b>{d.a.value}</b>
                  <small className="mono">{d.a.by}</small>
                </div>
                <div className="dv">
                  <b>{d.b.value}</b>
                  <small className="mono">{d.b.by}</small>
                </div>
              </div>
            ))}
          </div>
        )}
        {story.thread && (
          <Link className="thread" href={`/threads/${story.thread.id}`}>
            <ThreadIcon />
            <div>
              <b className="mono">Thread</b>
              <span>
                {story.thread.title} {story.thread.subtitle && <em>· {story.thread.subtitle}</em>}
              </span>
            </div>
            <Chev />
          </Link>
        )}
        {story.prepa && (
          <div className="prepa">
            <Cap />
            <div>
              <b className="mono">
                {t.prepa} · {story.prepa.subject}
              </b>
              <p>{story.prepa.text}</p>
            </div>
          </div>
        )}
        <SourcesToggle
          stack={
            <div className="stack">
              <div className="favs">
                {outlets.slice(0, 4).map((o) => (
                  <Fav key={o} outlet={o} />
                ))}
              </div>
              <small>
                {outlets.slice(0, 2).join(', ')}
                {outlets.length > 2 ? ` +${outlets.length - 2}` : ''}
              </small>
            </div>
          }
          count={story.sources.length}
          sourcesLabel={t.sources}
          readLabel={t.read}
          readUrl={primary.url}
        >
          {story.sources.map((s, i) => (
            <a key={i} target="_blank" rel="noopener noreferrer" href={s.url}>
              <Fav outlet={s.outlet} small />
              <span className="mt">
                <b className="mono">{s.outlet}</b>
                {s.title}
              </span>
              <span className={s.readFull ? 'rd mono on' : 'rd mono'}>{s.readFull ? t.full : t.title}</span>
            </a>
          ))}
        </SourcesToggle>
      </div>
    </article>
  );
}
