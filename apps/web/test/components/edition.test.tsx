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
    const { container } = render(<EditionScreen edition={fixtureView('fr')} basePath="/" editable />);
    expect([...container.querySelectorAll('.rub')].map((r) => r.getAttribute('data-rub'))).toEqual(['pol', 'int', 'env', 'eco', 'ent', 'dro', 'tec', 'spo']);
    expect([...container.querySelectorAll('.chip.dim')].map((c) => c.textContent)).toEqual(['Culture']);
    expect(screen.getByText(/Édition générée à 05:41 · 15 médias/)).toBeTruthy();
    expect(container.querySelectorAll('.points li')).toHaveLength(5);
    expect(container.querySelector('.banner')).toBeNull();
  });

  it('filtre par rubrique et montre le message vide pour une rubrique absente', async () => {
    const { container } = render(<EditionScreen edition={fixtureView('fr')} basePath="/" editable />);
    await userEvent.click(screen.getByRole('button', { name: 'Culture' }));
    expect(container.querySelector('.ed-filter')?.getAttribute('data-show')).toBe('cul');
    expect((container.querySelector('.empty') as HTMLElement).hidden).toBe(false);
    await userEvent.click(screen.getByRole('button', { name: 'Tout' }));
    expect((container.querySelector('.empty') as HTMLElement).hidden).toBe(true);
  });

  it('affiche les bandeaux « brief de la veille » ou « dernier brief », et « édition allégée »', () => {
    const { unmount } = render(<EditionScreen edition={fixtureView('es', { light: true })} basePath="/" editable stale="yesterday" />);
    expect(screen.getAllByRole('status').map((s) => s.getAttribute('data-kind'))).toEqual(['yesterday', 'light']);
    unmount();
    render(<EditionScreen edition={fixtureView('fr')} basePath="/" editable stale="latest" />);
    expect(screen.getByRole('status').getAttribute('data-kind')).toBe('latest');
  });

  it('déclare la langue de l’édition et celle des mots', () => {
    const { container } = render(<EditionScreen edition={fixtureView('es')} basePath="/" editable />);
    expect(container.querySelector('section.edition')?.getAttribute('lang')).toBe('es');
    const rows = [...container.querySelectorAll('.vrow')];
    expect(rows).toHaveLength(6);
    expect(rows.every((r) => r.getAttribute('lang') === 'es')).toBe(true);
    expect(rows.every((r) => r.querySelector('.fr')?.getAttribute('lang') === 'fr')).toBe(true);
  });

  it('marque en français les libellés de l’interface dans une édition étrangère', () => {
    const { container } = render(<EditionScreen edition={fixtureView('es')} basePath="/" editable />);
    const vocabRub = container.querySelector('.rub[data-rub="vocab"]')!;
    const langOf = (el: Element | null) => el?.closest('[lang]')?.getAttribute('lang');
    expect(langOf(vocabRub.querySelector('.rubhead h2'))).toBe('fr');
    expect(langOf(vocabRub.querySelector('.rubhead span'))).toBe('fr');
    expect(langOf(vocabRub.querySelector('.vocab .kicker'))).toBe('fr');
    expect(langOf(vocabRub.querySelector('.selall'))).toBe('fr');
    expect(langOf(vocabRub.querySelector('.vocab h3'))).toBe('es');
  });

  it('le lecteur permet de réessayer après une erreur de chargement', async () => {
    const { container } = render(<EditionScreen edition={fixtureView('fr')} basePath="/" editable />);
    const audio = container.querySelector('audio')!;
    const load = vi.fn();
    Object.defineProperty(audio, 'load', { value: load });
    act(() => {
      fireEvent.error(audio);
    });
    const button = screen.getByRole('button', { name: 'Écouter' }) as HTMLButtonElement;
    expect(button.disabled).toBe(false);
    expect(container.querySelector('.ptime')?.textContent).toContain('–:––');
    await userEvent.click(button);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('montre le lecteur seulement s’il y a un MP3, et lit sa durée dans les métadonnées', () => {
    const { container, unmount } = render(<EditionScreen edition={fixtureView('fr', { hasAudio: false })} basePath="/" editable />);
    expect(container.querySelector('.player')).toBeNull();
    unmount();
    const withAudio = render(<EditionScreen edition={fixtureView('fr')} basePath="/" editable />);
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
    render(<EditionScreen edition={fixtureView('fr', { hasPdf: true })} basePath="/" editable />);
    expect(screen.getByRole('link', { name: 'PDF du jour' }).getAttribute('href')).toBe('/pdf/2026-11-06');
  });
});

