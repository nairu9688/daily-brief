'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { TabArchive, TabBrief, TabThreads, TabVocab } from './icons';

const TABS = [
  { href: '/', label: 'Brief', Icon: TabBrief, match: (p: string) => p === '/' || p.startsWith('/edition/') },
  { href: '/threads', label: 'Threads', Icon: TabThreads, match: (p: string) => p.startsWith('/threads') },
  { href: '/vocab', label: 'Vocab', Icon: TabVocab, match: (p: string) => p.startsWith('/vocab') },
  { href: '/archive', label: 'Archive', Icon: TabArchive, match: (p: string) => p.startsWith('/archive') || p.startsWith('/sante') },
];

/** Barre d'onglets du bas (maquette) : Brief, Threads, Vocab, Archive (la page Santé est rangée sous Archive). */
export function TabBar() {
  const path = usePathname() ?? '/';
  return (
    <nav className="tabbar" aria-label="Navigation principale">
      {TABS.map(({ href, label, Icon, match }) => (
        <Link key={href} href={href} className={match(path) ? 'on' : undefined} aria-current={match(path) ? 'page' : undefined}>
          <Icon />
          {label}
        </Link>
      ))}
    </nav>
  );
}
