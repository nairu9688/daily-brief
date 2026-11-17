'use client';
import { useState, type ReactNode } from 'react';
import type { RubricKey } from '@daily-brief/schema';

export type Chip = { key: RubricKey; label: string; present: boolean };

/**
 * Puces de rubriques : « Tout » ou une rubrique. Une rubrique absente de l'édition a sa puce grisée
 * (classe `dim`) et affiche le message vide. Le filtrage est fait en CSS (`.ed-filter[data-show]`) :
 * les rubriques restent rendues côté serveur.
 */
export function RubricFilter({ chips, allLabel, emptyLabel, children }: { chips: Chip[]; allLabel: string; emptyLabel: string; children: ReactNode }) {
  const [show, setShow] = useState<'all' | RubricKey>('all');
  const empty = show !== 'all' && !chips.find((c) => c.key === show)?.present;
  return (
    <>
      <div className="chips" role="toolbar" aria-label="Rubriques">
        <button type="button" className="chip" aria-pressed={show === 'all'} onClick={() => setShow('all')}>
          {allLabel}
        </button>
        {chips.map((c) => (
          <button type="button" key={c.key} className={c.present ? 'chip' : 'chip dim'} aria-pressed={show === c.key} onClick={() => setShow(c.key)}>
            {c.label}
          </button>
        ))}
      </div>
      <p className="empty mono" hidden={!empty}>
        {emptyLabel}
      </p>
      <div className="ed-filter" data-show={show}>
        {children}
      </div>
    </>
  );
}
