'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { LANGS, type Lang } from '@daily-brief/schema';
import { EDITION_COOKIE, EDITION_COOKIE_MAX_AGE } from '@/lib/edition-choice';
import { REGION, T } from '@/lib/i18n';
import { useShell } from './AppShell';
import { NavPending } from './NavPending';

/** Retient le choix tout de suite : une navigation servie par le préchargement ne repasse pas par le proxy. */
function remember(l: Lang) {
  const secure = window.location.protocol === 'https:' ? '; secure' : '';
  document.cookie = `${EDITION_COOKIE}=${l}; path=/; max-age=${EDITION_COOKIE_MAX_AGE}; samesite=lax${secure}`;
}

/**
 * Préchargement complet de l'écran au survol ou au toucher (prop de next/link absente des types de routes
 * typées de Next 16.4, d'où l'objet étalé).
 */
const DYNAMIC_ON_HOVER = { unstable_dynamicOnHover: true } as object;

/** Page des onglets hors d'un écran d'édition (barre latérale) : l'archive garde sa date, sinon le Brief. */
const sideBase = (path: string) => (/^\/edition\/\d{4}-\d{2}-\d{2}$/.test(path) ? path : '/');

/**
 * Onglets FR/EN/ES : des liens `?ed=xx` (sans JavaScript, le proxy retient le choix dans le cookie `ed`).
 * Avec JavaScript : préchargement complet de l'écran au survol ou au toucher, marque de chargement et
 * barre de progression dès le clic (NavPending), cookie posé au clic.
 * `lang` et `basePath` absents (barre latérale) : édition de la coquille et page courante.
 */
export function EditionTabs({ lang, basePath, variant = 'top' }: { lang?: Lang; basePath?: string; variant?: 'top' | 'side' }) {
  const shell = useShell();
  const path = usePathname() ?? '/';
  const current = lang ?? shell.lang;
  const base = basePath ?? sideBase(path);
  return (
    <nav className={variant === 'side' ? 'editions ed-side' : 'editions'} aria-label="Éditions">
      {LANGS.map((l) => (
        <Link
          key={l}
          href={`${base}?ed=${l}`}
          data-ed={l}
          aria-current={l === current ? 'page' : undefined}
          {...DYNAMIC_ON_HOVER}
          onClick={() => {
            remember(l);
            shell.setLang(l);
          }}
        >
          <b>
            {variant === 'side' && <span className="dot" aria-hidden="true" />}
            {T[l].label}
          </b>
          <span className="mono">{REGION[l]}</span>
          <NavPending />
        </Link>
      ))}
    </nav>
  );
}
