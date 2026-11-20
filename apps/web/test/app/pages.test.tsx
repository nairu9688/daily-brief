import { render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FixtureDataSource, resetFixtureState } from '@/lib/data/fixture';

const m = vi.hoisted(() => ({ today: '2026-11-06', light: [] as ('fr' | 'en' | 'es')[], ed: undefined as string | undefined, user: { email: 'nanigeek@gmail.com' } as { email: string } | null }));
vi.mock('@/lib/data', () => ({ getDataSource: async () => new FixtureDataSource({ today: m.today, light: m.light }) }));
vi.mock('@/lib/auth', () => ({ currentUser: async () => m.user }));
vi.mock('next/headers', () => ({ cookies: async () => ({ get: () => (m.ed ? { value: m.ed } : undefined) }) }));
vi.mock('next/navigation', () => ({
  usePathname: () => '/',
  notFound: () => {
    throw new Error('NOT_FOUND');
  },
  redirect: (to: string) => {
    throw new Error(`REDIRECT ${to}`);
  },
}));
vi.mock('@/app/actions', () => ({ setVocabSelected: vi.fn(), queueAnki: vi.fn(), setThreadFollowed: vi.fn() }));

import ArchivePage from '@/app/(app)/archive/page';
import EditionPage from '@/app/(app)/edition/[date]/page';
import BriefPage from '@/app/(app)/page';
import SantePage from '@/app/(app)/sante/page';
import ThreadPage from '@/app/(app)/threads/[id]/page';
import ThreadsPage from '@/app/(app)/threads/page';
import VocabPage from '@/app/(app)/vocab/page';

beforeEach(() => {
  resetFixtureState();
  Object.assign(m, { today: '2026-11-06', light: [], ed: undefined, user: { email: 'nanigeek@gmail.com' } });
});

