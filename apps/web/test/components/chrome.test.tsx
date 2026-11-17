import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Banner } from '@/components/Banner';
import { TabBar } from '@/components/TabBar';
import { TopBar } from '@/components/TopBar';

const nav = vi.hoisted(() => ({ path: '/' }));
vi.mock('next/navigation', () => ({ usePathname: () => nav.path }));

describe('en-tête, bandeaux et barre d’onglets', () => {
  it('l’en-tête montre la date, l’heure de Paris et les trois éditions', () => {
    render(<TopBar lang="en" date="2026-11-06" generatedAt="2026-11-06T04:41:00Z" basePath="/" />);
    expect(screen.getByText('VEN 06.11.26 · 05:41')).toBeTruthy();
    const tabs = screen.getAllByRole('link');
    expect(tabs.map((a) => a.getAttribute('href'))).toEqual(['/?ed=fr', '/?ed=en', '/?ed=es']);
    expect(tabs.map((a) => a.getAttribute('aria-current'))).toEqual([null, 'page', null]);
  });

  it('les onglets d’une édition archivée restent sur sa date', () => {
    render(<TopBar lang="fr" date="2026-11-05" basePath="/edition/2026-11-05" />);
    expect(screen.getAllByRole('link')[2].getAttribute('href')).toBe('/edition/2026-11-05?ed=es');
  });

  it('affiche les deux bandeaux dans la langue de l’édition', () => {
    render(<Banner kind="light" lang="fr" date="2026-11-06" />);
    expect(screen.getByRole('status').textContent).toBe('Édition allégéeÉdition allégée : peu de sources lisibles ce matin.');
    render(<Banner kind="yesterday" lang="en" date="2026-11-05" />);
    expect(screen.getAllByRole('status')[1].textContent).toContain('Yesterday’s brief (Thu 5 Nov)');
  });

  it('allume l’onglet de la page courante (Santé est rangée sous Archive)', () => {
    nav.path = '/threads/abc';
    const { unmount } = render(<TabBar />);
    expect(screen.getByRole('link', { name: 'Threads' }).className).toBe('on');
    expect(screen.getAllByRole('link').map((a) => a.textContent)).toEqual(['Brief', 'Threads', 'Vocab', 'Archive']);
    unmount();
    nav.path = '/sante';
    render(<TabBar />);
    expect(screen.getByRole('link', { name: 'Archive' }).getAttribute('aria-current')).toBe('page');
  });
});
