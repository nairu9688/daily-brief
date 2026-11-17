import type { Lang } from '@daily-brief/schema';
import { editionPayload } from '../../../../pipeline/publish/rows';
import { fixtureBrief } from '../../../../pipeline/test/helpers';
import { ALLOWED_EMAIL, asRole, rpc, type TestDb } from '../../../../pipeline/test/supabase/pg';

/** Publie les trois éditions de la fixture avec la vraie fonction `publish_edition` (clé service). */
export async function publishFixture(db: TestDb, meta: { light?: Lang[]; audio?: Lang[] } = {}): Promise<void> {
  for (const ed of fixtureBrief().editions) {
    const payload = editionPayload(ed, {
      pdfPath: `${ed.date}/daily-brief-${ed.date}.pdf`,
      audioPath: meta.audio?.includes(ed.lang) ? `${ed.date}/${ed.lang}.mp3` : null,
      light: meta.light?.includes(ed.lang) ?? false,
      generatedAt: '2026-11-06T04:41:00Z',
    });
    await rpc(db, 'publish_edition', { payload });
  }
}

/** Requête lancée comme l'utilisateur autorisé (RLS active), chaque ligne en JSON comme PostgREST. */
export async function asUserJson<T = Record<string, unknown>>(db: TestDb, sql: string, params: unknown[] = []): Promise<T[]> {
  return asRole(db, { email: ALLOWED_EMAIL }, async (tx) => (await tx.query<{ j: T }>(sql, params)).rows.map((r) => r.j));
}

/**
 * Lignes d'une édition, de la forme que renvoient les `select` de lib/data/supabase.ts :
 * stories avec `thread:threads(id,title)` embarqué.
 */
export async function editionRows(db: TestDb, date: string, lang: Lang) {
  const [edition] = await asUserJson(db, `select to_jsonb(e) - 'published_at' as j from public.editions e where date = $1 and lang = $2`, [date, lang]);
  const id = (edition as { id: string }).id;
  const stories = await asUserJson(
    db,
    `select to_jsonb(s) || jsonb_build_object('thread', (select jsonb_build_object('id', t.id, 'title', t.title) from public.threads t where t.id = s.thread_id)) as j
     from public.stories s where edition_id = $1 order by position`,
    [id],
  );
  const sources = await asUserJson(db, `select to_jsonb(x) - 'id' - 'edition_id' as j from public.sources x where edition_id = $1 order by position`, [id]);
  const vocab = await asUserJson(db, `select to_jsonb(v) - 'edition_id' - 'lang' as j from public.vocab_items v where edition_id = $1 order by position`, [id]);
  return { edition, stories, sources, vocab };
}