describe('pages', () => {
  it('le Brief du jour s’ouvre sur l’édition du cookie, sans bandeau', async () => {
    m.ed = 'en';
    const { container } = render(await BriefPage());
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('A blue wave sweeps Congress');
    expect(container.querySelector('.banner')).toBeNull();
  });

  it('sans édition du jour, montre la veille avec son bandeau', async () => {
    m.today = '2026-11-07';
    m.light = ['fr'];
    render(await BriefPage());
    expect(screen.getAllByRole('status').map((s) => s.getAttribute('data-kind'))).toEqual(['yesterday', 'light']);
  });

  it('une édition plus ancienne que la veille est le « dernier brief », pas « la veille »', async () => {
    m.today = '2026-11-09';
    render(await BriefPage());
    const banner = screen.getByRole('status');
    expect(banner.getAttribute('data-kind')).toBe('latest');
    expect(banner.querySelector('b')?.textContent).toBe('Dernier brief');
  });

  it('sans aucune édition, le dit simplement', async () => {
    m.today = '2026-11-01';
    render(await BriefPage());
    expect(screen.getByText('Aucune édition publiée')).toBeTruthy();
  });

  it('une édition archivée s’ouvre par sa date, et une date invalide donne 404', async () => {
    render(await EditionPage({ params: Promise.resolve({ date: '2026-11-06' }) }));
    expect(screen.getByRole('heading', { level: 1 }).textContent).toContain('Lecornu');
    await expect(EditionPage({ params: Promise.resolve({ date: '2026-02-30' }) })).rejects.toThrow('NOT_FOUND');
    await expect(EditionPage({ params: Promise.resolve({ date: '2026-11-05' }) })).rejects.toThrow('NOT_FOUND');
  });

  it('liste les Threads et ouvre une frise', async () => {
    render(await ThreadsPage());
    const link = screen.getByRole('link', { name: /Épisodes méditerranéens 2026/ });
    const id = link.getAttribute('href')!.split('/').pop()!;
    const { container } = render(await ThreadPage({ params: Promise.resolve({ id }) }));
    expect(screen.getByRole('button', { name: 'Suivre ce thread' })).toBeTruthy();
    const episodes = screen.getAllByRole('listitem').filter((li) => li.closest('.timeline'));
    expect(episodes).toHaveLength(2);
    // Maquette, écran 2 : titre en h1, description du Thread dans l'en-tête, texte de l'épisode du jour sous l'épisode.
    expect(within(container).getByRole('heading', { level: 1 }).textContent).toBe('Épisodes méditerranéens 2026');
    expect(container.querySelector('.th-head p')?.textContent).toBe('Les pluies diluviennes qui frappent le Sud-Est et la Corse depuis la mi-octobre, épisode par épisode.');
    expect(episodes[0].querySelector('.d')?.textContent).toBe('Ven. 6 nov. · Aujourd’hui');
    expect(episodes[0].querySelector('p')?.textContent).toBeTruthy();
    expect(screen.getByRole('link', { name: '← BRIEF' }).getAttribute('href')).toBe('/');
    expect(container.querySelector('[data-ed]')?.getAttribute('lang')).toBe('fr');
    await expect(ThreadPage({ params: Promise.resolve({ id: 'pas-un-uuid' }) })).rejects.toThrow('NOT_FOUND');
  });

  it('trie les Threads : suivis, puis ouverts, puis fermés, chacun du plus récent au plus ancien', async () => {
    const ds = new FixtureDataSource({ today: '2026-11-06' });
    const base = (await ds.threads())[0];
    const list = [
      { ...base, id: 'a', title: 'A', followed: false, status: 'open' as const, lastDate: '2026-11-01' },
      { ...base, id: 'b', title: 'B', followed: false, status: 'open' as const, lastDate: null },
      { ...base, id: 'c', title: 'C', followed: false, status: 'open' as const, lastDate: '2026-11-05' },
      { ...base, id: 'd', title: 'D', followed: false, status: 'closed' as const, lastDate: '2026-11-06' },
      { ...base, id: 'e', title: 'E', followed: true, status: 'open' as const, lastDate: '2026-10-01' },
      { ...base, id: 'f', title: 'F', followed: false, status: 'open' as const, lastDate: '2026-11-05' },
    ];
    const { sortThreads } = await import('@/lib/threads');
    expect(sortThreads(list).map((t) => t.id)).toEqual(['e', 'c', 'f', 'a', 'b', 'd']);
    expect(sortThreads([...list].reverse()).map((t) => t.id)).toEqual(['e', 'f', 'c', 'a', 'b', 'd']);
  });

  it('filtre le vocabulaire par langue et par date', async () => {
    render(await VocabPage({ searchParams: Promise.resolve({ langue: 'es', date: '2026-11-06' }) }));
    expect(screen.getAllByRole('checkbox')).toHaveLength(6);
    expect(screen.getByRole('link', { name: 'ES' }).getAttribute('aria-current')).toBe('true');
    render(await VocabPage({ searchParams: Promise.resolve({ coche: 'oui' }) }));
    expect(screen.getByText('Aucun mot pour ces filtres.')).toBeTruthy();
  });

  it('l’archive lie les jours publiés du mois, et la page Santé liste les passages', async () => {
    render(await ArchivePage({ searchParams: Promise.resolve({ m: '2026-11' }) }));
    expect(screen.getByRole('link', { name: /Édition du 2026-11-06/ }).getAttribute('href')).toBe('/edition/2026-11-06');
    expect(screen.getByText('novembre 2026')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Santé →' }).getAttribute('href')).toBe('/sante');
    expect(screen.queryByRole('link', { name: 'Se connecter' })).toBeNull();
    const { container } = render(await SantePage());
    expect([...container.querySelectorAll('.run')].map((r) => r.getAttribute('data-status'))).toEqual(['ok', 'degraded', 'interrupted']);
  });
});

describe('pages, visiteur sans session (lecture publique)', () => {
  beforeEach(() => {
    m.user = null;
  });

  it('le Brief se lit, sans case à cocher, sans « Tout cocher » ni « Ajouter à Anki »', async () => {
    m.ed = 'en';
    const { container } = render(await BriefPage());
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('A blue wave sweeps Congress');
    expect(container.querySelectorAll('.vocab .vrow')).toHaveLength(6);
    expect(screen.queryAllByRole('checkbox')).toEqual([]);
    expect(screen.queryByRole('button', { name: /Tout cocher|Ajouter/ })).toBeNull();
    expect(container.querySelector('.player')).not.toBeNull();
  });

  it('une édition archivée se lit aussi en lecture seule', async () => {
    m.ed = 'es';
    const { container } = render(await EditionPage({ params: Promise.resolve({ date: '2026-11-06' }) }));
    expect(container.querySelectorAll('.vocab .vrow')).toHaveLength(6);
    expect(screen.queryAllByRole('checkbox')).toEqual([]);
  });

  it('la frise d’un Thread se lit, sans « Suivre ce thread »', async () => {
    render(await ThreadsPage());
    const id = screen.getByRole('link', { name: /Épisodes méditerranéens 2026/ }).getAttribute('href')!.split('/').pop()!;
    const { container } = render(await ThreadPage({ params: Promise.resolve({ id }) }));
    expect(container.querySelectorAll('.timeline li')).toHaveLength(2);
    expect(screen.queryByRole('button', { name: /Suivre|suivi/ })).toBeNull();
  });

  it('le vocabulaire se lit, sans cases ni filtre « Coché » (personnel)', async () => {
    const { container } = render(await VocabPage({ searchParams: Promise.resolve({ langue: 'es', date: '2026-11-06' }) }));
    expect(container.querySelectorAll('.vrow')).toHaveLength(6);
    expect(screen.queryAllByRole('checkbox')).toEqual([]);
    expect(screen.queryByRole('navigation', { name: 'Coché' })).toBeNull();
    expect(screen.queryByRole('link', { name: 'Cochés' })).toBeNull();
  });

  it('l’archive propose « Se connecter » à la place du lien Santé', async () => {
    render(await ArchivePage({ searchParams: Promise.resolve({ m: '2026-11' }) }));
    expect(screen.getByRole('link', { name: /Édition du 2026-11-06/ })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Se connecter' }).getAttribute('href')).toBe('/login');
    expect(screen.queryByRole('link', { name: 'Santé →' })).toBeNull();
  });

  it('la page Santé renvoie vers /login (défense en profondeur, en plus du proxy)', async () => {
    await expect(SantePage()).rejects.toThrow('REDIRECT /login');
  });
});
