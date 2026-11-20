import { getDataSource } from '@/lib/data';
import { isIsoDate } from '@/lib/dates';
import { fileResponse } from '@/lib/file-response';

/**
 * PDF du jour : URL signée de 10 minutes, en téléchargement (« Daily Brief AAAA-MM-JJ.pdf »). Lecture
 * publique (0005) : pas de connexion requise.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ date: string }> }) {
  const { date } = await params;
  if (!isIsoDate(date)) return fileResponse(null);
  return fileResponse(await (await getDataSource()).pdf(date));
}
