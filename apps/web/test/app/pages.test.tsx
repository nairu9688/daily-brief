import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FixtureDataSource, resetFixtureState } from '@/lib/data/fixture';

const m = vi.hoisted(() => ({ today: '2026-11-06', light: [] as ('fr' | 'en' | 'es')[], ed: undefined as string | undefined }));
vi.mock('@/lib/data', () => ({ getDataSource: async () => new FixtureDataSource({ today: m.today, light: m.light }) }));
vi.mock('next/headers', () => ({ cookies: async () => ({ get: () => (m.ed ? { value: m.ed } : undefined) }) }));
vi.mock('next/navigation', () => ({
  usePathname: () => '/',
  notFound: () => {
    throw new Error('NOT_FOUND');
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
  Object.assign(m, { today: '2026-11-06', light: [], ed: undefined });
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
    render(await ThreadPage({ params: Promise.resolve({ id }) }));
    expect(screen.getByRole('button', { name: 'Suivre ce thread' })).toBeTruthy();
    expect(screen.getAllByRole('listitem').filter((li) => li.closest('.timeline'))).toHaveLength(2);
    await expect(ThreadPage({ params: Promise.resolve({ id: 'pas-un-uuid' }) })).rejects.toThrow('NOT_FOUND');
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
    const { container } = render(await SantePage());
    expect([...container.querySelectorAll('.run')].map((r) => r.getAttribute('data-status'))).toEqual(['ok', 'degraded', 'interrupted']);
  });
});
