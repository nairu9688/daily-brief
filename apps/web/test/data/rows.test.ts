import { describe, expect, it } from 'vitest';
import { stableUuid } from '@/lib/data/ids';
import { editionFromRows, parseRows, photoSrc, safeUrl, StoryRowSchema, threadFromRow, type EditionRow, type SourceRow, type StoryRow } from '@/lib/data/rows';

const edition: EditionRow = {
  id: 'e1',
  date: '2026-11-06',
  lang: 'fr',
  region: 'France · Monde',
  headline: 'Titre',
  morning_brief: [],
  sections: [
    { key: 'pol', title: 'Politique & société' },
    { key: 'dro', title: 'Droit & justice' },
  ],
  vocab_title: null,
  audio_path: null,
  pdf_path: '2026-11-06/daily-brief-2026-11-06.pdf',
  status: 'light',
  generated_at: '2026-11-06T04:41:00+00:00',
};

const visual = { type: 'photo', query: 'train' };
const story = (over: Partial<StoryRow> = {}): StoryRow => ({
  id: 's1',
  key: '2026-11-06-fr-1',
  rubric: 'pol',
  position: 1,
  kicker: 'France',
  date_label: '05.11',
  title: 'Sujet',
  summary: 'Résumé',
  visual,
  stats: [],
  quote: null,
  divergences: [],
  prepa: null,
  thread_id: null,
  thread_subtitle: null,
  thread: null,
  ...over,
});
const source = (over: Partial<SourceRow> = {}): SourceRow => ({
  story_id: 's1',
  rubric: 'pol',
  position: 1,
  outlet: 'Euronews',
  title: 'Article',
  url: 'https://www.euronews.com/a',
  lang: 'fr',
  read_full: true,
  published_at: null,
  ...over,
});

describe('lignes Supabase → affichage', () => {
  it('range sujets, sources et brèves par rubrique, dans l’ordre des positions', () => {
    const { value, problems } = editionFromRows({
      edition,
      stories: [story()],
      sources: [source({ position: 2, outlet: 'B' }), source({ position: 1, outlet: 'A' }), source({ story_id: null, rubric: 'dro', outlet: 'Brève' })],
      vocab: [],
    });
    expect(problems).toEqual([]);
    expect(value.sections.map((s) => [s.key, s.stories.length, s.briefs.length])).toEqual([
      ['pol', 1, 0],
      ['dro', 0, 1],
    ]);
    expect(value.sections[0].stories[0].sources.map((s) => s.outlet)).toEqual(['A', 'B']);
    expect(value).toMatchObject({ light: true, hasAudio: false, hasPdf: true, vocab: null });
  });

  it('écarte une source javascript: et un sujet resté sans source', () => {
    const { value, problems } = editionFromRows({ edition, stories: [story()], sources: [source({ url: 'javascript:alert(1)' })], vocab: [] });
    expect(value.sections[0].stories).toEqual([]);
    expect(problems).toHaveLength(2);
  });

  it('écarte un sujet au visuel invalide sans casser l’édition', () => {
    const { value, problems } = editionFromRows({ edition, stories: [story({ visual: { type: 'video' } })], sources: [source()], vocab: [] });
    expect(value.sections[0].stories).toEqual([]);
    expect(problems[0]).toMatch(/2026-11-06-fr-1 ignoré/);
  });

  it('écarte les lignes mal formées', () => {
    const r = parseRows(StoryRowSchema, [story(), { id: 1 }], 'sujet');
    expect(r.value).toHaveLength(1);
    expect(r.problems).toHaveLength(1);
    expect(parseRows(StoryRowSchema, null, 'sujet').problems).toEqual(['sujet : réponse inattendue']);
  });

  it('n’accepte que des URL http(s) et des photos https de upload.wikimedia.org ou thumb.wikimedia.org', () => {
    expect(safeUrl('https://a.fr/x')).toBe('https://a.fr/x');
    expect(safeUrl('data:text/html,x')).toBeNull();
    expect(photoSrc('https://upload.wikimedia.org/wikipedia/commons/a/ab/X.jpg')).toBe('https://upload.wikimedia.org/wikipedia/commons/a/ab/X.jpg');
    expect(photoSrc('https://thumb.wikimedia.org/wikipedia/commons/thumb/a/ab/X.jpg/1920px-X.jpg')).toBe('https://thumb.wikimedia.org/wikipedia/commons/thumb/a/ab/X.jpg/1920px-X.jpg');
    for (const u of ['http://upload.wikimedia.org/a.jpg', 'https://upload.wikimedia.org.evil.fr/a.jpg', 'https://u:p@upload.wikimedia.org/a.jpg', 'https://images.pexels.com/photos/1/a.jpeg', 'https://169.254.169.254/latest']) {
      expect(photoSrc(u), u).toBeNull();
    }
    expect(photoSrc(undefined)).toBeNull();
  });

  it('garde un sujet dont la photo est invalide ou de l’ancienne forme Pexels, sans la photo', () => {
    const good = { provider: 'wikimedia', src: 'https://upload.wikimedia.org/wikipedia/commons/a/ab/X.jpg', width: 1600, height: 1067, author: 'Ana', license: 'CC BY 4.0', pageUrl: 'https://commons.wikimedia.org/wiki/File:X.jpg' };
    const legacy = { id: 1, src: 'https://images.pexels.com/1.jpeg', width: 6, height: 4, photographer: 'Jo', photographerUrl: 'https://www.pexels.com/@jo', pexelsUrl: 'https://www.pexels.com/photo/1/' };
    const visuals = [
      { type: 'photo', query: 'train', photo: { ...good, src: 'https://evil.example/x.jpg' } },
      { type: 'photo', query: 'train', pexels: legacy },
      { type: 'photo', query: 'train', photo: good },
    ];
    const [bad, old, ok] = visuals.map((v) => {
      const { value, problems } = editionFromRows({ edition, stories: [story({ visual: v })], sources: [source()], vocab: [] });
      expect(problems).toEqual([]);
      return value.sections[0].stories[0]?.visual;
    });
    expect(bad).toEqual({ type: 'photo', query: 'train' });
    expect(old).toEqual({ type: 'photo', query: 'train' });
    expect(ok).toEqual({ type: 'photo', query: 'train', photo: good });
  });

  it('construit une frise du plus récent au plus ancien, avec la carte et la première source', () => {
    const t = threadFromRow({
      id: 't1',
      title: 'Midterms 2026',
      lang: 'en',
      status: 'open',
      followed: false,
      thread_events: [
        { date: '2026-11-04', title: 'Avant', text: '', story: null },
        {
          date: '2026-11-06',
          title: 'Après',
          text: 'Suite',
          story: { rubric: 'pol', visual: { type: 'map', caption: 'US', map: { projection: 'albers-usa', places: [] } }, sources: [{ outlet: 'CBS', url: 'https://cbs.com/a', position: 1 }] },
        },
      ],
    });
    expect(t.events.map((e) => e.title)).toEqual(['Après', 'Avant']);
    expect(t.events[0]).toMatchObject({ rubric: 'pol', source: { outlet: 'CBS' }, map: { caption: 'US' } });
    expect(t).toMatchObject({ eventCount: 2, lastDate: '2026-11-06', lastTitle: 'Après' });
  });

  it('fabrique des uuid stables', () => {
    expect(stableUuid('a')).toBe(stableUuid('a'));
    expect(stableUuid('a')).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });
});
