import { currentUser } from '@/lib/auth';
import { getDataSource } from '@/lib/data';
import { isIsoDate } from '@/lib/dates';
import { isLang } from '@/lib/edition-choice';
import { fileResponse, unauthorized } from '@/lib/file-response';

/** MP3 d'une édition : URL signée de 10 minutes créée avec la session (consigne du lot 5). */
export async function GET(_request: Request, { params }: { params: Promise<{ date: string; lang: string }> }) {
  const { date, lang } = await params;
  if (!isIsoDate(date) || !isLang(lang)) return fileResponse(null);
  if (!(await currentUser())) return unauthorized();
  return fileResponse(await (await getDataSource()).audio(date, lang));
}
