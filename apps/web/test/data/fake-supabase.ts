import type { SupabaseClient } from '@supabase/supabase-js';

/** Appel enregistré : table, puis chaque méthode de la chaîne avec ses arguments. */
export type Call = { table: string; ops: [string, ...unknown[]][] };
export type Responder = (call: Call) => { data: unknown; error: { message: string } | null };

/**
 * Faux client Supabase : enregistre les chaînes `from(t).select(…).eq(…)…` et répond par `respond`.
 * Rien ne sort de la machine. Le stockage enregistre les demandes d'URL signée.
 */
export function fakeSupabase(respond: Responder) {
  const calls: Call[] = [];
  const signed: { bucket: string; path: string; expiresIn: number; options: unknown }[] = [];
  const builder = (table: string) => {
    const call: Call = { table, ops: [] };
    calls.push(call);
    const chain: Record<string, unknown> = {};
    for (const m of ['select', 'eq', 'neq', 'in', 'lte', 'gte', 'order', 'limit', 'update', 'not']) {
      chain[m] = (...args: unknown[]) => {
        call.ops.push([m, ...args]);
        return chain;
      };
    }
    chain.maybeSingle = () => {
      call.ops.push(['maybeSingle']);
      return Promise.resolve(respond(call));
    };
    chain.then = (ok: (v: unknown) => unknown, ko?: (e: unknown) => unknown) => Promise.resolve(respond(call)).then(ok, ko);
    return chain;
  };
  const client = {
    from: builder,
    storage: {
      from: (bucket: string) => ({
        createSignedUrl: async (path: string, expiresIn: number, options?: unknown) => {
          signed.push({ bucket, path, expiresIn, options });
          return { data: { signedUrl: `https://ref.supabase.co/storage/v1/object/sign/${bucket}/${path}?token=t` }, error: null };
        },
      }),
    },
  };
  return { client: client as unknown as SupabaseClient, calls, signed };
}

export const op = (call: Call, name: string) => call.ops.filter((o) => o[0] === name).map((o) => o.slice(1));
