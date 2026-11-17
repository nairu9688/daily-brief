import { act, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

vi.mock('next/navigation', () => ({ usePathname: () => '/' }));
const actions = vi.hoisted(() => ({
  setVocabSelected: vi.fn(async (_: unknown) => ({ ok: true, count: 1 }) as { ok: true; count: number } | { ok: false; error: string }),
  queueAnki: vi.fn(async (input: unknown) => ({ ok: true, count: (input as { ids: string[] }).ids.length })),
  setThreadFollowed: vi.fn(async () => ({ ok: true, count: 1 })),
}));
vi.mock('@/app/actions', () => actions);

import { EditionScreen } from '@/components/EditionScreen';
import { formatTime } from '@/components/Player';
import { fixtureView } from './fixture-views';

describe('écran d’une édition', () => {
  it('rend les rubriques, les puces grisées et le colophon', () => {
    const { container } = render(<EditionScreen edition={fixtureView('fr')} basePath="/" />);
    expect([...container.querySelectorAll('.rub')].map((r) => r.getAttribute('data-rub'))).toEqual(['pol', 'int', 'env', 'eco', 'ent', 'dro', 'tec', 'spo']);
    expect([...container.querySelectorAll('.chip.dim')].map((c) => c.textContent)).toEqual(['Culture']);
    expect(screen.getByText(/Édition générée à 05:41 · 15 médias/)).toBeTruthy();
    expect(container.querySelectorAll('.points li')).toHaveLength(5);
    expect(container.querySelector('.banner')).toBeNull();
  });

  it('filtre par rubrique et montre le message vide pour une rubrique absente', async () => {
    const { container } = render(<EditionScreen edition={fixtureView('fr')} basePath="/" />);
    await userEvent.click(screen.getByRole('button', { name: 'Culture' }));
    expect(container.querySelector('.ed-filter')?.getAttribute('data-show')).toBe('cul');
    expect((container.querySelector('.empty') as HTMLElement).hidden).toBe(false);
    await userEvent.click(screen.getByRole('button', { name: 'Tout' }));
    expect((container.querySelector('.empty') as HTMLElement).hidden).toBe(true);
  });

  it('affiche les bandeaux « brief de la veille » et « édition allégée »', () => {
    render(<EditionScreen edition={fixtureView('es', { light: true })} basePath="/" yesterdayOf="2026-11-07" />);
    expect(screen.getAllByRole('status').map((s) => s.getAttribute('data-kind'))).toEqual(['yesterday', 'light']);
  });

  it('montre le lecteur seulement s’il y a un MP3, et lit sa durée dans les métadonnées', () => {
    const { container, unmount } = render(<EditionScreen edition={fixtureView('fr', { hasAudio: false })} basePath="/" />);
    expect(container.querySelector('.player')).toBeNull();
    unmount();
    const withAudio = render(<EditionScreen edition={fixtureView('fr')} basePath="/" />);
    const audio = withAudio.container.querySelector('audio')!;
    expect(audio.getAttribute('src')).toBe('/audio/2026-11-06/fr');
    expect(withAudio.container.querySelector('.ptime')?.textContent).toContain('–:––');
    Object.defineProperty(audio, 'duration', { value: 204 });
    act(() => {
      fireEvent.loadedMetadata(audio);
    });
    expect(withAudio.container.querySelector('.ptime')?.textContent).toContain('3:24');
    expect(formatTime(Number.NaN)).toBe('–:––');
  });

  it('a un lien PDF seulement si le PDF existe', () => {
    render(<EditionScreen edition={fixtureView('fr', { hasPdf: true })} basePath="/" />);
    expect(screen.getByRole('link', { name: 'PDF du jour' }).getAttribute('href')).toBe('/pdf/2026-11-06');
  });
});

describe('Vocab du jour', () => {
  it('coche, met en file Anki et compte les mots', async () => {
    render(<EditionScreen edition={fixtureView('en')} basePath="/" />);
    const boxes = screen.getAllByRole('checkbox');
    expect(boxes).toHaveLength(6);
    expect((screen.getByRole('button', { name: 'Ajouter à Anki' }) as HTMLButtonElement).disabled).toBe(true);
    await userEvent.click(boxes[0]);
    await userEvent.click(boxes[1]);
    expect(actions.setVocabSelected).toHaveBeenLastCalledWith({ ids: [expect.any(String)], selected: true });
    await userEvent.click(screen.getByRole('button', { name: 'Ajouter 2 mots à Anki' }));
    expect(actions.queueAnki).toHaveBeenCalledWith({ ids: [expect.any(String), expect.any(String)] });
    expect(screen.getByText('2 mots en file pour Anki ✓')).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Ajouter à Anki' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('« Tout cocher » coche les six mots d’un coup', async () => {
    render(<EditionScreen edition={fixtureView('es')} basePath="/" />);
    await userEvent.click(screen.getByRole('button', { name: 'Tout cocher' }));
    expect(actions.setVocabSelected).toHaveBeenLastCalledWith({ ids: expect.arrayContaining([expect.any(String)]), selected: true });
    expect((actions.setVocabSelected.mock.lastCall![0] as { ids: string[] }).ids).toHaveLength(6);
    expect(screen.getByRole('button', { name: 'Tout décocher' })).toBeTruthy();
  });

  it('remet la case dans son état et prévient si l’écriture échoue', async () => {
    actions.setVocabSelected.mockResolvedValueOnce({ ok: false, error: 'Session expirée : reconnecte-toi.' });
    render(<EditionScreen edition={fixtureView('en')} basePath="/" />);
    const box = screen.getAllByRole('checkbox')[0] as HTMLInputElement;
    await userEvent.click(box);
    expect(box.checked).toBe(false);
    expect(screen.getByRole('alert').textContent).toBe('Session expirée : reconnecte-toi.');
  });
});
