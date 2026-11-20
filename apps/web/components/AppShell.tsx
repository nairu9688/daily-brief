'use client';
import { createContext, use, useEffect, useLayoutEffect, useState, type ReactNode } from 'react';
import type { Lang } from '@daily-brief/schema';

export type ShellUser = { email: string } | null;

type Shell = { lang: Lang; setLang: (l: Lang) => void; user: ShellUser };

const ShellContext = createContext<Shell>({ lang: 'fr', setLang: () => {}, user: null });

/** Édition affichée (accent) et utilisateur, pour les composants clients de la coquille. */
export const useShell = () => use(ShellContext);

/** useLayoutEffect côté client seulement (pas d'avertissement au rendu serveur). */
const useIsoLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect;

/**
 * Coquille de l'appli : `.app[data-ed]` porte l'accent de l'édition (design/app.css).
 *
 * La mise en page (app)/layout.tsx n'est PAS re-rendue lors d'une navigation côté client (seule la page
 * l'est) : un `data-ed` posé par le serveur dans la mise en page restait figé sur l'édition du premier
 * chargement. L'accent est donc un état client, initialisé par le cookie et mis à jour par chaque écran
 * d'édition (<EditionAccent>) ou par le clic sur un onglet.
 */
export function AppShell({ initialLang, user, children }: { initialLang: Lang; user: ShellUser; children: ReactNode }) {
  const [lang, setLang] = useState<Lang>(initialLang);
  return (
    <ShellContext value={{ lang, setLang, user }}>
      <div className="app" data-ed={lang}>
        {children}
      </div>
    </ShellContext>
  );
}

/** Rendu par un écran d'édition : l'accent de la coquille devient celui de l'édition affichée. */
export function EditionAccent({ lang }: { lang: Lang }) {
  const { setLang } = useShell();
  useIsoLayoutEffect(() => setLang(lang), [lang, setLang]);
  return null;
}
