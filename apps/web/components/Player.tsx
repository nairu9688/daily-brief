'use client';
import { useEffect, useRef, useState } from 'react';
import { Pause, Play } from './icons';

const BARS = 46;
/** Hauteurs des barres, déterministes (même formule que design/app.js). */
export const BAR_HEIGHTS = Array.from({ length: BARS }, (_, i) => 6 + Math.round(Math.abs(Math.sin(i * 1.7) * 14 + Math.sin(i * 0.6) * 6)));

export function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '–:––';
  const s = Math.round(seconds);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/**
 * Lecteur du Morning Brief. `src` est une route de l'appli (/audio/<date>/<langue>) qui redirige vers
 * une URL signée de courte durée : l'URL du bucket n'apparaît jamais dans la page. La durée vient des
 * métadonnées du fichier (`loadedmetadata`), comme le demande le lot 5.
 */
export function Player({ src, lang, listenLabel, pauseLabel }: { src: string; lang: string; listenLabel: string; pauseLabel: string }) {
  const audio = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [duration, setDuration] = useState<number | null>(null);
  const [time, setTime] = useState(0);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const a = audio.current;
    if (a && a.readyState >= 1 && Number.isFinite(a.duration)) setDuration(a.duration);
  }, []);

  const toggle = async () => {
    const a = audio.current;
    if (!a) return;
    if (failed) {
      // Nouvel essai : la route /audio redonne une URL signée neuve, puis la durée revient par loadedmetadata.
      setFailed(false);
      a.load();
      return;
    }
    if (playing) {
      a.pause();
      return;
    }
    try {
      await a.play();
    } catch {
      setFailed(true);
    }
  };

  const progress = duration ? Math.round((time / duration) * BARS) : 0;
  return (
    <div className={playing ? 'player playing' : 'player'} data-lang={lang} data-failed={failed || undefined}>
      <audio
        ref={audio}
        src={src}
        preload="metadata"
        onLoadedMetadata={(e) => setDuration(e.currentTarget.duration)}
        onTimeUpdate={(e) => setTime(e.currentTarget.currentTime)}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => setPlaying(false)}
        onError={() => setFailed(true)}
      />
      <button type="button" className="play" aria-label={playing ? pauseLabel : listenLabel} onClick={toggle}>
        {playing ? <Pause /> : <Play />}
      </button>
      <div className="wave" aria-hidden="true">
        {BAR_HEIGHTS.map((h, i) => (
          <i key={i} className={i < progress ? 'on' : undefined} style={{ height: `${h}px`, animationDelay: `${(i % 7) * 0.08}s` }} />
        ))}
      </div>
      <div className="ptime mono">
        {failed ? '–:––' : formatTime(duration ?? NaN)}
        <br />
        <span>CHIRP HD</span>
      </div>
    </div>
  );
}
