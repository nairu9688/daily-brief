// @vitest-environment node
import { beforeEach, describe, expect, it } from 'vitest';
import { FixtureDataSource, nodeDate, resetFixtureState, silentMp3 } from '@/lib/data/fixture';

const ds = () => new FixtureDataSource({ today: '2026-11-06' });

beforeEach(() => resetFixtureState());

describe('source de données du mode fixture', () => {
  it('rend les trois éditions de la fixture, et rien pour une autre date', async () => {
    const fr = await ds().edition('2026-11-06', 'fr');
    expect(fr?.headline).toBe('La rue pousse Lecornu à négocier, le Sud-Est sous l’eau');
    expect(fr?.sections.map((s) => s.key)).toEqual(['pol', 'int', 'env', 'eco', 'ent', 'dro', 'tec', 'spo']);
    expect(fr).toMatchObject({ hasAudio: true, hasPdf: false, light: false, vocab: null });
    expect((await ds().edition('2026-11-06', 'es'))?.hasAudio).toBe(false);
    expect(await ds().edition('2026-11-05', 'fr')).toBeNull();
  });

  it('marque une édition allégée sur demande', async () => {
    const light = new FixtureDataSource({ today: '2026-11-06', light: ['es'] });
    expect((await light.edition('2026-11-06', 'es'))?.light).toBe(true);
    expect(await light.days('2026-11-01', '2026-11-30')).toEqual([{ date: '2026-11-06', langs: ['fr', 'en', 'es'], light: ['es'] }]);
  });

  it('trouve la dernière date publiée jusqu’à une date donnée', async () => {
    expect(await ds().latestDate('fr', '2026-11-07')).toBe('2026-11-06');
    expect(await ds().latestDate('fr', '2026-11-05')).toBeNull();
  });

  it('lit les dates des épisodes passés', () => {
    expect(nodeDate('Mar 20 oct', '2026')).toBe('2026-10-20');
    expect(nodeDate('Wed 04 Nov', '2026')).toBe('2026-11-04');
    expect(nodeDate('Dom 18 ene', '2026')).toBe('2026-01-18');
    expect(nodeDate('À suivre', '2026')).toBeNull();
  });

  it('construit les Threads du jour avec leurs épisodes passés', async () => {
    const list = await ds().threads();
    expect(list.map((t) => `${t.lang}:${t.title}`).sort()).toEqual([
      'en:Midterms 2026',
      'es:Crisis ferroviaria 2026',
      'fr:Guerre en Ukraine',
      'fr:Midterms 2026',
      'fr:Mobilisation sociale de l’automne',
      'fr:Épisodes méditerranéens 2026',
    ]);
    const floods = list.find((t) => t.title === 'Épisodes méditerranéens 2026')!;
    const detail = await ds().thread(floods.id);
    expect(detail?.events.map((e) => e.date)).toEqual(['2026-11-06', '2026-10-20']);
    expect(detail?.events[0].map?.spec.projection).toBe('conic-france');
    expect(await ds().thread('inconnu')).toBeNull();
  });

  it('garde en mémoire mots cochés, file Anki et Threads suivis', async () => {
    const words = await ds().vocab({ lang: 'en' });
    expect(words).toHaveLength(6);
    expect(await ds().setSelected([words[0].id, 'inconnu'], true)).toBe(1);
    expect(await ds().queueAnki([words[1].id])).toBe(1);
    expect(await ds().queueAnki([words[1].id])).toBe(0);
    const after = await ds().vocab({ selected: true });
    expect(after.map((w) => [w.term, w.ankiStatus])).toEqual([
      [words[0].term, 'none'],
      [words[1].term, 'queued'],
    ]);
    const [t] = await ds().threads();
    expect(await ds().setFollowed(t.id, true)).toBe(1);
    expect((await ds().thread(t.id))?.followed).toBe(true);
    expect(await ds().setFollowed('inconnu', true)).toBe(0);
  });

  it('sert un MP3 silencieux pour FR et EN, rien pour ES ni pour le PDF', async () => {
    const audio = await ds().audio('2026-11-06', 'fr');
    expect(audio?.kind).toBe('bytes');
    expect(await ds().audio('2026-11-06', 'es')).toBeNull();
    expect(await ds().pdf()).toBeNull();
    const mp3 = silentMp3(3);
    expect([...mp3.slice(0, 4)]).toEqual([0xff, 0xf3, 0x44, 0xc4]);
    expect(mp3.length).toBe(125 * 96);
  });

  it('fournit trois passages : réussi, dégradé, interrompu', async () => {
    expect((await ds().runs(10)).map((r) => r.status)).toEqual(['ok', 'degraded', 'running']);
  });
});
