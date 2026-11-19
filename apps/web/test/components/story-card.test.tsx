import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { Briefs } from '@/components/Briefs';
import { StoryCard } from '@/components/StoryCard';
import { fixtureStory, fixtureView } from './fixture-views';

const order = (el: HTMLElement) =>
  [...el.querySelectorAll('.media,.photo,.kicker,h3,.ai,.sum,.stats,.quote,.diverge,.thread,.prepa,.srcs')].map((n) => n.className.split(' ')[0] || n.tagName.toLowerCase());

describe('carte d’un sujet', () => {
  it('empile les éléments dans l’ordre du §8.2', () => {
    const { container } = render(<StoryCard story={fixtureStory('2026-11-06-fr-1')} lang="fr" />);
    expect(order(container)).toEqual(['media', 'kicker', 'h3', 'ai', 'sum', 'stats', 'quote', 'diverge', 'thread', 'prepa', 'srcs']);
    expect(container.querySelector('svg.map')).not.toBeNull();
    expect(screen.getByText('Résumé IA · d’après les sources citées')).toBeTruthy();
    expect(screen.getByText(/La question qui est posée/).textContent).toMatch(/^« .* »$/);
  });

  it('ne laisse pas de trou quand des éléments manquent', () => {
    const story = { ...fixtureStory('2026-11-06-fr-5'), stats: [], quote: null, divergences: [], thread: null, prepa: null };
    const { container } = render(<StoryCard story={story} lang="fr" />);
    expect(order(container)).toEqual(['photo', 'kicker', 'h3', 'ai', 'sum', 'srcs']);
  });

  it('affiche une photo Wikimedia Commons créditée (auteur, licence, source), et un aplat sans crédit pour toute autre URL', () => {
    const base = fixtureStory('2026-11-06-fr-5');
    const photo = {
      provider: 'wikimedia' as const,
      src: 'https://upload.wikimedia.org/wikipedia/commons/a/ab/Train.jpg',
      width: 1600,
      height: 1067,
      author: 'Ana',
      license: 'CC BY-SA 4.0',
      licenseUrl: 'https://creativecommons.org/licenses/by-sa/4.0',
      pageUrl: 'https://commons.wikimedia.org/wiki/File:Train.jpg',
    };
    const { container, unmount } = render(<StoryCard story={{ ...base, visual: { type: 'photo', query: 'train', photo } }} lang="fr" />);
    expect(container.querySelector('img')?.getAttribute('src')).toBe(photo.src);
    const credit = container.querySelector('.credit')!;
    expect(credit.textContent).toBe('Photo : Ana — CC BY-SA 4.0 · Wikimedia Commons');
    expect(credit.querySelector('.au')?.getAttribute('title')).toBe('Ana');
    expect(within(credit as HTMLElement).getByRole('link', { name: 'Ana' }).getAttribute('href')).toBe(photo.pageUrl);
    expect(within(credit as HTMLElement).getByRole('link', { name: 'CC BY-SA 4.0' }).getAttribute('href')).toBe(photo.licenseUrl);
    unmount();
    const { licenseUrl: _, ...pd } = { ...photo, license: 'Public domain' };
    const pdCard = render(<StoryCard story={{ ...base, visual: { type: 'photo', query: 'train', photo: pd } }} lang="fr" />);
    expect(pdCard.container.querySelector('.credit')?.textContent).toBe('Photo : Ana — Public domain · Wikimedia Commons');
    expect(within(pdCard.container.querySelector('.credit') as HTMLElement).getAllByRole('link')).toHaveLength(1);
    pdCard.unmount();
    const evil = render(<StoryCard story={{ ...base, visual: { type: 'photo', query: 'train', photo: { ...photo, src: 'https://evil.example/p.jpg' } } }} lang="fr" />);
    expect(evil.container.querySelector('img')).toBeNull();
    expect(evil.container.querySelector('.ph')).not.toBeNull();
    expect(evil.container.querySelector('.credit')).toBeNull();
    evil.unmount();
    const none = render(<StoryCard story={base} lang="fr" />);
    expect(none.container.querySelector('.ph')).not.toBeNull();
    expect(none.container.querySelector('.credit')).toBeNull();
    expect(none.container.textContent).not.toMatch(/Pexels|Wikimedia/);
  });

  it('échappe les textes écrits par le modèle', () => {
    const story = { ...fixtureStory('2026-11-06-fr-5'), title: '<img src=x onerror=alert(1)>', summary: '<script>alert(1)</script>' };
    const { container } = render(<StoryCard story={story} lang="fr" />);
    expect(container.querySelector('script')).toBeNull();
    expect(container.querySelector('h3 img')).toBeNull();
    expect(screen.getByRole('heading').textContent).toBe('<img src=x onerror=alert(1)>');
  });

  it('déplie la liste des sources et ouvre la première source lue en entier', async () => {
    const { container } = render(<StoryCard story={fixtureStory('2026-11-06-fr-2')} lang="fr" />);
    const more = container.querySelector('.more') as HTMLElement;
    expect(more.hidden).toBe(true);
    await userEvent.click(screen.getByRole('button', { name: '6 sources' }));
    expect(more.hidden).toBe(false);
    expect(within(more).getAllByRole('link')).toHaveLength(6);
    const read = screen.getByRole('link', { name: /^Lire/ });
    expect(read.getAttribute('rel')).toBe('noopener noreferrer');
    expect(read.getAttribute('href')).toBe(fixtureStory('2026-11-06-fr-2').sources.find((s) => s.readFull)!.url);
  });

  it('lie le Thread à sa frise', () => {
    const story = fixtureStory('2026-11-06-fr-4');
    render(<StoryCard story={story} lang="fr" />);
    expect(screen.getByRole('link', { name: /Épisodes méditerranéens 2026/ }).getAttribute('href')).toBe(`/threads/${story.thread!.id}`);
  });

  it('liste les brèves en anglais avec leur média', () => {
    const tec = fixtureView('en').sections.find((s) => s.key === 'tec')!;
    render(<Briefs briefs={tec.briefs} lang="en" />);
    expect(screen.getByText('In brief')).toBeTruthy();
    expect(screen.getAllByRole('link')).toHaveLength(2);
  });
});
