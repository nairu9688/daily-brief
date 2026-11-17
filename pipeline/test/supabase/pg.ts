import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { repoPath } from '../helpers';

export const MIGRATIONS_DIR = repoPath('supabase/migrations');
export const ALLOWED_EMAIL = 'nanigeek@gmail.com';

export type TestDb = PGlite;
export type Role = 'service_role' | 'anon' | { email: string | null };
type Tx = Pick<PGlite, 'query' | 'exec'>;

/** Migrations du dépôt, dans l'ordre de leur nom (0001, 0002, …). */
export function migrationFiles(): string[] {
  return readdirSync(MIGRATIONS_DIR)
    .filter((f) => /^\d{4}_[a-z0-9_]+\.sql$/.test(f))
    .sort();
}

/** Applique toutes les migrations du dépôt (rejouable). */
export async function applyMigrations(db: TestDb): Promise<void> {
  for (const f of migrationFiles()) await db.exec(readFileSync(join(MIGRATIONS_DIR, f), 'utf8'));
}

/** Postgres embarqué (PGlite) avec le prélude Supabase simulé, puis les migrations du dépôt. */
export async function createTestDb(): Promise<TestDb> {
  const db = new PGlite();
  await db.exec(readFileSync(repoPath('pipeline/test/supabase/prelude.sql'), 'utf8'));
  await applyMigrations(db);
  return db;
}

/** Vide toutes les tables entre deux tests (les buckets et les réglages restent). */
export async function resetData(db: TestDb): Promise<void> {
  await db.exec('truncate public.editions, public.threads, public.runs, public.drive_pending cascade');
}

/**
 * Exécute `fn` dans une transaction sous un rôle Supabase, comme PostgREST : `service_role` (clé
 * service), `anon`, ou `authenticated` avec l'email du jeton. Le rôle ne sort jamais de la
 * transaction (`set local`), et la transaction est annulée si `fn` lève.
 */
export async function asRole<T>(db: TestDb, role: Role, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return db.transaction(async (tx) => {
    const name = typeof role === 'string' ? role : 'authenticated';
    const claims = typeof role === 'string' ? { role: name } : { role: name, ...(role.email === null ? {} : { email: role.email }) };
    await tx.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify(claims)]);
    await tx.exec(`set local role ${name}`);
    return fn(tx as unknown as Tx);
  }) as Promise<T>;
}

/** Appelle une fonction SQL de `public` avec des arguments nommés (rôle `service_role` par défaut). */
export async function rpc<T = unknown>(db: TestDb, fn: string, args: Record<string, unknown> = {}, role: Role = 'service_role'): Promise<T> {
  if (!/^[a-z_]+$/.test(fn)) throw new Error(`nom de fonction invalide : ${fn}`);
  const names = Object.keys(args);
  for (const n of names) if (!/^[a-z_]+$/.test(n)) throw new Error(`nom d’argument invalide : ${n}`);
  const params = names.map((n) => {
    const v = args[n];
    return v === null || v === undefined ? null : typeof v === 'object' ? JSON.stringify(v) : String(v);
  });
  const sql = `select public.${fn}(${names.map((n, i) => `${n} => $${i + 1}`).join(', ')}) as result`;
  return asRole(db, role, async (tx) => (await tx.query<{ result: T }>(sql, params)).rows[0].result);
}

/** Lignes d'une requête lancée en superutilisateur (hors RLS) : pour les vérifications des tests. */
export async function rows<T = Record<string, unknown>>(db: TestDb, sql: string, params: unknown[] = []): Promise<T[]> {
  return (await db.query<T>(sql, params)).rows;
}
