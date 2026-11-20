import { getDataSource } from '@/lib/data';
import { isIsoDate } from '@/lib/dates';
import { isLang } from '@/lib/edition-choice';
import { fileResponse } from '@/lib/file-response';

/**
 * MP3 d'une édition : URL signée de 10 minutes (consigne du lot 5), créée avec la clé publique et la
 * session s'il y en a une. Lecture publique (0005) : pas de connexion requise.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ date: string; lang: string }> }) {
  const { date, lang } = await params;
  if (!isIsoDate(date) || !isLang(lang)) return fileResponse(null);
  return fileResponse(await (await getDataSource()).audio(date, lang));
}
