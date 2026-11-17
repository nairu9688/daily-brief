import { describe, expect, it } from 'vitest';
import { isDayFile, looksLikeMp3, looksLikePdf, mp3File, mp3FileName, pdfFile } from '../../publish/files';
import { editionPayload, threadSlug } from '../../publish/rows';
import { fixtureEdition } from '../helpers';
import { MP3_BYTES, PDF_BYTES } from './day';

const META = { pdfPath: '2026-11-06/daily-brief-2026-11-06.pdf', audioPath: null, light: false, generatedAt: '2026-11-06T04:40:00.000Z' };

describe('threadSlug', () => {
  it('langue, puis titre sans accents ni ponctuation', () => {
    expect(threadSlug('fr', 'Épisodes méditerranéens 2026')).toBe('fr-episodes-mediterraneens-2026');
    expect(threadSlug('en', 'Midterms 2026')).toBe('en-midterms-2026');
    expect(threadSlug('fr', 'Midterms 2026')).toBe('fr-midterms-2026');
    expect(threadSlug('es', '  ¿Crisis ferroviaria? — ¡2026!  ')).toBe('es-crisis-ferroviaria-2026');
    expect(threadSlug('fr', 'L’Œuvre de l’été')).toBe('fr-l-oeuvre-de-l-ete');
  });

  it('translittère les ligatures et lettres sans décomposition Unicode (œ, æ, ß, ł)', () => {
    expect(threadSlug('fr', 'Cœur')).toBe('fr-coeur');
    expect(threadSlug('fr', 'ŒUVRE Æther')).toBe('fr-oeuvre-aether');
    expect(threadSlug('en', 'Straße')).toBe('en-strasse');
    expect(threadSlug('es', 'Łódź Wrocław')).toBe('es-lodz-wroclaw');
  });

  it('borne la longueur à 80 caractères, sans tiret final, avec une empreinte du titre complet', () => {
    const slug = threadSlug('fr', `${'a'.repeat(79)} b c`);
    expect(slug).toMatch(/^fr-a{71}-[0-9a-f]{8}$/);
    expect(slug.length).toBe(3 + 80);
    expect(threadSlug('fr', `${'a'.repeat(79)} b c`)).toBe(slug);
    // Un titre qui tient en 80 caractères n'a pas d'empreinte.
    expect(threadSlug('fr', 'a'.repeat(80))).toBe(`fr-${'a'.repeat(80)}`);
    // Coupure juste après un tiret : jamais de double tiret.
    expect(threadSlug('fr', `${'a'.repeat(70)} ${'b'.repeat(30)}`)).toMatch(/^fr-a{70}-[0-9a-f]{8}$/);
  });

  it('deux longs titres qui partagent leurs 80 premiers caractères donnent deux slugs', () => {
    const prefix = 'Réforme des retraites : le calendrier parlementaire et les négociations avec les syndicats';
    const a = threadSlug('fr', `${prefix} jusqu’en 2027`);
    const b = threadSlug('fr', `${prefix} jusqu’en 2028`);
    expect(a).not.toBe(b);
    expect(a.slice(0, -9)).toBe(b.slice(0, -9));
    expect(a).toMatch(/^fr-[a-z0-9-]{71}-[0-9a-f]{8}$/);
  });

  it('donne une empreinte stable à un titre sans caractère latin', () => {
    expect(threadSlug('fr', '東京')).toMatch(/^fr-[0-9a-f]{12}$/);
    expect(threadSlug('fr', '東京')).toBe(threadSlug('fr', '東京'));
    expect(threadSlug('fr', '東京')).not.toBe(threadSlug('fr', '北京'));
  });
});

