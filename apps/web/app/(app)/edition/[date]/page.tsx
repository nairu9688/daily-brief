import { cookies } from 'next/headers';
import { notFound } from 'next/navigation';
import { LANGS } from '@daily-brief/schema';
import { EditionScreen } from '@/components/EditionScreen';
import { currentUser } from '@/lib/auth';
import { getDataSource } from '@/lib/data';
import { isIsoDate } from '@/lib/dates';
import { chosenLang, EDITION_COOKIE } from '@/lib/edition-choice';

/** Édition archivée : la langue choisie, sinon la première langue publiée ce jour-là. */
export default async function EditionPage({ params }: { params: Promise<{ date: string }> }) {
  const { date } = await params;
  if (!isIsoDate(date)) notFound();
  const lang = chosenLang((await cookies()).get(EDITION_COOKIE)?.value);
  const ds = await getDataSource();
  const editable = (await currentUser()) !== null;
  for (const l of [lang, ...LANGS.filter((x) => x !== lang)]) {
    const edition = await ds.edition(date, l);
    if (edition) return <EditionScreen edition={edition} basePath={`/edition/${date}`} editable={editable} />;
  }
  notFound();
}
