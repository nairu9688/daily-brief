'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { NavPending } from './NavPending';
import { TabArchive, TabBrief, TabThreads, TabVocab } from './icons';

export const TABS = [
  { href: '/', label: 'Brief', Icon: TabBrief, match: (p: string) => p === '/' || p.startsWith('/edition/') },
  { href: '/threads', label: 'Threads', Icon: TabThreads, match: (p: string) => p.startsWith('/threads') },
  { href: '/vocab', label: 'Vocab', Icon: TabVocab, match: (p: string) => p.startsWith('/vocab') },
  { href: '/archive', label: 'Archive', Icon: TabArchive, match: (p: string) => p.startsWith('/archive') || p.startsWith('/sante') },
];

/**
 * Navigation principale : barre d'onglets du bas (maquette, téléphone) ou liste de la barre latérale
 * (grand écran) : Brief, Threads, Vocab, Archive (la page Santé est rangée sous Archive).
 */
export function TabBar({ variant = 'bar' }: { variant?: 'bar' | 'side' }) {
  const path = usePathname() ?? '/';
  return (
    <nav className={variant === 'bar' ? 'tabbar' : 'sidenav'} aria-label="Navigation principale">
      {TABS.map(({ href, label, Icon, match }) => (
        <Link key={href} href={href} className={match(path) ? 'on' : undefined} aria-current={match(path) ? 'page' : undefined}>
          <Icon />
          {label}
          <NavPending />
        </Link>
      ))}
    </nav>
  );
}
