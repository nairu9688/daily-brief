'use client';
import { useState } from 'react';
import { setThreadFollowed } from '@/app/actions';
import { Bell } from './icons';

/** « Suivre ce thread » : écrit threads.followed (colonne ouverte par la RLS). */
export function FollowButton({ id, followed, followLabel, followingLabel }: { id: string; followed: boolean; followLabel: string; followingLabel: string }) {
  const [on, setOn] = useState(followed);
  const [error, setError] = useState<string | null>(null);
  async function toggle() {
    const next = !on;
    setOn(next);
    setError(null);
    let failure: string | null;
    try {
      const r = await setThreadFollowed({ id, followed: next });
      failure = r.ok ? null : r.error;
    } catch {
      failure = 'Enregistrement impossible, réessaie.';
    }
    if (failure !== null) {
      setOn(!next);
      setError(failure);
    }
  }
  return (
    <>
      <button type="button" className="follow" aria-pressed={on} onClick={toggle}>
        <Bell />
        {on ? followingLabel : followLabel}
      </button>
      {error && (
        <p className="anki-msg mono" role="alert">
          {error}
        </p>
      )}
    </>
  );
}
