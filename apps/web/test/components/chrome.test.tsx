import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { AccountBlock, AccountMenu } from '@/components/Account';
import { AppShell, EditionAccent } from '@/components/AppShell';
import { Banner } from '@/components/Banner';
import { EditionTabs } from '@/components/EditionTabs';
import { Sidebar } from '@/components/Sidebar';
import { TabBar } from '@/components/TabBar';
import { TopBar } from '@/components/TopBar';

const nav = vi.hoisted(() => ({ path: '/' }));
vi.mock('next/navigation', () => ({ usePathname: () => nav.path, useRouter: () => ({ prefetch: () => {}, push: () => {} }) }));

const editions = () => within(screen.getByRole('navigation', { name: 'Éditions' })).getAllByRole('link');

describe('en-tête, bandeaux et barre d’onglets', () => {
  it('l’en-tête montre la date, l’heure de Paris et les trois éditions', () => {
    render(<TopBar lang="en" date="2026-11-06" generatedAt="2026-11-06T04:41:00Z" basePath="/" />);
    expect(screen.getByText('VEN 06.11.26 · 05:41')).toBeTruthy();
    const tabs = editions();
    expect(tabs.map((a) => a.getAttribute('href'))).toEqual(['/?ed=fr', '/?ed=en', '/?ed=es']);
    expect(tabs.map((a) => a.getAttribute('aria-current'))).toEqual([null, 'page', null]);
  });

  it('les onglets d’une édition archivée restent sur sa date', () => {
    render(<TopBar lang="fr" date="2026-11-05" basePath="/edition/2026-11-05" />);
    expect(editions()[2].getAttribute('href')).toBe('/edition/2026-11-05?ed=es');
  });

  it('affiche les deux bandeaux dans la langue de l’édition', () => {
    render(<Banner kind="light" lang="fr" date="2026-11-06" />);
    expect(screen.getByRole('status').textContent).toBe('Édition allégéeÉdition allégée : peu de sources lisibles ce matin.');
    render(<Banner kind="yesterday" lang="en" date="2026-11-05" />);
    expect(screen.getAllByRole('status')[1].textContent).toContain('Yesterday’s brief (Thu 5 Nov)');
  });

  it('traduit le libellé en gras de chaque bandeau', () => {
    const label = (kind: 'light' | 'yesterday' | 'latest', lang: 'fr' | 'en' | 'es') => {
      const { container, unmount } = render(<Banner kind={kind} lang={lang} date="2026-11-03" />);
      const text = container.querySelector('b')!.textContent;
      unmount();
      return text;
    };
    expect([label('light', 'en'), label('yesterday', 'en'), label('latest', 'en')]).toEqual(['Light edition', 'Yesterday’s brief', 'Latest brief']);
    expect([label('light', 'es'), label('yesterday', 'es'), label('latest', 'es')]).toEqual(['Edición reducida', 'Brief del día anterior', 'Último brief']);
    expect([label('yesterday', 'fr'), label('latest', 'fr')]).toEqual(['Brief de la veille', 'Dernier brief']);
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
    nav.path = '/';
  });
});

describe('coquille : accent de l’édition et compte', () => {
  const app = (c: HTMLElement) => c.querySelector('.app')!.getAttribute('data-ed');

  it('l’accent de la coquille suit l’écran d’édition affiché, pas seulement le cookie du premier chargement', () => {
    const { container, rerender } = render(
      <AppShell initialLang="fr" user={null}>
        <EditionAccent lang="fr" />
      </AppShell>,
    );
    expect(app(container)).toBe('fr');
    // Navigation côté client : la mise en page n'est pas re-rendue, seule la page change.
    rerender(
      <AppShell initialLang="fr" user={null}>
        <EditionAccent lang="es" />
      </AppShell>,
    );
    expect(app(container)).toBe('es');
  });

  it('un clic sur un onglet change l’accent tout de suite et retient le choix dans le cookie', () => {
    const { container } = render(
      <AppShell initialLang="fr" user={null}>
        <EditionTabs lang="fr" basePath="/" />
      </AppShell>,
    );
    const en = editions()[1];
    en.addEventListener('click', (e) => e.preventDefault());
    fireEvent.click(en);
    expect(app(container)).toBe('en');
    expect(document.cookie).toContain('ed=en');
    expect(container.querySelectorAll('.editions .pend')).toHaveLength(3);
  });

  it('la barre latérale garde la date d’une édition archivée, sinon mène au Brief', () => {
    nav.path = '/edition/2026-11-05';
    const { unmount } = render(
      <AppShell initialLang="es" user={null}>
        <Sidebar />
      </AppShell>,
    );
    expect(editions().map((a) => a.getAttribute('href'))).toEqual(['/edition/2026-11-05?ed=fr', '/edition/2026-11-05?ed=en', '/edition/2026-11-05?ed=es']);
    expect(editions()[2].getAttribute('aria-current')).toBe('page');
    unmount();
    nav.path = '/threads';
    render(
      <AppShell initialLang="en" user={null}>
        <Sidebar />
      </AppShell>,
    );
    expect(editions()[0].getAttribute('href')).toBe('/?ed=fr');
    expect(screen.getByRole('link', { name: 'Threads' }).getAttribute('aria-current')).toBe('page');
    nav.path = '/';
  });

  it('visiteur : « Se connecter » dans le menu du compte et dans la barre latérale', () => {
    render(
      <AppShell initialLang="fr" user={null}>
        <AccountMenu />
        <AccountBlock />
      </AppShell>,
    );
    expect(screen.getAllByRole('link', { name: 'Se connecter' }).map((a) => a.getAttribute('href'))).toEqual(['/login', '/login']);
    expect(screen.queryByText('Santé →')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Se déconnecter' })).toBeNull();
  });

  it('connecté : adresse, lien Santé et « Se déconnecter » en POST', () => {
    render(
      <AppShell initialLang="fr" user={{ email: 'moi@exemple.fr' }}>
        <AccountBlock />
      </AppShell>,
    );
    expect(screen.getByText('moi@exemple.fr')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Santé →' }).getAttribute('href')).toBe('/sante');
    const form = screen.getByRole('button', { name: 'Se déconnecter' }).closest('form')!;
    expect([form.getAttribute('action'), form.getAttribute('method')]).toEqual(['/auth/signout', 'post']);
    expect(screen.queryByRole('link', { name: 'Se connecter' })).toBeNull();
  });
});
