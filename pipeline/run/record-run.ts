import { messageOf } from '../collect/http';
import { redactText, stripSecrets } from '../lib/redact';
import { summarizeReports } from '../publish/run-summary';
import { Ack, createSupabaseClient, type SupabaseFetch } from '../supabase/client';
import { supabaseConfig } from '../supabase/config';

export type RecordRunOptions = {
  dayDir: string;
  date: string;
  /** Message final de la routine, gardé dans `runs.notes`. */
  message: string;
  env: Record<string, string | undefined>;
  fetch: SupabaseFetch;
  timeoutMs?: number;
};

/**
 * `brief:notify --record` : quand la routine s'arrête avant `brief:finish` (collecte en code 2),
 * écrit la ligne `runs` du jour en `failed`, avec le bilan des rapports présents et le message
 * final. Sans cette ligne, la page Santé garderait la ligne `running` de `brief:context` jusqu'à ce
 * qu'elle passe « interrompu ». Sans variables Supabase (arrêt à `env:check`), rien n'est écrit.
 * Jamais d'exception : `saved` dit si la ligne est écrite, `error` pourquoi (sans secret).
 */
export async function recordRun(o: RecordRunOptions): Promise<{ saved: boolean; error?: string }> {
  const secrets = [o.env.SUPABASE_SERVICE_ROLE_KEY, o.env.SUPABASE_URL];
  const sb = supabaseConfig(o.env);
  if (!sb.ok) return { saved: false, error: sb.error };
  try {
    const { steps } = summarizeReports(o.dayDir, o.date);
    const client = createSupabaseClient(sb.config, o.fetch, { signal: AbortSignal.timeout(o.timeoutMs ?? 30_000) });
    await client.rpc('save_run', { p_date: o.date, p_status: 'failed', p_steps: JSON.parse(stripSecrets(JSON.stringify(steps), secrets)), p_notes: stripSecrets(o.message, secrets) }, Ack);
    return { saved: true };
  } catch (e) {
    return { saved: false, error: redactText(messageOf(e), secrets) };
  }
}
