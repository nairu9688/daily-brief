import { rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadPublishInputs, MAX_JSON_BYTES, MAX_PDF_BYTES } from '../../publish/inputs';
import { DAY, editionFor, makeDay, MP3_BYTES, PDF_BYTES, RENDERED_AT } from './day';

describe('loadPublishInputs', () => {
  it('lit les éditions annoncées, le PDF et les MP3 présents', () => {
    const { dayDir } = makeDay({ audio: ['fr', 'es'] });
    const r = loadPublishInputs(dayDir, DAY);
    expect(r.issues).toEqual([]);
    expect(r.renderedAt).toBe(RENDERED_AT);
    expect(r.editions.map((e) => e.lang)).toEqual(['fr', 'en', 'es']);
    expect(r.pdf).toEqual({ name: 'Daily Brief 2026-11-06.pdf', mimeType: 'application/pdf', bucket: 'pdf', path: '2026-11-06/daily-brief-2026-11-06.pdf', bytes: PDF_BYTES });
    expect(r.audio.map((a) => [a.lang, a.name, a.path])).toEqual([
      ['fr', 'Daily Brief 2026-11-06 FR.mp3', '2026-11-06/fr.mp3'],
      ['es', 'Daily Brief 2026-11-06 ES.mp3', '2026-11-06/es.mp3'],
    ]);
    expect(r.audio[0].bytes).toEqual(MP3_BYTES);
  });

  it('ne lit que les langues de finals, dans l’ordre FR, EN, ES', () => {
    const { dayDir } = makeDay({ finals: ['es', 'fr'] });
    const r = loadPublishInputs(dayDir, DAY);
    expect(r.editions.map((e) => e.lang)).toEqual(['fr', 'es']);
    expect(r.issues).toEqual([]);
  });

  it('sans render-report.json : erreur, rien à publier', () => {
    const { dayDir } = makeDay();
    rmSync(join(dayDir, 'render-report.json'));
    expect(loadPublishInputs(dayDir, DAY)).toEqual({ editions: [], pdf: null, audio: [], renderedAt: null, issues: [{ level: 'error', message: 'render-report.json absent : rien à publier (lancer brief:render)' }] });
  });

  it.each([
    ['{ pas du json', /^render-report\.json illisible : /],
    ['{"date":"2026-11-06","finals":["fr","de"],"pdf":null,"generatedAt":"hier"}', /^render-report\.json illisible : 2 champs invalides$/],
    ['[]', /^render-report\.json illisible : 1 champs invalides$/],
  ])('render-report.json malformé : erreur, pas de plantage', (text, expected) => {
    const { dayDir } = makeDay();
    writeFileSync(join(dayDir, 'render-report.json'), text);
    const r = loadPublishInputs(dayDir, DAY);
    expect(r.editions).toEqual([]);
    expect(r.pdf).toBeNull();
    expect(r.issues).toHaveLength(1);
    expect(r.issues[0].level).toBe('error');
    expect(r.issues[0].message).toMatch(expected);
  });

  it('refuse le rapport d’une autre date', () => {
    const { dayDir } = makeDay({ date: '2026-11-05' });
    const r = loadPublishInputs(dayDir, DAY);
    expect(r.editions).toEqual([]);
    expect(r.issues).toEqual([{ level: 'error', message: 'render-report.json est celui du 2026-11-05 (attendu : 2026-11-06) : rien à publier' }]);
  });

  it('édition absente, illisible, invalide ou d’un autre jour : erreur par édition, les autres restent', () => {
    const { dayDir } = makeDay();
    rmSync(join(dayDir, 'fr.final.json'));
    writeFileSync(join(dayDir, 'en.final.json'), JSON.stringify(editionFor('en', '2026-11-05')));
    const r = loadPublishInputs(dayDir, DAY);
    expect(r.editions.map((e) => e.lang)).toEqual(['es']);
    expect(r.issues).toEqual([
      { level: 'error', lang: 'fr', message: 'fr.final.json absent alors que le rendu l’annonce : édition non publiée' },
      { level: 'error', lang: 'en', message: 'en.final.json contient l’édition en du 2026-11-05 (attendu : en, 2026-11-06) : édition non publiée' },
    ]);
    writeFileSync(join(dayDir, 'en.final.json'), JSON.stringify(editionFor('es')));
    writeFileSync(join(dayDir, 'es.final.json'), '{"date":"2026-11-06"');
    writeFileSync(join(dayDir, 'fr.final.json'), JSON.stringify({ ...editionFor('fr'), headline: '', inconnu: 1 }));
    const again = loadPublishInputs(dayDir, DAY);
    expect(again.editions).toEqual([]);
    expect(again.issues.map((i) => [i.lang, i.message.split(' : ')[0]])).toEqual([
      ['fr', 'fr.final.json invalide (1 erreur)'],
      ['en', 'en.final.json contient l’édition es du 2026-11-06 (attendu'],
      ['es', 'es.final.json illisible'],
    ]);
  });

  it('refuse un PDF tronqué (sans %%EOF)', () => {
    const { dayDir } = makeDay({ pdf: Buffer.from('%PDF-1.7\nfaux PDF coupé') });
    const r = loadPublishInputs(dayDir, DAY);
    expect(r.pdf).toBeNull();
    expect(r.issues).toEqual([{ level: 'error', message: 'Daily Brief 2026-11-06.pdf : ce n’est pas un PDF — non publié' }]);
  });

  it('plafonne la lecture de render-report.json et des éditions à 5 Mo', () => {
    expect(MAX_JSON_BYTES).toBe(5 * 1024 * 1024);
    const big = ' '.repeat(MAX_JSON_BYTES + 1);
    const a = makeDay().dayDir;
    writeFileSync(join(a, 'render-report.json'), big);
    const ra = loadPublishInputs(a, DAY);
    expect(ra.editions).toEqual([]);
    expect(ra.issues).toHaveLength(1);
    expect(ra.issues[0].message).toMatch(/^render-report\.json illisible : fichier trop lourd/);
    const b = makeDay().dayDir;
    writeFileSync(join(b, 'en.final.json'), big);
    const rb = loadPublishInputs(b, DAY);
    expect(rb.editions.map((e) => e.lang)).toEqual(['fr', 'es']);
    expect(rb.issues).toEqual([{ level: 'error', lang: 'en', message: expect.stringMatching(/^en\.final\.json illisible : fichier trop lourd/) }]);
  });

  it('finals vide : erreur', () => {
    const { dayDir } = makeDay({ finals: [] });
    expect(loadPublishInputs(dayDir, DAY).issues).toContainEqual({ level: 'error', message: 'le rendu n’annonce aucune édition (finals vide) : rien à publier' });
  });

  it('sans PDF au rapport : avertissement, les éditions restent publiables', () => {
    const { dayDir } = makeDay({ pdf: null });
    const r = loadPublishInputs(dayDir, DAY);
    expect(r.editions).toHaveLength(3);
    expect(r.pdf).toBeNull();
    expect(r.issues).toEqual([{ level: 'warning', message: 'le rendu n’a pas produit de PDF : éditions publiées sans PDF' }]);
  });

  it('PDF d’un autre nom, absent, vide, trop lourd ou qui n’en est pas un : non publié', () => {
    const named = loadPublishInputs(makeDay({ pdfName: 'Daily Brief 2026-11-05.pdf' }).dayDir, DAY);
    expect(named.pdf).toBeNull();
    expect(named.issues).toEqual([{ level: 'error', message: 'PDF inattendu « Daily Brief 2026-11-05.pdf » (attendu : Daily Brief 2026-11-06.pdf) : non publié' }]);
    expect(loadPublishInputs(makeDay({ pdfName: '../../etc/passwd' }).dayDir, DAY).pdf).toBeNull();

    const cases: [Buffer | null, string][] = [
      [null, 'Daily Brief 2026-11-06.pdf : absent alors que le rendu l’annonce — non publié'],
      [Buffer.alloc(0), 'Daily Brief 2026-11-06.pdf : fichier vide — non publié'],
      [Buffer.from('<html>Erreur 500</html>'), 'Daily Brief 2026-11-06.pdf : ce n’est pas un PDF — non publié'],
      [Buffer.concat([PDF_BYTES, Buffer.alloc(MAX_PDF_BYTES)]), `Daily Brief 2026-11-06.pdf : fichier trop lourd (${PDF_BYTES.length + MAX_PDF_BYTES} octets, ${MAX_PDF_BYTES} au plus) — non publié`],
    ];
    for (const [bytes, message] of cases) {
      const { dayDir } = makeDay({ pdfName: 'Daily Brief 2026-11-06.pdf', pdf: null });
      if (bytes) writeFileSync(join(dayDir, 'Daily Brief 2026-11-06.pdf'), bytes);
      const r = loadPublishInputs(dayDir, DAY);
      expect(r.pdf).toBeNull();
      expect(r.issues).toEqual([{ level: 'error', message }]);
      expect(r.editions).toHaveLength(3);
    }
  });

  it('MP3 qui n’en est pas un : avertissement, édition sans lecteur ; MP3 d’une édition non publiable ignoré', () => {
    const { dayDir } = makeDay({ audio: ['fr', 'en'], finals: ['fr', 'es'] });
    writeFileSync(join(dayDir, 'Daily Brief 2026-11-06 FR.mp3'), 'pas un mp3');
    const r = loadPublishInputs(dayDir, DAY);
    expect(r.audio).toEqual([]);
    expect(r.issues).toEqual([{ level: 'warning', lang: 'fr', message: 'Daily Brief 2026-11-06 FR.mp3 : ce n’est pas un MP3 — édition publiée sans lecteur' }]);
  });
});
