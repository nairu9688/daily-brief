'use client';
import { useState } from 'react';
import { queueAnki, setVocabSelected } from '@/app/actions';
import type { AnkiStatus } from '@/lib/data/types';

export type VocabCardWord = { id: string; term: string; pos: string; translation: string; example: string; ankiStatus: AnkiStatus; selected: boolean; meta?: string };

const plural = (n: number) => (n > 1 ? 's' : '');

/**
 * Mots à cocher, « Tout cocher » et « Ajouter N mots à Anki ». Chaque case écrit `selected` par une
 * action serveur ; le bouton Anki passe `anki_status` à `queued` (phase 1 : simple mise en file).
 * En cas d'échec, la case revient à son état et un message s'affiche.
 */
export function VocabCard({ kicker, title, words }: { kicker: string; title: string; words: VocabCardWord[] }) {
  const [checked, setChecked] = useState(() => new Set(words.filter((w) => w.selected).map((w) => w.id)));
  const [status, setStatus] = useState(() => new Map(words.map((w) => [w.id, w.ankiStatus])));
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);
  const [busy, setBusy] = useState(false);

  const toQueue = words.filter((w) => checked.has(w.id) && status.get(w.id) === 'none').map((w) => w.id);
  const allChecked = words.length > 0 && words.every((w) => checked.has(w.id));

  async function select(ids: string[], selected: boolean) {
    const before = new Set(checked);
    const next = new Set(checked);
    for (const id of ids) {
      if (selected) next.add(id);
      else next.delete(id);
    }
    setChecked(next);
    const r = await setVocabSelected({ ids, selected });
    if (!r.ok) {
      setChecked(before);
      setMessage({ text: r.error, error: true });
    }
  }

  async function anki() {
    setBusy(true);
    const r = await queueAnki({ ids: toQueue });
    setBusy(false);
    if (!r.ok) {
      setMessage({ text: r.error, error: true });
      return;
    }
    setStatus(new Map([...status, ...toQueue.map((id) => [id, 'queued' as AnkiStatus] as const)]));
    setMessage({ text: `${r.count} mot${plural(r.count)} en file pour Anki ✓`, error: false });
  }

  return (
    <div className="vocab">
      <header>
        <div>
          <div className="kicker mono">
            <span className="acc">{kicker}</span>
          </div>
          <h3>{title}</h3>
        </div>
        <button type="button" className="selall mono" onClick={() => select(words.map((w) => w.id), !allChecked)}>
          {allChecked ? 'Tout décocher' : 'Tout cocher'}
        </button>
      </header>
      {words.map((w) => (
        <label className="vrow" key={w.id}>
          <input type="checkbox" className="vchk" checked={checked.has(w.id)} onChange={(e) => select([w.id], e.currentTarget.checked)} />
          <span className="box" />
          <span className="vt">
            <b>
              {w.term}
              <em>{w.pos}</em>
            </b>
            <span className="fr">{w.translation}</span>
            <p>{w.example}</p>
            {w.meta && <span className="vmeta mono">{w.meta}{status.get(w.id) !== 'none' ? ` · Anki : ${status.get(w.id)}` : ''}</span>}
          </span>
        </label>
      ))}
      <footer>
        <button type="button" className="anki" disabled={toQueue.length === 0 || busy} onClick={anki}>
          {toQueue.length ? `Ajouter ${toQueue.length} mot${plural(toQueue.length)} à Anki` : 'Ajouter à Anki'}
        </button>
        <span className="soon mono">Synchro Anki · phase 2</span>
      </footer>
      {message && (
        <p className="anki-msg mono" role={message.error ? 'alert' : 'status'}>
          {message.text}
        </p>
      )}
    </div>
  );
}
