'use client';
import { useId, useState, type ReactNode } from 'react';
import { Ext } from './icons';

/** Pied de carte : pile de médias, bouton « N sources » qui déplie la liste, bouton « Lire ». */
export function SourcesToggle({ stack, count, sourcesLabel, readLabel, readUrl, children }: { stack: ReactNode; count: number; sourcesLabel: string; readLabel: string; readUrl: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  return (
    <>
      <div className="srcs">
        {stack}
        <div className="btns">
          {count > 1 && (
            <button type="button" className="btn" aria-expanded={open} aria-controls={id} onClick={() => setOpen((o) => !o)}>
              {count} {sourcesLabel}
            </button>
          )}
          <a className="btn pri" target="_blank" rel="noopener noreferrer" href={readUrl}>
            {readLabel} <Ext />
          </a>
        </div>
      </div>
      {count > 1 && (
        <div className="more" id={id} hidden={!open}>
          {children}
        </div>
      )}
    </>
  );
}