describe('échecs des actions côté client', () => {
  it('une case revient à son état si l’action échoue (rejet)', async () => {
    actions.setVocabSelected.mockRejectedValueOnce(new Error('Failed to fetch'));
    render(<EditionScreen edition={fixtureView('en')} basePath="/" editable />);
    const box = screen.getAllByRole('checkbox')[0] as HTMLInputElement;
    await userEvent.click(box);
    expect(box.checked).toBe(false);
    expect(screen.getByRole('alert').textContent).toBe('Enregistrement impossible, réessaie.');
  });

  it('« Ajouter à Anki » se réactive après un rejet, et montre « Session expirée »', async () => {
    render(<EditionScreen edition={fixtureView('en')} basePath="/" editable />);
    await userEvent.click(screen.getAllByRole('checkbox')[0]);
    actions.queueAnki.mockRejectedValueOnce(new Error('Failed to fetch'));
    await userEvent.click(screen.getByRole('button', { name: 'Ajouter 1 mot à Anki' }));
    expect(screen.getByRole('alert').textContent).toBe('Enregistrement impossible, réessaie.');
    const button = screen.getByRole('button', { name: 'Ajouter 1 mot à Anki' }) as HTMLButtonElement;
    expect(button.disabled).toBe(false);
    actions.queueAnki.mockResolvedValueOnce({ ok: false, error: 'Session expirée : reconnecte-toi.' } as never);
    await userEvent.click(button);
    expect(screen.getByRole('alert').textContent).toBe('Session expirée : reconnecte-toi.');
    expect(button.disabled).toBe(false);
  });

  it('« Suivre ce thread » revient à son état si l’action échoue ou rend « Session expirée »', async () => {
    const { FollowButton } = await import('@/components/FollowButton');
    render(<FollowButton id="t" followed={false} followLabel="Suivre ce thread" followingLabel="Thread suivi" />);
    const button = screen.getByRole('button');
    actions.setThreadFollowed.mockRejectedValueOnce(new Error('Failed to fetch'));
    await userEvent.click(button);
    expect(button.getAttribute('aria-pressed')).toBe('false');
    expect(screen.getByRole('alert').textContent).toBe('Enregistrement impossible, réessaie.');
    actions.setThreadFollowed.mockResolvedValueOnce({ ok: false, error: 'Session expirée : reconnecte-toi.' } as never);
    await userEvent.click(button);
    expect(button.getAttribute('aria-pressed')).toBe('false');
    expect(screen.getByRole('alert').textContent).toBe('Session expirée : reconnecte-toi.');
  });
});

describe('Vocab du jour', () => {
  it('coche, met en file Anki et compte les mots', async () => {
    render(<EditionScreen edition={fixtureView('en')} basePath="/" editable />);
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
    render(<EditionScreen edition={fixtureView('es')} basePath="/" editable />);
    await userEvent.click(screen.getByRole('button', { name: 'Tout cocher' }));
    expect(actions.setVocabSelected).toHaveBeenLastCalledWith({ ids: expect.arrayContaining([expect.any(String)]), selected: true });
    expect((actions.setVocabSelected.mock.lastCall![0] as { ids: string[] }).ids).toHaveLength(6);
    expect(screen.getByRole('button', { name: 'Tout décocher' })).toBeTruthy();
  });

  it('remet la case dans son état et prévient si l’écriture échoue', async () => {
    actions.setVocabSelected.mockResolvedValueOnce({ ok: false, error: 'Session expirée : reconnecte-toi.' });
    render(<EditionScreen edition={fixtureView('en')} basePath="/" editable />);
    const box = screen.getAllByRole('checkbox')[0] as HTMLInputElement;
    await userEvent.click(box);
    expect(box.checked).toBe(false);
    expect(screen.getByRole('alert').textContent).toBe('Session expirée : reconnecte-toi.');
  });

  it('en lecture seule (visiteur), montre les mots sans cases, sans « Tout cocher » ni pied Anki', () => {
    const { container } = render(<EditionScreen edition={fixtureView('en')} basePath="/" editable={false} />);
    const vocab = container.querySelector('.vocab')!;
    expect(vocab.classList.contains('ro')).toBe(true);
    expect(vocab.querySelectorAll('.vrow')).toHaveLength(6);
    expect(vocab.querySelectorAll('input, .box, button, footer')).toHaveLength(0);
    expect(vocab.querySelector('.vrow')?.tagName).toBe('DIV');
    expect(vocab.querySelector('.vrow b')?.textContent).toBeTruthy();
  });

  it('en lecture seule, n’affiche pas l’état Anki personnel dans la ligne de méta', async () => {
    const { VocabCard } = await import('@/components/VocabCard');
    const word = { id: 'w', term: 'landslide', pos: 'n.', translation: 'raz-de-marée', example: 'A landslide.', ankiStatus: 'queued' as const, selected: true, meta: '6 nov. · EN' };
    const { container, unmount } = render(<VocabCard kicker="k" title="t" words={[word]} editable={false} />);
    expect(container.querySelector('.vmeta')?.textContent).toBe('6 nov. · EN');
    unmount();
    const own = render(<VocabCard kicker="k" title="t" words={[word]} editable />);
    expect(own.container.querySelector('.vmeta')?.textContent).toBe('6 nov. · EN · Anki : queued');
  });
});
