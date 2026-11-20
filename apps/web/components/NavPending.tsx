'use client';
import { useLinkStatus } from 'next/link';

/**
 * À placer dans un <Link> : pendant la navigation qu'il a lancée, une marque `.pend[data-on]` (l'onglet
 * s'allume, l'écran courant s'estompe : globals.css) et une fine barre de progression en haut de l'écran.
 * Retour immédiat au clic, avant la réponse du serveur.
 */
export function NavPending() {
  const { pending } = useLinkStatus();
  return (
    <>
      <i className="pend" data-on={pending ? '' : undefined} aria-hidden="true" />
      {pending && <i className="progress" aria-hidden="true" />}
    </>
  );
}