describe('editionPayload', () => {
  it('édition FR de la fixture : en-tête, sujets numérotés, brèves par rubrique, pas de vocabulaire', () => {
    const ed = fixtureEdition('fr');
    const p = editionPayload(ed, META);
    expect(p.edition).toEqual({
      date: '2026-11-06',
      lang: 'fr',
      region: ed.region,
      headline: ed.headline,
      morningBrief: ed.morningBrief,
      sections: ed.sections.map((s) => ({ key: s.key, title: s.title })),
      vocabTitle: null,
      audioPath: null,
      pdfPath: '2026-11-06/daily-brief-2026-11-06.pdf',
      status: 'published',
      generatedAt: '2026-11-06T04:40:00.000Z',
    });
    expect(p.stories.map((s) => [s.position, s.rubric, s.key])).toEqual([
      [1, 'pol', '2026-11-06-fr-1'],
      [2, 'int', '2026-11-06-fr-2'],
      [3, 'int', '2026-11-06-fr-3'],
      [4, 'env', '2026-11-06-fr-4'],
      [5, 'eco', '2026-11-06-fr-5'],
      [6, 'ent', '2026-11-06-fr-6'],
      [7, 'tec', '2026-11-06-fr-7'],
    ]);
    expect(p.briefs.map((b) => [b.rubric, b.position])).toEqual([
      ['eco', 1],
      ['dro', 1],
      ['spo', 1],
      ['spo', 2],
    ]);
    expect(p.vocab).toEqual([]);
  });

  it('reprend chaque champ du sujet et numérote ses sources', () => {
    const ed = fixtureEdition('fr');
    const st = ed.sections[0].stories[0];
    const s = editionPayload(ed, META).stories[0];
    expect(s).toMatchObject({ kicker: st.kicker, dateLabel: st.date, title: st.title, summary: st.summary, visual: st.visual, stats: st.stats, quote: st.quote, divergences: st.divergences, prepa: st.prepa });
    expect(s.thread).toEqual({ slug: 'fr-mobilisation-sociale-de-l-automne', title: 'Mobilisation sociale de l’automne', subtitle: '4e journée de grève nationale' });
    expect(s.sources.map((x) => x.position)).toEqual(st.sources.map((_, i) => i + 1));
    expect(s.sources[0]).toEqual({ rubric: 'pol', position: 1, outlet: st.sources[0].outlet, title: st.sources[0].title, url: st.sources[0].url, lang: st.sources[0].lang, readFull: st.sources[0].readFull, publishedAt: st.sources[0].publishedAt ?? null });
  });

  it('garde l’id d’un Thread existant et laisse null un sujet sans Thread', () => {
    const ed = fixtureEdition('fr');
    ed.sections[0].stories[0].thread = { id: 'abc', title: 'Titre', subtitle: 'suite' };
    ed.sections[1].stories[0].thread = null;
    const p = editionPayload(ed, META);
    expect(p.stories[0].thread).toEqual({ id: 'abc', slug: 'fr-titre', title: 'Titre', subtitle: 'suite' });
    expect(p.stories[1].thread).toBeNull();
  });

  it('édition EN : six mots numérotés, titre du vocabulaire, statut allégé, chemin audio', () => {
    const ed = fixtureEdition('en');
    const p = editionPayload(ed, { ...META, light: true, audioPath: '2026-11-06/en.mp3' });
    expect(p.edition).toMatchObject({ status: 'light', audioPath: '2026-11-06/en.mp3', vocabTitle: ed.vocab!.title });
    expect(p.vocab.map((v) => v.position)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(p.vocab[0]).toEqual({ position: 1, term: ed.vocab!.items[0].term, pos: ed.vocab!.items[0].pos, translation: ed.vocab!.items[0].translation, example: ed.vocab!.items[0].example, sourceUrl: ed.vocab!.items[0].sourceUrl ?? null });
  });

  it('est déterministe et ne modifie pas l’édition', () => {
    const ed = fixtureEdition('es');
    const before = JSON.stringify(ed);
    expect(JSON.stringify(editionPayload(ed, META))).toBe(JSON.stringify(editionPayload(ed, META)));
    expect(JSON.stringify(ed)).toBe(before);
  });
});

describe('fichiers du jour', () => {
  it('noms lisibles pour Drive, chemins ASCII pour Storage', () => {
    expect(pdfFile('2026-11-06')).toEqual({ name: 'Daily Brief 2026-11-06.pdf', mimeType: 'application/pdf', bucket: 'pdf', path: '2026-11-06/daily-brief-2026-11-06.pdf' });
    expect(mp3File('2026-11-06', 'es')).toEqual({ name: 'Daily Brief 2026-11-06 ES.mp3', mimeType: 'audio/mpeg', bucket: 'audio', path: '2026-11-06/es.mp3' });
    expect(mp3FileName('2026-11-06', 'fr')).toBe('Daily Brief 2026-11-06 FR.mp3');
  });

  it('isDayFile : nom, date, type, bucket et chemin doivent concorder', () => {
    expect(isDayFile(pdfFile('2026-11-06'), '2026-11-06')).toBe(true);
    expect(isDayFile(mp3File('2026-11-06', 'en'), '2026-11-06')).toBe(true);
    expect(isDayFile(pdfFile('2026-11-06'), '2026-11-07')).toBe(false);
    expect(isDayFile({ ...pdfFile('2026-11-06'), path: '2026-11-05/daily-brief-2026-11-05.pdf' }, '2026-11-06')).toBe(false);
    expect(isDayFile({ ...pdfFile('2026-11-06'), bucket: 'audio' }, '2026-11-06')).toBe(false);
    expect(isDayFile({ ...mp3File('2026-11-06', 'en'), mimeType: 'application/pdf' }, '2026-11-06')).toBe(false);
    expect(isDayFile({ ...pdfFile('2026-11-06'), name: 'Daily Brief 2026-11-06 FR.pdf' }, '2026-11-06')).toBe(false);
    expect(isDayFile({ ...pdfFile('2026-11-06'), name: '../secret.pdf' }, '2026-11-06')).toBe(false);
  });

  it('reconnaît un PDF et un MP3 à leurs premiers octets', () => {
    expect(looksLikePdf(PDF_BYTES)).toBe(true);
    expect(looksLikePdf(Buffer.from('<html>erreur</html>'))).toBe(false);
    expect(looksLikeMp3(MP3_BYTES)).toBe(true);
    expect(looksLikeMp3(Buffer.from([0xff, 0xfb, 0x90, 0x00]))).toBe(true);
    expect(looksLikeMp3(PDF_BYTES)).toBe(false);
    expect(looksLikeMp3(Buffer.alloc(0))).toBe(false);
  });

  it('MP3 : refuse les en-têtes de trame réservés (ADTS AAC, version, couche, débit, fréquence)', () => {
    expect(looksLikeMp3(Buffer.from([0xff, 0xf1, 0x50, 0x80]))).toBe(false); // ADTS AAC : couche 00
    expect(looksLikeMp3(Buffer.from([0xff, 0xff, 0xff, 0xff]))).toBe(false); // débit 1111, fréquence 11
    expect(looksLikeMp3(Buffer.from([0xff, 0xe9, 0x90, 0x00]))).toBe(false); // version 01 réservée
    expect(looksLikeMp3(Buffer.from([0xff, 0xfb, 0xf0, 0x00]))).toBe(false); // débit 1111
    expect(looksLikeMp3(Buffer.from([0xff, 0xfb, 0x9c, 0x00]))).toBe(false); // fréquence 11
    expect(looksLikeMp3(Buffer.from([0xff, 0xfb, 0x90, 0x64]))).toBe(true); // MPEG-1 couche III, 128 kb/s, 44,1 kHz
    expect(looksLikeMp3(Buffer.from([0xff, 0xf3, 0x90, 0x64]))).toBe(true); // MPEG-2 couche III
    expect(looksLikeMp3(Buffer.from('ID3\x04\x00\x00\x00\x00\x00\x0a'))).toBe(true);
  });

  it('PDF : exige %%EOF dans le dernier kilooctet', () => {
    const body = Buffer.from('%PDF-1.7\n' + 'x'.repeat(5000) + '\n');
    expect(looksLikePdf(body)).toBe(false);
    expect(looksLikePdf(Buffer.concat([body, Buffer.from('%%EOF\n')]))).toBe(true);
    expect(looksLikePdf(Buffer.concat([Buffer.from('%PDF-1.7\n%%EOF\n'), Buffer.from('y'.repeat(2000))]))).toBe(false);
    expect(looksLikePdf(Buffer.from('%PDF-1.7\nx'.repeat(1)))).toBe(false);
  });
});
