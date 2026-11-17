import { currentUser } from '@/lib/auth';
import { getDataSource } from '@/lib/data';
import { isIsoDate } from '@/lib/dates';
import { fileResponse, unauthorized } from '@/lib/file-response';

/** PDF du jour : URL signée de 10 minutes, en téléchargement (« Daily Brief AAAA-MM-JJ.pdf »). */
export async function GET(_request: Request, { params }: { params: Promise<{ date: string }> }) {
  const { date } = await params;
  if (!isIsoDate(date)) return fileResponse(null);
  if (!(await currentUser())) return unauthorized();
  return fileResponse(await (await getDataSource()).pdf(date));
}
