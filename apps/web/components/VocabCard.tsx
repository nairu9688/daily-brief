'use client';
import { useState } from 'react';
import { queueAnki, setVocabSelected } from '@/app/actions';
import type { AnkiStatus } from '@/lib/data/types';

/** `lang` : langue du mot et de l'exemple (la traduction est en français). */
export type VocabCardWord = { id: string; term: string; pos: string; translation: string; example: string; ankiStatus: AnkiStatus; selected: boolean; lang?: string; meta?: string };

const plural = (n: number) => (n > 1 ? 's' : '');

/** Message d'une action qui n'a pas abouti (réseau coupé, serveur injoignable) : le même que côté serveur. */
const FAILED = 'Enregistrement impossible, réessaie.';

/**
 * Mots à cocher, « Tout cocher » et « Ajouter N mots à Anki ». Chaque case écrit `selected` par une
 * action serveur ; le bouton Anki passe `anki_status` à `queued` (phase 1 : simple mise en file).
 * En cas d'échec, la case revient à son état et un message s'affiche.
 * `editable` faux (visiteur sans session, lecture publique) : les mots seuls, sans case, sans « Tout
 * cocher », sans pied Anki ni état Anki ; aucune action serveur n'est appelée.
 */
export function VocabCard({ kicker, title, titleLang, words, editable }: { kicker: string; title: string; titleLang?: string; words: VocabCardWord[]; editable: boolean }) {
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
    let error: string | null;
    try {
      const r = await setVocabSelected({ ids, selected });
      error = r.ok ? null : r.error;
    } catch {
      error = FAILED;
    }
    if (error !== null) {
      setChecked(before);
      setMessage({ text: error, error: true });
    }
  }

  async function anki() {
    const ids = toQueue;
    setBusy(true);
    try {
      const r = await queueAnki({ ids });
      if (!r.ok) {
        setMessage({ text: r.error, error: true });
        return;
      }
      setStatus(new Map([...status, ...ids.map((id) => [id, 'queued' as AnkiStatus] as const)]));
      setMessage({ text: `${r.count} mot${plural(r.count)} en file pour Anki ✓`, error: false });
    } catch {
      setMessage({ text: FAILED, error: true });
    } finally {
      setBusy(false);
    }
  }

  return (
    // Interface en français (maquette) ; le titre et chaque mot portent leur propre langue.
    <div className={editable ? 'vocab' : 'vocab ro'} lang="fr">
      <header>
        <div>
          <div className="kicker mono">
            <span className="acc">{kicker}</span>
          </div>
          <h3 lang={titleLang}>{title}</h3>
        </div>
        {editable && (
          <button type="button" className="selall mono" onClick={() => select(words.map((w) => w.id), !allChecked)}>
            {allChecked ? 'Tout décocher' : 'Tout cocher'}
          </button>
        )}
      </header>
      {words.map((w) => {
        const text = (
          <span className="vt">
            <b>
              {w.term}
              <em>{w.pos}</em>
            </b>
            <span className="fr" lang="fr">
              {w.translation}
            </span>
            <p>{w.example}</p>
            {w.meta && (
              <span className="vmeta mono" lang="fr">
                {w.meta}
                {editable && status.get(w.id) !== 'none' ? ` · Anki : ${status.get(w.id)}` : ''}
              </span>
            )}
          </span>
        );
        return editable ? (
          <label className="vrow" key={w.id} lang={w.lang}>
            <input type="checkbox" className="vchk" checked={checked.has(w.id)} onChange={(e) => select([w.id], e.currentTarget.checked)} />
            <span className="box" />
            {text}
          </label>
        ) : (
          <div className="vrow" key={w.id} lang={w.lang}>
            {text}
          </div>
        );
      })}
      {editable && (
        <footer>
          <button type="button" className="anki" disabled={toQueue.length === 0 || busy} onClick={anki}>
            {toQueue.length ? `Ajouter ${toQueue.length} mot${plural(toQueue.length)} à Anki` : 'Ajouter à Anki'}
          </button>
          <span className="soon mono">Synchro Anki · phase 2</span>
        </footer>
      )}
      {message && (
        <p className="anki-msg mono" role={message.error ? 'alert' : 'status'}>
          {message.text}
        </p>
      )}
    </div>
  );
}
