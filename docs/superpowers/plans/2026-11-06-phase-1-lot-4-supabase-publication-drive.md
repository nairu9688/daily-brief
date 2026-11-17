# Lot 4 — Supabase, publication et Drive : plan d'implémentation

> **Pour les agents :** sous-skill requis : superpowers:subagent-driven-development (recommandé) ou superpowers:executing-plans, tâche par tâche. Les étapes utilisent des cases à cocher (`- [ ]`) pour le suivi.

**Objectif :** poser la base Supabase du Daily Brief (tables, RLS, buckets, fonctions), brancher `brief:context` sur cette base, puis livrer `npm run brief:publish`. Cette commande publie les éditions du jour dans Supabase, dépose le PDF et les MP3 dans Storage puis dans Google Drive (par Apps Script), met en attente ce qui échoue et écrit le bilan du passage dans `runs`. Spec : §5, §6.2, §6.3, §10, §12, §13 et §14.

**Architecture :** quatre couches.
- **Base.** `supabase/migrations/` : tables et RLS (`0001_init.sql`), puis les fonctions SQL appelées par le pipeline (`0002` à `0004`). La publication d'une édition est une seule fonction, `publish_edition(jsonb)`, donc une seule transaction.
- **Client.** `pipeline/supabase/` : un client REST minimal (PostgREST `rpc` et API Storage) sur le transport borné du lot 3, avec délai, signal, disjoncteur et masquage de la clé.
- **Contexte.** `pipeline/context/supabase-store.ts` implémente `ContextStore` ; `select-store.ts` le choisit, ou sort avec le code 2 sans configuration (`--allow-empty` en local).
- **Publication.** `pipeline/publish/` : lecture contrôlée des sorties du rendu, lignes d'une édition (fonction pure), Storage, client Drive avec suivi manuel du 302, dépôts en attente, purge des MP3, bilan `runs`, orchestration et CLI. `apps-script/Code.gs` reçoit les fichiers côté Google.

Aucun test n'appelle Supabase, Google ni Internet. La base est un vrai Postgres embarqué (PGlite) qui exécute les migrations, la RLS et les fonctions ; PostgREST est simulé par un faux `fetch` qui appelle ces fonctions ; Apps Script est simulé par un serveur HTTP local qui exécute le vrai `Code.gs` avec de faux services Google.

**Pile :** `@electric-sql/pglite` 0.5.16 (Postgres 18 en WebAssembly, tests seulement, version figée), `fetch` de Node 22, zod 4 (validation de toute réponse externe), `node:vm` (évaluation de `Code.gs`), `node:http` (faux Apps Script). Aucune dépendance d'exécution nouvelle : pas de `@supabase/supabase-js`.

**Feuille de route :** `docs/superpowers/plans/2026-11-06-phase-1-roadmap.md` (lot 4 et §5 « Consignes issues du lot 3 »). **Spec :** `docs/specs/2026-11-06-daily-brief-design.md`.

---

## Contexte pour l'exécutant

- **Point de départ.** Les lots 1 à 3 sont en place. Sur `HEAD` (`5bd7b34`), `npm test` donne `Test Files  53 passed (53)` et `Tests  463 passed (463)`, et `npm run typecheck` ne sort rien. Les utilitaires partagés sont dans `pipeline/lib` : `loadEnv` (`env.ts`), `writeAtomic` (`fs.ts`), `redactText` et `stripSecrets` (`redact.ts`). Ce lot les réutilise et ne les modifie pas.
- **Fichiers existants modifiés, et seulement ceux-là :**
  - `pipeline/context/select-store.ts` et `pipeline/context/cli.ts` (tâche 4) ;
  - `pipeline/test/context/cli.test.ts` et `pipeline/test/context/run-context.test.ts` (tâche 4) ;
  - `pipeline/test/run-cli.ts` et `package.json` (tâches 1 et 13) ;
  - `README.md` et la feuille de route (tâche 14).
- **Fichiers à ne pas modifier :** `packages/schema/` (le format `Edition` est le contrat), `pipeline/context/store.ts`, `run-context.ts`, `memory-store.ts` et `stale.ts`, `pipeline/collect/`, `pipeline/render/` et `pipeline/lib/`.
- **Consignes du lot 3, toutes tenues :**
  - **Sans configuration.** L'absence de `SUPABASE_URL` ou de `SUPABASE_SERVICE_ROLE_KEY` donne le code 2 ; `--allow-empty` donne un contexte vide en local (tâche 4).
  - **`updated_at`.** Il arrive en ISO avec `T` et `Z`, formaté par la fonction SQL `context_open_threads` (tâche 3).
  - **Annulation.** L'`AbortSignal` de chaque méthode du store est passé à la requête HTTP : c'est l'équivalent de `.abortSignal(signal)` de supabase-js (tâches 2 et 3).
  - **Fermeture.** Elle tient en une seule instruction SQL : `UPDATE … RETURNING` dans un CTE, qui note aussi les Threads fermés dans `runs.steps.closedThreads` (tâche 3).
  - **`anomalies()`.** Implémenté, il n'est jamais bloquant (tâche 3).
  - **Dates.** `thread_events.date` est de type `date` (tâche 1).
  - **Publication.** Elle s'appuie sur `finals` de `render-report.json` (tâche 6).
- **Leçons des revues des lots 1 à 3, appliquées dès le départ :**
  - **Réseau.** Chaque appel a un délai et un `AbortSignal`. Le disjoncteur coupe sur 401, 402, 403, 429, sur un délai dépassé et après 3 échecs consécutifs. Une échéance globale borne `brief:publish` (15 min).
  - **Secrets.** Aucun secret dans un message, un rapport, `runs` ou `drive_pending` : la clé de service, le jeton Apps Script et l'URL de l'application web sont masqués, et des tests le vérifient.
  - **Entrées.** Toute réponse externe est validée par zod. Une entrée mal formée devient un problème du rapport, jamais une exception. Chaque fichier est contrôlé contre son nom, sa date et ses premiers octets avant d'être publié.
  - **Sorties.** L'ancien rapport est supprimé d'abord. Le rapport est toujours écrit, de façon atomique (`writeAtomic`). Relancer une date remplace proprement ses données.
  - **Code.** Les sorties sont déterministes, et chaque fichier a une responsabilité.
- **Réseau et clés.** Aucune clé n'est disponible ni à demander, et aucun projet Supabase n'existe encore : Naïm le crée en suivant `docs/setup-supabase.md` (tâche 14). Les tests de CLI tournent dans un dossier vide, sans variables secrètes (`pipeline/test/run-cli.ts`). Quand ils ont besoin d'un serveur injoignable, ils visent `http://127.0.0.1:9`, ce qui ne sort jamais de la machine.
- **Commandes.** Elles se lancent depuis la racine du dépôt. Un échec « Cannot find module … », « Failed to load url … » ou « ENOENT … supabase/migrations » signifie que le module ou le dossier n'existe pas encore : c'est l'échec attendu de l'étape « vérifier l'échec ». Les tests PGlite démarrent une base en 1 à 2 s par fichier de test.

### Décisions de conception

1. **Couche client : REST sur `fetch`, sans supabase-js.**
   - **Dépendance.** Le pipeline n'appelle que des fonctions SQL (`POST /rest/v1/rpc/<fn>`) et trois routes Storage (envoi, lecture, suppression). Un client de 200 lignes suffit, sans dépendance d'exécution.
   - **Transport.** Il reprend le transport du lot 3 (`HttpResponse`, `readCapped`, `deadline`, `Breaker`, `messageOf`) : chaque appel a son délai, un signal combiné (appel, échéance globale) et une lecture bornée en taille.
   - **Tests.** Un faux `fetch` suffit. Avec supabase-js, il aurait fallu injecter un `fetch` personnalisé de toute façon pour borner les délais et masquer les erreurs, et le simuler à travers la couche PostgREST de la bibliothèque.
   - **Erreurs.** Une erreur SQL (400 avec un code Postgres) ne compte pas pour le disjoncteur : elle ne dit rien de la santé du service. Les 5xx, les délais et les refus de clé comptent.
2. **RLS : email autorisé dans une table privée.**
   - **Où.** `private.app_settings(key, value)`, dans un schéma que PostgREST n'expose pas. La fonction `private.is_allowed_user()` (`security definer`, `search_path = ''`) compare `auth.jwt() ->> 'email'` à cette valeur, sans casse ni espaces.
   - **Pourquoi pas `current_setting`.** `current_setting('app.allowed_email')` demande un `ALTER DATABASE … SET`, que Supabase hébergé ne permet pas toujours et que les dumps ne gardent pas. La table se modifie en une ligne de SQL, prend effet aussitôt et se teste hors ligne.
   - **Lecture.** Chaque table a une seule politique de lecture, `to authenticated using ((select private.is_allowed_user()))` ; le `select` permet à Postgres de n'évaluer la fonction qu'une fois par requête.
   - **Écriture.** Les droits de table sont retirés à `anon` et `authenticated`, qui gardent seulement `select`. La clé de service (`service_role`, qui contourne la RLS) écrit tout.
   - **Exception.** Des droits de colonne (`grant update (selected, anki_status) on vocab_items`, `grant update (followed) on threads`) et une politique `for update` permettent à l'utilisateur autorisé de modifier ces trois colonnes et rien d'autre. Un `update` qui nomme une autre colonne échoue en « permission denied ».
   - **Stockage.** Une politique de lecture sur `storage.objects`, limitée aux buckets `audio` et `pdf` et à l'utilisateur autorisé, permet à l'appli de créer des URL signées.
3. **PGlite pour tester le SQL hors ligne.**
   - **Ce qui est réel.** PGlite est un vrai Postgres 18 : rôles, `set role`, RLS, droits de colonne, `security definer`, plpgsql et verrous consultatifs y fonctionnent comme sur le serveur. Les tests de RLS sont donc fidèles pour la base elle-même.
   - **Ce qui est simulé.** Le prélude de test (`pipeline/test/supabase/prelude.sql`, jamais appliqué à un vrai projet) crée ce que Supabase fournit : les rôles `anon`, `authenticated` et `service_role` (`bypassrls`), `auth.jwt()`, qui lit `request.jwt.claims` comme sur Supabase, un schéma `storage` réduit et les droits par défaut très larges de Supabase sur `public`. Ce dernier point oblige la migration à retirer explicitement ce qu'elle n'accorde pas, et les tests le vérifient.
   - **Ce qui n'est pas testé.** PostgREST lui-même, l'API Storage réelle et l'écart avec la version de Postgres du projet hébergé (15 ou 17) ne sont pas couverts ; voir la dernière section.
4. **Publication atomique : `publish_edition(payload jsonb)`.**
   - **Une transaction.** PostgREST exécute chaque appel `rpc` dans une transaction. La fonction fait un upsert de l'édition sur `(date, lang)` (l'id ne change pas), supprime ses sujets (qui emportent sources et événements de Thread), ses brèves et ses mots, puis les recrée. Une erreur au milieu annule tout : l'édition reste celle d'avant (testé).
   - **Concurrence.** Un verrou consultatif par `(date, lang)` sérialise deux publications simultanées de la même édition.
   - **Forme.** La fonction pure `editionPayload` (TypeScript) prépare les lignes, donc la correspondance `Edition` → SQL se teste sans base.
5. **Ce qui survit à une relance.**
   - **Mots.** L'état de chaque mot (`selected`, `anki_status`) est relevé avant la suppression, par terme sans casse ni espaces autour, dans la **même édition** (même date et même langue), puis réappliqué. Pour un terme en double, on garde l'état le plus avancé. Un mot remplacé repart de zéro ; un mot d'une autre langue ou d'une autre date n'hérite jamais.
   - **Threads.** Ils ne sont jamais recréés, donc `followed` reste. Un `thread.id` présent désigne un Thread de la même langue. Sinon, le slug `<langue>-<titre sans accents>` retrouve un Thread ouvert de même titre, ou en crée un. Si le slug est pris par un Thread fermé, le nouveau Thread prend le slug daté `<slug>-<date>`, stable à la relance. Un événement rouvre un Thread fermé désigné par son id. Un Thread créé par une publication précédente de la même édition et resté sans événement est supprimé.
6. **Drive : un fichier par requête.** La page des quotas d'Apps Script (consultée le 16/11/2026) fixe 6 minutes par exécution et 30 exécutions simultanées par utilisateur. Elle ne donne aucune limite de taille pour le corps d'une requête entrante. Un PDF (2 à 10 Mo) et trois MP3 (environ 1,5 Mo chacun), en base64, pourraient frôler une limite non documentée : on envoie donc un fichier par requête, au plus 30 Mo par fichier (40 Mo en base64), avec un délai de 3 minutes. Le POST reçoit un 302 vers `script.googleusercontent.com`, suivi à la main par un GET sans corps ni jeton. Chaque saut doit rester sur un hôte d'Apps Script en https ; une redirection vers `accounts.google.com` signifie une application non publique, et elle est refusée.
7. **Dépôts en attente.**
   - **Mise en attente.** Un fichier non déposé dans Drive va dans `drive_pending` (une ligne par date), seulement s'il est dans Storage, d'où il sera relu.
   - **Relance.** Au passage suivant, les lignes sont retentées d'abord, au plus 5 par passage, les plus anciennes en premier, sauf la date du jour. Après 5 tentatives, une ligne est abandonnée, mais elle reste en base et le rapport la signale.
   - **Contrôles.** Chaque fichier relu est revérifié (nom, date, bucket, chemin, premiers octets) avant l'envoi. Un fichier purgé de Storage est abandonné avec un avertissement.
8. **Purge des MP3 à 30 jours, sans pg_cron.** La documentation de Supabase précise que supprimer une ligne de `storage.objects` en SQL laisse le fichier orphelin ; une tâche pg_cron en SQL ne suffirait donc pas. `brief:publish` interroge `audio_expired`, supprime les fichiers par l'API Storage, puis vide `editions.audio_path` (`audio_clear`). La migration n'utilise aucune extension et ne peut pas échouer faute de pg_cron (testé).
9. **`runs` : une ligne par date.** `close_stale_threads` y note les fermetures (statut `running`), et `save_run` écrit le bilan en gardant ces fermetures. Le bilan reprend chaque étape (`context`, `collect`, `verify`, `render`, `publish`, `drive`) avec son statut, sa fin, ses compteurs et au plus 5 erreurs. Il recopie `perLang.<lang>.light` de la collecte, et `editions.status = 'light'` en découle. Les rapports des lots 1 à 3 ne mesurent pas leur durée : `durationMs` vaut `null` pour eux et ne se mesure que pour `publish`.
10. **Codes de sortie de `brief:publish`.**
    - **0** : au moins une édition est publiée dans Supabase. Le champ `status` du rapport vaut `ok`, ou `degraded` s'il manque une édition, le PDF, ou un dépôt Drive.
    - **2** : aucune édition publiée.

    Sans les variables Apps Script, Drive est ignoré avec un avertissement. Une URL Apps Script hors de Google est une erreur, et le jeton n'est alors envoyé nulle part.
11. **Registre d'usage TheNewsAPI dans Supabase : non retenu.** Il demanderait de modifier `pipeline/collect` (exclu de ce lot) pour un gain incertain, car la routine du lot 7 ne relance pas la collecte dans un conteneur neuf le même jour. Le registre fichier reste la seule source, et la consigne est reportée au lot 7.

### Points non vérifiables ici

Voir la dernière section, « Ce qui n'a pas pu être vérifié hors ligne ».

## Structure des fichiers

```
supabase/migrations/
  0001_init.sql                       tables §6.2, RLS, droits de colonne, buckets, email autorisé
  0002_context_runs.sql               close_stale_threads, context_*, save_run
  0003_publish.sql                    publish_edition (une transaction par édition)
  0004_files.sql                      drive_pending_*, audio_expired, audio_clear
pipeline/supabase/
  config.ts                           SUPABASE_URL / clé : présence et forme de l'URL
  client.ts                           rpc, upload, download, remove : délai, signal, disjoncteur, masquage
pipeline/context/
  supabase-store.ts                   ContextStore sur Supabase
  select-store.ts                     (modifié) Supabase, indisponible (code 2) ou vide (--allow-empty)
  cli.ts                              (modifié) option --allow-empty
pipeline/publish/
  files.ts                            noms Drive, chemins Storage, contrôle nom/date/octets
  rows.ts                             Edition → charge de publish_edition (fonction pure), slug de Thread
  inputs.ts                           lecture contrôlée de render-report.json, final.json, PDF, MP3
  supabase.ts                         dépôt Storage, publication des éditions
  drive.ts                            client Apps Script (302 manuel, un fichier par requête)
  retry-pending.ts                    dépôts Drive en attente
  audio-purge.ts                      purge des MP3 de plus de 30 jours
  run-summary.ts                      bilan des rapports context, collect, verify, render
  run-publish.ts                      orchestration, publish-report.json, ligne runs
  cli.ts                              npm run brief:publish
apps-script/Code.gs                   doPost : jeton, dossier Daily Brief/AAAA/MM - Mois, remplacement
docs/setup-supabase.md                mise en place pas à pas (projet, migrations, email, Vault, Apps Script)
pipeline/test/supabase/               prelude.sql, pg.ts, fake-supabase.ts, schema, rls, client
pipeline/test/context/                supabase-store, select-store (+ cli et run-context modifiés)
pipeline/test/apps-script/            fake-google.ts, code.test.ts
pipeline/test/publish/                day.ts, reports.ts, apps-script-server.ts + 8 fichiers de test
```

---

### Tâche 1 : schéma initial, RLS et buckets privés

**Fichiers :**
- Modifier : `package.json` et `package-lock.json` (PGlite en dépendance de développement)
- Créer : `supabase/migrations/0001_init.sql`
- Test : `pipeline/test/supabase/prelude.sql`, `pipeline/test/supabase/pg.ts`, `pipeline/test/supabase/schema.test.ts`, `pipeline/test/supabase/rls.test.ts`

Comportement attendu :
- **Tables.** Les huit tables du §6.2 sont créées, toutes sous RLS, avec l'unicité `(date, lang)` des éditions et des contraintes `check` sur les langues, rubriques, statuts et états Anki.
- **Suppressions.** Supprimer une édition emporte ses sujets, ses sources (brèves comprises), ses mots et ses événements de Thread, mais pas les Threads. `thread_events.date` est de type `date`.
- **Buckets.** `audio` (MP3, 20 Mo) et `pdf` (PDF, 50 Mo) sont privés.
- **Lecture.** Seul l'utilisateur dont l'email du jeton est celui de `private.app_settings` lit, sans casse ni espaces. Changer l'email prend effet aussitôt ; sans réglage, personne ne lit. `anon` n'a aucun droit.
- **Écriture.** L'utilisateur autorisé ne modifie que `vocab_items.selected`, `vocab_items.anki_status` et `threads.followed`. Il n'insère ni ne supprime rien. La clé de service écrit partout.
- **Rejeu.** La migration est rejouable sans toucher à l'email autorisé, et elle n'utilise ni pg_cron ni aucune extension.

`pg.ts` applique toutes les migrations de `supabase/migrations/` dans l'ordre de leur nom ; les tâches 3, 7 et 10 y ajoutent les leurs.

- [ ] **Étape 1 : installer PGlite**

```bash
npm install -D -E @electric-sql/pglite@0.5.16
```

Attendu : `package.json` gagne `"@electric-sql/pglite": "0.5.16"` dans `devDependencies`.

- [ ] **Étape 2 : écrire le prélude, l'aide de test et les tests**

Le prélude crée ce que Supabase fournit déjà. Il ne sert qu'aux tests.

Fichier `pipeline/test/supabase/prelude.sql` :

```sql
-- Prélude des tests hors ligne : ce qu'un projet Supabase fournit déjà (rôles, auth.jwt(), schéma
-- storage, droits par défaut). Ce fichier n'est JAMAIS appliqué à un vrai projet.

create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;

create schema auth;
-- Même principe que Supabase : PostgREST range les revendications du jeton dans request.jwt.claims.
create function auth.jwt() returns jsonb language sql stable
as $$ select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;
grant usage on schema auth to anon, authenticated, service_role;
grant execute on function auth.jwt() to anon, authenticated, service_role;

create schema storage;
create table storage.buckets (
  id text primary key,
  name text not null unique,
  public boolean default false,
  file_size_limit bigint,
  allowed_mime_types text[]
);
create table storage.objects (
  id uuid primary key default gen_random_uuid(),
  bucket_id text references storage.buckets (id),
  name text,
  unique (bucket_id, name)
);
alter table storage.objects enable row level security;
grant usage on schema storage to anon, authenticated, service_role;
grant all on storage.buckets, storage.objects to anon, authenticated, service_role;

-- Droits par défaut de Supabase sur le schéma public : tout pour tout le monde. La migration doit
-- donc retirer explicitement ce qu'elle ne veut pas accorder.
grant usage on schema public to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
```

Fichier `pipeline/test/supabase/pg.ts` :

```ts
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
```

Fichier `pipeline/test/supabase/schema.test.ts` :

```ts
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { applyMigrations, createTestDb, migrationFiles, MIGRATIONS_DIR, rows, type TestDb } from './pg';

let db: TestDb;
beforeAll(async () => {
  db = await createTestDb();
}, 60_000);
afterAll(async () => {
  await db.close();
});

const insertEdition = (date: string, lang: string) =>
  db.query<{ id: string }>(`insert into public.editions (date, lang, region, headline, morning_brief, generated_at) values ($1, $2, 'r', 'h', '[]', now()) returning id`, [date, lang]);

const count = async (table: string) => (await rows<{ n: number }>(db, `select count(*)::int as n from public.${table}`))[0].n;

describe('migrations Supabase', () => {
  it('crée les huit tables du §6.2, toutes sous RLS', async () => {
    const t = await rows<{ relname: string; relrowsecurity: boolean }>(
      db,
      `select c.relname, c.relrowsecurity from pg_class c join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and c.relkind = 'r' order by 1`,
    );
    expect(t.map((r) => r.relname)).toEqual(['drive_pending', 'editions', 'runs', 'sources', 'stories', 'thread_events', 'threads', 'vocab_items']);
    expect(t.every((r) => r.relrowsecurity)).toBe(true);
  });

  it('crée les buckets privés audio et pdf', async () => {
    expect(await rows(db, 'select id, public, file_size_limit::int as file_size_limit, allowed_mime_types from storage.buckets order by id')).toEqual([
      { id: 'audio', public: false, file_size_limit: 20971520, allowed_mime_types: ['audio/mpeg'] },
      { id: 'pdf', public: false, file_size_limit: 52428800, allowed_mime_types: ['application/pdf'] },
    ]);
  });

  it('sont rejouables sans erreur et sans toucher à l’email autorisé', async () => {
    await db.exec(`update private.app_settings set value = 'autre@exemple.fr' where key = 'allowed_email'`);
    await applyMigrations(db);
    expect(await rows(db, 'select value from private.app_settings')).toEqual([{ value: 'autre@exemple.fr' }]);
    await db.exec(`update private.app_settings set value = 'nanigeek@gmail.com' where key = 'allowed_email'`);
  });

  it('ne dépendent pas de pg_cron', () => {
    expect(migrationFiles()[0]).toBe('0001_init.sql');
    for (const f of migrationFiles()) {
      const sql = readFileSync(join(MIGRATIONS_DIR, f), 'utf8');
      expect(sql).not.toMatch(/create extension/i);
      expect(sql).not.toMatch(/cron\.schedule/i);
    }
  });

  it('impose l’unicité (date, lang) des éditions et les langues connues', async () => {
    await insertEdition('2026-01-01', 'fr');
    await expect(insertEdition('2026-01-01', 'fr')).rejects.toThrow(/editions_date_lang_key/);
    await expect(insertEdition('2026-01-01', 'de')).rejects.toThrow(/editions_lang_check/);
    await insertEdition('2026-01-01', 'en');
  });

  it('refuse un statut, une rubrique ou un état Anki inconnus', async () => {
    const id = (await insertEdition('2026-01-02', 'en')).rows[0].id;
    await expect(db.query(`insert into public.threads (slug, title, lang, status) values ('s', 't', 'fr', 'paused')`)).rejects.toThrow(/threads_status_check/);
    await expect(
      db.query(`insert into public.stories (edition_id, key, rubric, position, kicker, date_label, title, summary, visual) values ($1, 'k', 'xxx', 1, 'k', 'd', 't', 's', '{}')`, [id]),
    ).rejects.toThrow(/stories_rubric_check/);
    await expect(
      db.query(`insert into public.vocab_items (edition_id, lang, position, term, pos, translation, example, anki_status) values ($1, 'en', 1, 't', 'n', 't', 'e', 'done')`, [id]),
    ).rejects.toThrow(/vocab_items_anki_status_check/);
    await expect(db.query(`insert into public.runs (date, status) values ('2026-01-02', 'bof')`)).rejects.toThrow(/runs_status_check/);
  });

  it('thread_events.date est de type date', async () => {
    expect(
      await rows(db, `select data_type from information_schema.columns where table_schema = 'public' and table_name = 'thread_events' and column_name = 'date'`),
    ).toEqual([{ data_type: 'date' }]);
  });

  it('supprimer une édition emporte ses sujets, sources, mots et événements, pas les Threads', async () => {
    const id = (await insertEdition('2026-01-03', 'fr')).rows[0].id;
    const thread = (await db.query<{ id: string }>(`insert into public.threads (slug, title, lang) values ('fr-x', 'X', 'fr') returning id`)).rows[0].id;
    const story = (
      await db.query<{ id: string }>(
        `insert into public.stories (edition_id, key, rubric, position, kicker, date_label, title, summary, visual, thread_id) values ($1, 'k', 'pol', 1, 'k', 'd', 't', 's', '{}', $2) returning id`,
        [id, thread],
      )
    ).rows[0].id;
    await db.query(`insert into public.sources (edition_id, story_id, rubric, position, outlet, title, url, lang, read_full) values ($1, $2, 'pol', 1, 'o', 't', 'https://x', 'fr', true)`, [id, story]);
    await db.query(`insert into public.sources (edition_id, rubric, position, outlet, title, url, lang, read_full) values ($1, 'pol', 1, 'o', 't', 'https://y', 'fr', false)`, [id]);
    await db.query(`insert into public.thread_events (thread_id, date, title, story_id) values ($1, '2026-01-03', 't', $2)`, [thread, story]);
    await db.query(`insert into public.vocab_items (edition_id, lang, position, term, pos, translation, example) values ($1, 'fr', 1, 't', 'n', 't', 'e')`, [id]);
    const before = [await count('stories'), await count('sources'), await count('vocab_items'), await count('thread_events')];
    await db.query('delete from public.editions where id = $1', [id]);
    const after = [await count('stories'), await count('sources'), await count('vocab_items'), await count('thread_events')];
    expect(before.map((n, i) => n - after[i])).toEqual([1, 2, 1, 1]);
    expect(await count('threads')).toBe(1);
  });
});
```

Fichier `pipeline/test/supabase/rls.test.ts` :

```ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ALLOWED_EMAIL, asRole, createTestDb, rows, type Role, type TestDb } from './pg';

const TABLES = ['editions', 'stories', 'sources', 'threads', 'thread_events', 'vocab_items', 'runs', 'drive_pending'];
const USER: Role = { email: ALLOWED_EMAIL };
const STRANGER: Role = { email: 'intrus@exemple.fr' };

let db: TestDb;
let edition: string;
let thread: string;
let vocab: string;

beforeAll(async () => {
  db = await createTestDb();
  edition = (await db.query<{ id: string }>(`insert into public.editions (date, lang, region, headline, morning_brief, generated_at) values ('2026-11-06', 'en', 'r', 'Titre', '[]', now()) returning id`)).rows[0].id;
  thread = (await db.query<{ id: string }>(`insert into public.threads (slug, title, lang) values ('en-midterms-2026', 'Midterms 2026', 'en') returning id`)).rows[0].id;
  const story = (
    await db.query<{ id: string }>(
      `insert into public.stories (edition_id, key, rubric, position, kicker, date_label, title, summary, visual, thread_id) values ($1, 'en-1', 'pol', 1, 'k', 'd', 't', 's', '{}', $2) returning id`,
      [edition, thread],
    )
  ).rows[0].id;
  await db.query(`insert into public.sources (edition_id, story_id, rubric, position, outlet, title, url, lang, read_full) values ($1, $2, 'pol', 1, 'PBS', 't', 'https://www.pbs.org/a', 'en', true)`, [edition, story]);
  await db.query(`insert into public.thread_events (thread_id, date, title, story_id) values ($1, '2026-11-06', 't', $2)`, [thread, story]);
  vocab = (await db.query<{ id: string }>(`insert into public.vocab_items (edition_id, lang, position, term, pos, translation, example) values ($1, 'en', 1, 'landslide', 'n.', 'raz-de-marée', 'A landslide.') returning id`, [edition])).rows[0].id;
  await db.query(`insert into public.runs (date, status) values ('2026-11-06', 'ok')`);
  await db.query(`insert into public.drive_pending (date, files) values ('2026-11-05', '[]')`);
  await db.query(`insert into storage.objects (bucket_id, name) values ('pdf', '2026-11-06/daily-brief-2026-11-06.pdf'), ('audio', '2026-11-06/en.mp3')`);
}, 60_000);
afterAll(async () => {
  await db.close();
});

const counts = (role: Role) =>
  asRole(db, role, async (tx) => {
    const out: Record<string, number> = {};
    for (const t of TABLES) out[t] = (await tx.query<{ n: number }>(`select count(*)::int as n from public.${t}`)).rows[0].n;
    return out;
  });
const ALL = { editions: 1, stories: 1, sources: 1, threads: 1, thread_events: 1, vocab_items: 1, runs: 1, drive_pending: 1 };
const NONE = Object.fromEntries(TABLES.map((t) => [t, 0]));
const run = (role: Role, sql: string, params: unknown[] = []) => asRole(db, role, (tx) => tx.query(sql, params));

describe('RLS : lecture', () => {
  it('l’utilisateur autorisé lit toutes les tables', async () => {
    expect(await counts(USER)).toEqual(ALL);
  });

  it('l’email est comparé sans casse ni espaces', async () => {
    expect(await counts({ email: '  NaniGeek@Gmail.com ' })).toEqual(ALL);
  });

  it('un autre utilisateur connecté ne lit rien', async () => {
    expect(await counts(STRANGER)).toEqual(NONE);
  });

  it('un jeton sans email ne lit rien', async () => {
    expect(await counts({ email: null })).toEqual(NONE);
  });

  it('le rôle anon n’a aucun droit sur les tables', async () => {
    for (const t of TABLES) await expect(run('anon', `select count(*) from public.${t}`)).rejects.toThrow(/permission denied/);
  });

  it('changer l’email autorisé prend effet aussitôt', async () => {
    await db.exec(`update private.app_settings set value = 'intrus@exemple.fr' where key = 'allowed_email'`);
    try {
      expect(await counts(USER)).toEqual(NONE);
      expect(await counts(STRANGER)).toEqual(ALL);
    } finally {
      await db.exec(`update private.app_settings set value = '${ALLOWED_EMAIL}' where key = 'allowed_email'`);
    }
  });

  it('sans réglage allowed_email, personne ne lit', async () => {
    await db.exec(`delete from private.app_settings where key = 'allowed_email'`);
    try {
      expect(await counts(USER)).toEqual(NONE);
    } finally {
      await db.exec(`insert into private.app_settings (key, value) values ('allowed_email', '${ALLOWED_EMAIL}')`);
    }
  });

  it('les réglages privés sont illisibles pour l’utilisateur, même autorisé', async () => {
    await expect(run(USER, 'select * from private.app_settings')).rejects.toThrow(/permission denied/);
    await expect(run('anon', 'select private.is_allowed_user()')).rejects.toThrow(/permission denied/);
  });

  it('la clé service lit tout', async () => {
    expect(await counts('service_role')).toEqual(ALL);
  });
});

describe('RLS : écriture', () => {
  it('l’utilisateur autorisé coche un mot et le met en file Anki', async () => {
    const r = await run(USER, `update public.vocab_items set selected = true, anki_status = 'queued' where id = $1 returning selected, anki_status`, [vocab]);
    expect(r.rows).toEqual([{ selected: true, anki_status: 'queued' }]);
  });

  it('l’utilisateur autorisé suit un Thread', async () => {
    const r = await run(USER, `update public.threads set followed = true where id = $1 returning followed`, [thread]);
    expect(r.rows).toEqual([{ followed: true }]);
  });

  it('l’utilisateur autorisé ne modifie aucune autre colonne', async () => {
    await expect(run(USER, `update public.vocab_items set term = 'x' where id = $1`, [vocab])).rejects.toThrow(/permission denied/);
    await expect(run(USER, `update public.vocab_items set selected = true, translation = 'x' where id = $1`, [vocab])).rejects.toThrow(/permission denied/);
    await expect(run(USER, `update public.threads set status = 'closed' where id = $1`, [thread])).rejects.toThrow(/permission denied/);
    await expect(run(USER, `update public.threads set title = 'x', followed = true where id = $1`, [thread])).rejects.toThrow(/permission denied/);
    await expect(run(USER, `update public.editions set headline = 'x' where id = $1`, [edition])).rejects.toThrow(/permission denied/);
  });

  it('l’utilisateur autorisé n’insère ni ne supprime rien', async () => {
    await expect(run(USER, `insert into public.threads (slug, title, lang) values ('x', 'x', 'fr')`)).rejects.toThrow(/permission denied/);
    await expect(run(USER, `insert into public.vocab_items (edition_id, lang, position, term, pos, translation, example) values ($1, 'en', 2, 't', 'n', 't', 'e')`, [edition])).rejects.toThrow(/permission denied/);
    for (const t of TABLES) await expect(run(USER, `delete from public.${t}`)).rejects.toThrow(/permission denied/);
  });

  it('un autre utilisateur ne modifie rien : aucune ligne touchée', async () => {
    expect((await run(STRANGER, `update public.vocab_items set selected = false where id = $1 returning id`, [vocab])).rows).toEqual([]);
    expect((await run(STRANGER, `update public.threads set followed = false where id = $1 returning id`, [thread])).rows).toEqual([]);
    expect(await rows(db, 'select selected from public.vocab_items')).toEqual([{ selected: true }]);
    expect(await rows(db, 'select followed from public.threads')).toEqual([{ followed: true }]);
  });

  it('une valeur d’état Anki inconnue est refusée', async () => {
    await expect(run(USER, `update public.vocab_items set anki_status = 'done' where id = $1`, [vocab])).rejects.toThrow(/vocab_items_anki_status_check/);
  });

  it('la clé service écrit partout', async () => {
    const r = await run('service_role', `update public.editions set headline = 'Nouveau titre' where id = $1 returning headline`, [edition]);
    expect(r.rows).toEqual([{ headline: 'Nouveau titre' }]);
  });
});

describe('RLS : stockage', () => {
  const files = (role: Role) => asRole(db, role, async (tx) => (await tx.query<{ n: number }>('select count(*)::int as n from storage.objects')).rows[0].n);

  it('seul l’utilisateur autorisé voit les fichiers des buckets audio et pdf', async () => {
    expect(await files(USER)).toBe(2);
    expect(await files(STRANGER)).toBe(0);
    expect(await files('anon')).toBe(0);
  });
});
```

- [ ] **Étape 3 : vérifier l'échec**

Commande : `npx vitest run pipeline/test/supabase`
Attendu : échec, « ENOENT: no such file or directory, scandir ».

- [ ] **Étape 4 : écrire la migration**

Fichier `supabase/migrations/0001_init.sql` :

```sql
-- Daily Brief — schéma initial (spec §6.2, §10, §12).
-- Tables, buckets privés et RLS. Les fonctions appelées par le pipeline (clé service, via PostgREST)
-- sont dans les migrations suivantes. Rejouable : chaque objet est créé « if not exists » ou remplacé.

-- ---------------------------------------------------------------------------------------------
-- 1. Réglages privés et utilisateur autorisé
-- ---------------------------------------------------------------------------------------------

-- Schéma non exposé par l'API : ni la table des réglages ni la fonction ne sont appelables de l'extérieur.
create schema if not exists private;

create table if not exists private.app_settings (
  key text primary key,
  value text not null
);
alter table private.app_settings enable row level security;

-- Email autorisé (spec §6.2). Pour le changer :
--   update private.app_settings set value = 'autre@exemple.fr' where key = 'allowed_email';
insert into private.app_settings (key, value) values ('allowed_email', 'nanigeek@gmail.com')
on conflict (key) do nothing;

-- Vrai si l'email du jeton de session est l'email autorisé (comparaison sans casse ni espaces).
-- « security definer » : la fonction lit private.app_settings à la place de l'appelant.
create or replace function private.is_allowed_user() returns boolean
language sql stable security definer set search_path = ''
as $$
  select coalesce(
    lower(btrim(auth.jwt() ->> 'email'))
      = (select lower(btrim(s.value)) from private.app_settings s where s.key = 'allowed_email'),
    false
  );
$$;

revoke all on schema private from public;
revoke all on private.app_settings from public, anon, authenticated;
revoke all on function private.is_allowed_user() from public, anon;
grant usage on schema private to authenticated, service_role;
grant execute on function private.is_allowed_user() to authenticated, service_role;
grant all on private.app_settings to service_role;

-- ---------------------------------------------------------------------------------------------
-- 2. Tables (spec §6.2)
-- ---------------------------------------------------------------------------------------------

create table if not exists public.editions (
  id uuid primary key default gen_random_uuid(),
  date date not null,
  lang text not null check (lang in ('fr', 'en', 'es')),
  region text not null,
  headline text not null,
  morning_brief jsonb not null,
  -- Rubriques dans l'ordre d'affichage : [{ "key": "pol", "title": "Politique & société" }, …]
  sections jsonb not null default '[]'::jsonb,
  vocab_title text,
  audio_path text,
  pdf_path text,
  -- « light » : édition allégée (moins de 15 textes lus à la collecte, spec §12).
  status text not null default 'published' check (status in ('published', 'light')),
  generated_at timestamptz not null,
  published_at timestamptz not null default now(),
  constraint editions_date_lang_key unique (date, lang)
);

create table if not exists public.threads (
  id uuid primary key default gen_random_uuid(),
  slug text not null,
  title text not null,
  lang text not null check (lang in ('fr', 'en', 'es')),
  status text not null default 'open' check (status in ('open', 'closed')),
  followed boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint threads_slug_key unique (slug)
);
create index if not exists threads_status_lang_idx on public.threads (status, lang);

create table if not exists public.stories (
  id uuid primary key default gen_random_uuid(),
  edition_id uuid not null references public.editions (id) on delete cascade,
  -- Identifiant du sujet dans le JSON de l'édition (« 2026-11-06-fr-1 »), cité par morning_brief[].storyId.
  key text not null,
  rubric text not null check (rubric in ('pol', 'int', 'eco', 'ent', 'dro', 'tec', 'env', 'cul', 'spo')),
  position integer not null,
  kicker text not null,
  date_label text not null,
  title text not null,
  summary text not null,
  visual jsonb not null,
  stats jsonb not null default '[]'::jsonb,
  quote jsonb,
  divergences jsonb not null default '[]'::jsonb,
  prepa jsonb,
  thread_id uuid references public.threads (id) on delete set null,
  thread_subtitle text,
  constraint stories_edition_key_key unique (edition_id, key),
  constraint stories_edition_position_key unique (edition_id, position)
);
create index if not exists stories_thread_idx on public.stories (thread_id);

create table if not exists public.sources (
  id uuid primary key default gen_random_uuid(),
  edition_id uuid not null references public.editions (id) on delete cascade,
  -- Nul pour une brève (« En bref ») : la brève appartient à la rubrique `rubric` de l'édition.
  story_id uuid references public.stories (id) on delete cascade,
  rubric text not null check (rubric in ('pol', 'int', 'eco', 'ent', 'dro', 'tec', 'env', 'cul', 'spo')),
  position integer not null,
  outlet text not null,
  title text not null,
  url text not null,
  lang text not null,
  read_full boolean not null,
  published_at text
);
create index if not exists sources_edition_idx on public.sources (edition_id);
create index if not exists sources_story_idx on public.sources (story_id);

create table if not exists public.thread_events (
  id uuid primary key default gen_random_uuid(),
  thread_id uuid not null references public.threads (id) on delete cascade,
  -- Date calendaire (jamais un horodatage : un fuseau décalerait la fermeture R12).
  date date not null,
  title text not null,
  text text not null default '',
  story_id uuid references public.stories (id) on delete cascade,
  constraint thread_events_thread_story_key unique (thread_id, story_id)
);
create index if not exists thread_events_thread_date_idx on public.thread_events (thread_id, date);
create index if not exists thread_events_story_idx on public.thread_events (story_id);

create table if not exists public.vocab_items (
  id uuid primary key default gen_random_uuid(),
  edition_id uuid not null references public.editions (id) on delete cascade,
  lang text not null check (lang in ('fr', 'en', 'es')),
  position integer not null,
  term text not null,
  pos text not null,
  translation text not null,
  example text not null,
  source_url text,
  selected boolean not null default false,
  anki_status text not null default 'none' check (anki_status in ('none', 'queued', 'sent'))
);
create index if not exists vocab_items_edition_idx on public.vocab_items (edition_id);
create index if not exists vocab_items_selected_idx on public.vocab_items (selected) where selected;

-- Un passage par date : chaque étape y range son statut (`steps`), la page Santé l'affiche.
create table if not exists public.runs (
  id uuid primary key default gen_random_uuid(),
  date date not null,
  status text not null check (status in ('running', 'ok', 'degraded', 'failed')),
  steps jsonb not null default '{}'::jsonb,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint runs_date_key unique (date)
);

-- Fichiers en attente de dépôt dans Drive : [{ "name", "mimeType", "bucket", "path" }, …]
create table if not exists public.drive_pending (
  id uuid primary key default gen_random_uuid(),
  date date not null,
  files jsonb not null,
  attempts integer not null default 0 check (attempts >= 0),
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint drive_pending_date_key unique (date)
);

-- ---------------------------------------------------------------------------------------------
-- 3. Droits et RLS
-- ---------------------------------------------------------------------------------------------
-- Lecture : seulement l'utilisateur connecté dont l'email est l'email autorisé.
-- Écriture : seulement la clé service (rôle service_role, qui contourne la RLS).
-- Exception : l'utilisateur autorisé modifie vocab_items.selected, vocab_items.anki_status et
-- threads.followed — et rien d'autre, grâce à des droits de colonne.

do $$
declare
  t text;
begin
  foreach t in array array['editions', 'stories', 'sources', 'threads', 'thread_events', 'vocab_items', 'runs', 'drive_pending']
  loop
    execute format('alter table public.%I enable row level security', t);
    -- Supabase accorde par défaut tous les droits à anon et authenticated : on repart de zéro.
    execute format('revoke all on public.%I from public, anon, authenticated', t);
    execute format('grant select on public.%I to authenticated', t);
    execute format('grant all on public.%I to service_role', t);
    execute format('drop policy if exists %I on public.%I', t || '_read', t);
    execute format(
      'create policy %I on public.%I for select to authenticated using ((select private.is_allowed_user()))',
      t || '_read', t
    );
  end loop;
end
$$;

grant update (selected, anki_status) on public.vocab_items to authenticated;
grant update (followed) on public.threads to authenticated;

drop policy if exists vocab_items_user_update on public.vocab_items;
create policy vocab_items_user_update on public.vocab_items for update to authenticated
  using ((select private.is_allowed_user())) with check ((select private.is_allowed_user()));

drop policy if exists threads_user_update on public.threads;
create policy threads_user_update on public.threads for update to authenticated
  using ((select private.is_allowed_user())) with check ((select private.is_allowed_user()));

-- ---------------------------------------------------------------------------------------------
-- 4. Stockage : buckets privés `audio` et `pdf`
-- ---------------------------------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('audio', 'audio', false, 20971520, array['audio/mpeg']),
  ('pdf', 'pdf', false, 52428800, array['application/pdf'])
on conflict (id) do update
  set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

-- L'utilisateur autorisé lit les fichiers (URL signées créées par l'appli) ; personne d'autre.
drop policy if exists daily_brief_files_read on storage.objects;
create policy daily_brief_files_read on storage.objects for select to authenticated
  using (bucket_id in ('audio', 'pdf') and (select private.is_allowed_user()));

-- Purge des MP3 de plus de 30 jours : faite par `brief:publish` avec l'API Storage (fonctions
-- audio_expired et audio_clear de 0004_files.sql), pas par pg_cron. Supprimer une ligne de storage.objects
-- en SQL laisserait le fichier orphelin dans le bucket (documentation Supabase).
```

- [ ] **Étape 5 : vérifier le succès**

Commande : `npx vitest run pipeline/test/supabase`
Attendu : `Test Files  2 passed (2)` et `Tests  25 passed (25)`.

Commande : `npm test && npm run typecheck`
Attendu : `Test Files  55 passed (55)`, `Tests  488 passed (488)`, et `tsc` sans sortie.

- [ ] **Étape 6 : commit**

```bash
git add package.json package-lock.json supabase/migrations/0001_init.sql pipeline/test/supabase/prelude.sql pipeline/test/supabase/pg.ts pipeline/test/supabase/schema.test.ts pipeline/test/supabase/rls.test.ts
git commit -m "feat(supabase): schéma initial, RLS et buckets privés"
```

---

### Tâche 2 : client Supabase borné

**Fichiers :**
- Créer : `pipeline/supabase/config.ts`, `pipeline/supabase/client.ts`
- Test : `pipeline/test/supabase/fake-supabase.ts`, `pipeline/test/supabase/client.test.ts`

Comportement attendu :
- **Configuration.** `supabaseConfig` rogne les variables et ne garde que l'origine. Une valeur blanche compte pour absente. Elle refuse http hors de la machine locale, ainsi qu'un chemin, une requête ou des identifiants dans l'URL, pour que la clé ne parte jamais en clair ni ailleurs.
- **`rpc`.** POST JSON vers `/rest/v1/rpc/<fn>`, avec la clé dans `apikey` et `Authorization`. La réponse est validée par un schéma zod. Un nom de fonction douteux est refusé sans requête.
- **Stockage.** `upload` (avec `x-upsert: true`, refuse un fichier vide ou trop lourd), `download` (`null` pour un fichier absent, 400 ou 404) et `remove` (un seul DELETE).
- **Chemins.** `objectPath` refuse `..`, les segments vides et les caractères spéciaux.
- **Disjoncteur.** 401, 402, 403, 429, un délai ou trois erreurs serveur de suite coupent Supabase pour le passage ; une erreur SQL (400) ne compte pas. Le signal de l'appel et celui du client (échéance globale) sont honorés.
- **Messages.** Aucun ne contient la clé, telle quelle ou encodée, ni un fragment de corps inattendu.

Le faux Supabase exécute les vraies fonctions SQL des migrations dans PGlite, sous `service_role` et dans une transaction, comme PostgREST. L'API Storage y est un dictionnaire en mémoire. Une clé fausse reçoit 401.

- [ ] **Étape 1 : écrire le faux Supabase et les tests**

Fichier `pipeline/test/supabase/fake-supabase.ts` :

```ts
import type { HttpResponse } from '../../collect/http';
import type { SupabaseFetch, SupabaseInit } from '../../supabase/client';
import { rpc, type TestDb } from './pg';

export const FAKE_URL = 'https://projet-test.supabase.co';
export const FAKE_KEY = 'clé-service-ultra-secrète-123456';

export type FakeCall = { method: string; path: string; headers: Record<string, string>; body?: string | Uint8Array; signal?: AbortSignal };

/** Réponse forcée par un test : statut et corps JSON, appel muet (`hang`) ou erreur réseau. */
export type Forced = { status?: number; json?: unknown; text?: string; hang?: boolean; error?: Error };

export type FakeSupabase = {
  fetch: SupabaseFetch;
  calls: FakeCall[];
  /** Fichiers des buckets, par « bucket/chemin ». */
  files: Map<string, { bytes: Uint8Array; contentType: string }>;
  /** Appelé avant chaque requête : une réponse renvoyée ici remplace le comportement normal. */
  intercept: (call: FakeCall) => Forced | undefined;
};

function reply(status: number, body: Uint8Array | string, contentType = 'application/json'): HttpResponse {
  const bytes = typeof body === 'string' ? new TextEncoder().encode(body) : body;
  const headers: Record<string, string> = { 'content-type': contentType, 'content-length': String(bytes.byteLength) };
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (n) => headers[n.toLowerCase()] ?? null },
    json: async () => JSON.parse(new TextDecoder().decode(bytes)),
    arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer,
    body: null,
  };
}

const json = (status: number, value: unknown) => reply(status, JSON.stringify(value));

/**
 * Faux Supabase, sans réseau. `POST /rest/v1/rpc/<fn>` exécute la vraie fonction SQL des migrations
 * dans PGlite, sous le rôle `service_role` et dans une transaction (comme PostgREST) ; l'API Storage
 * est un dictionnaire en mémoire. Une clé absente ou fausse reçoit 401, comme le vrai service.
 * Sans `db`, toute fonction SQL répond 404.
 */
export function fakeSupabase(db?: TestDb): FakeSupabase {
  const fake: FakeSupabase = {
    calls: [],
    files: new Map(),
    intercept: () => undefined,
    fetch: async (url: string, init?: SupabaseInit) => {
      if (!url.startsWith(`${FAKE_URL}/`)) throw new Error(`appel hors du faux Supabase : ${url}`);
      const path = url.slice(FAKE_URL.length);
      const headers = Object.fromEntries(Object.entries(init?.headers ?? {}).map(([k, v]) => [k.toLowerCase(), v]));
      const call: FakeCall = { method: init?.method ?? 'GET', path, headers, body: init?.body, signal: init?.signal };
      fake.calls.push(call);
      const forced = fake.intercept(call);
      if (forced?.hang) {
        await new Promise((_, reject) => {
          if (init?.signal?.aborted) reject(init.signal.reason);
          init?.signal?.addEventListener('abort', () => reject(init.signal!.reason));
        });
      }
      if (forced?.error) throw forced.error;
      if (forced) return forced.text !== undefined ? reply(forced.status ?? 200, forced.text, 'text/html') : json(forced.status ?? 200, forced.json ?? {});
      if (init?.signal?.aborted) throw init.signal.reason;
      if (headers.apikey !== FAKE_KEY || headers.authorization !== `Bearer ${FAKE_KEY}`) return json(401, { message: 'Invalid API key' });

      const fn = /^\/rest\/v1\/rpc\/([a-z_]+)$/.exec(path)?.[1];
      if (fn && call.method === 'POST') {
        if (!db) return json(404, { code: 'PGRST202', message: `Could not find the function public.${fn}` });
        try {
          return json(200, await rpc(db, fn, JSON.parse(String(init?.body ?? '{}'))));
        } catch (e) {
          const code = (e as { code?: string }).code;
          const status = code === '42501' ? 403 : code === '42883' ? 404 : 400;
          return json(status, { code: code ?? 'XX000', message: (e as Error).message });
        }
      }

      const object = /^\/storage\/v1\/object\/(.+)$/.exec(path)?.[1];
      if (object) {
        const key = object.split('/').map(decodeURIComponent).join('/');
        if (call.method === 'POST') {
          if (!(init?.body instanceof Uint8Array)) return json(400, { message: 'corps binaire attendu' });
          if (fake.files.has(key) && headers['x-upsert'] !== 'true') return json(409, { message: 'The resource already exists' });
          fake.files.set(key, { bytes: new Uint8Array(init.body), contentType: headers['content-type'] ?? '' });
          return json(200, { Key: key });
        }
        if (call.method === 'GET') {
          const file = fake.files.get(key);
          return file ? reply(200, file.bytes, file.contentType) : json(404, { message: 'Object not found' });
        }
        if (call.method === 'DELETE') {
          const { prefixes } = JSON.parse(String(init?.body ?? '{}')) as { prefixes: string[] };
          for (const p of prefixes) fake.files.delete(`${key}/${p}`);
          return json(200, []);
        }
      }
      return json(404, { message: 'route inconnue' });
    },
  };
  return fake;
}
```

Fichier `pipeline/test/supabase/client.test.ts` :

```ts
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { createSupabaseClient, objectPath, SupabaseDownError, SupabaseError } from '../../supabase/client';
import { MISSING_SUPABASE, supabaseConfig } from '../../supabase/config';
import { FAKE_KEY, FAKE_URL, fakeSupabase } from './fake-supabase';

const config = { url: FAKE_URL, serviceKey: FAKE_KEY };
const Any = z.unknown();
const PDF = new TextEncoder().encode('%PDF-1.7 test');

describe('supabaseConfig', () => {
  it('rogne les valeurs et ne garde que l’origine', () => {
    expect(supabaseConfig({ SUPABASE_URL: ' https://abc.supabase.co/ ', SUPABASE_SERVICE_ROLE_KEY: ' k ' })).toEqual({ ok: true, config: { url: 'https://abc.supabase.co', serviceKey: 'k' } });
  });

  it('signale une clé ou une URL absente', () => {
    expect(supabaseConfig({})).toEqual({ ok: false, error: MISSING_SUPABASE });
    expect(supabaseConfig({ SUPABASE_URL: 'https://abc.supabase.co', SUPABASE_SERVICE_ROLE_KEY: '  ' })).toEqual({ ok: false, error: MISSING_SUPABASE });
  });

  it('refuse http hors localhost, un chemin, une requête ou des identifiants', () => {
    const bad = (url: string) => supabaseConfig({ SUPABASE_URL: url, SUPABASE_SERVICE_ROLE_KEY: 'k' });
    expect(bad('http://abc.supabase.co')).toEqual({ ok: false, error: 'SUPABASE_URL invalide : https obligatoire (http seulement pour localhost)' });
    expect(bad('ftp://abc.supabase.co').ok).toBe(false);
    expect(bad('pas une url')).toEqual({ ok: false, error: 'SUPABASE_URL invalide : URL attendue (https://<projet>.supabase.co)' });
    for (const url of ['https://abc.supabase.co/rest/v1', 'https://abc.supabase.co/?x=1', 'https://u:p@abc.supabase.co']) {
      expect(bad(url)).toEqual({ ok: false, error: 'SUPABASE_URL invalide : origine seule attendue, sans chemin, requête ni identifiants' });
    }
    expect(bad('http://127.0.0.1:54321')).toEqual({ ok: true, config: { url: 'http://127.0.0.1:54321', serviceKey: 'k' } });
  });
});

describe('objectPath', () => {
  it('encode chaque segment et refuse les chemins douteux', () => {
    expect(objectPath('pdf', '2026-11-06/daily-brief-2026-11-06.pdf')).toBe('pdf/2026-11-06/daily-brief-2026-11-06.pdf');
    for (const p of ['../x', 'a//b', 'a/./b', 'a b', 'a?b', '']) expect(() => objectPath('pdf', p)).toThrow('chemin de stockage refusé');
  });
});

describe('client Supabase', () => {
  it('rpc : POST JSON avec la clé dans apikey et authorization, réponse validée', async () => {
    const fake = fakeSupabase();
    fake.intercept = () => ({ json: { ok: 1 } });
    const client = createSupabaseClient(config, fake.fetch);
    expect(await client.rpc('save_run', { p_date: '2026-11-06' }, z.object({ ok: z.number() }))).toEqual({ ok: 1 });
    expect(fake.calls).toHaveLength(1);
    const call = fake.calls[0];
    expect([call.method, call.path, call.body]).toEqual(['POST', '/rest/v1/rpc/save_run', '{"p_date":"2026-11-06"}']);
    expect(call.headers).toMatchObject({ apikey: FAKE_KEY, authorization: `Bearer ${FAKE_KEY}`, 'content-type': 'application/json' });
    expect(call.signal).toBeInstanceOf(AbortSignal);
  });

  it('rpc : refuse un nom de fonction douteux sans rien envoyer', async () => {
    const fake = fakeSupabase();
    const client = createSupabaseClient(config, fake.fetch);
    await expect(client.rpc('x; drop table', {}, Any)).rejects.toThrow('nom de fonction refusé');
    await expect(client.rpc('../storage', {}, Any)).rejects.toThrow('nom de fonction refusé');
    expect(fake.calls).toEqual([]);
  });

  it('rpc : réponse non JSON ou d’une forme inattendue, sans fragment du corps', async () => {
    const fake = fakeSupabase();
    const client = createSupabaseClient(config, fake.fetch);
    fake.intercept = () => ({ text: '<html>secret-interne</html>' });
    await expect(client.rpc('f', {}, Any)).rejects.toThrow(/^Supabase f : réponse non JSON$/);
    fake.intercept = () => ({ json: { a: 'secret-interne' } });
    await expect(client.rpc('f', {}, z.object({ a: z.number(), b: z.string() }))).rejects.toThrow(/^Supabase f : réponse inattendue \(2 champs invalides\)$/);
    expect(client.breaker.open).toBe(false);
  });

  it('une erreur SQL donne SupabaseError avec le code, sans compter pour le disjoncteur', async () => {
    const fake = fakeSupabase();
    fake.intercept = () => ({ status: 400, json: { code: '22023', message: 'publish_edition : édition absente ou incomplète', details: 'x' } });
    const client = createSupabaseClient(config, fake.fetch);
    for (let i = 0; i < 5; i++) {
      const e = await client.rpc('publish_edition', {}, Any).catch((x: Error) => x) as Error;
      expect(e).toBeInstanceOf(SupabaseError);
      expect(e.message).toBe('Supabase publish_edition : HTTP 400 22023 — publish_edition : édition absente ou incomplète');
    }
    expect(client.breaker.open).toBe(false);
    expect(fake.calls).toHaveLength(5);
  });

  it('la clé de service ne paraît dans aucun message d’erreur', async () => {
    const fake = fakeSupabase();
    const client = createSupabaseClient(config, fake.fetch);
    fake.intercept = () => ({ status: 400, json: { message: `clé ${FAKE_KEY} refusée (${encodeURIComponent(FAKE_KEY)})` } });
    const a = await client.rpc('f', {}, Any).catch((x: Error) => x) as Error;
    expect(a.message).toBe('Supabase f : HTTP 400 — clé *** refusée (***)');
    fake.intercept = () => ({ error: new Error(`connexion refusée avec ${FAKE_KEY}`) });
    const b = await client.rpc('f', {}, Any).catch((x: Error) => x) as Error;
    expect(b.message).toBe('Supabase f : connexion refusée avec ***');
  });

  it.each([401, 402, 403, 429])('un HTTP %i coupe Supabase : plus aucun appel ne part', async (status) => {
    const fake = fakeSupabase();
    fake.intercept = () => ({ status, json: { message: 'non' } });
    const client = createSupabaseClient(config, fake.fetch);
    await expect(client.rpc('f', {}, Any)).rejects.toThrow(`Supabase f : HTTP ${status} — non`);
    await expect(client.rpc('g', {}, Any)).rejects.toThrow(new SupabaseDownError(`HTTP ${status}`));
    await expect(client.upload('pdf', 'a.pdf', PDF, 'application/pdf')).rejects.toThrow(`Supabase coupé (HTTP ${status})`);
    await expect(client.download('pdf', 'a.pdf')).rejects.toThrow(SupabaseDownError);
    await expect(client.remove('pdf', ['a.pdf'])).rejects.toThrow(SupabaseDownError);
    expect(fake.calls).toHaveLength(1);
  });

  it('une clé fausse est refusée par le service (401) et coupe le client', async () => {
    const fake = fakeSupabase();
    const client = createSupabaseClient({ url: FAKE_URL, serviceKey: 'mauvaise-clé' }, fake.fetch);
    await expect(client.rpc('f', {}, Any)).rejects.toThrow('Supabase f : HTTP 401 — Invalid API key');
    expect(client.breaker.reason).toBe('HTTP 401');
  });

  it('un appel muet est interrompu au délai, et le délai coupe Supabase', async () => {
    const fake = fakeSupabase();
    fake.intercept = () => ({ hang: true });
    const client = createSupabaseClient(config, fake.fetch);
    const e = await client.rpc('f', {}, Any, { timeoutMs: 20 }).catch((x: Error) => x) as Error;
    expect(e.name).toBe('TimeoutError');
    expect(e.message).toMatch(/^Supabase f : /);
    expect(client.breaker.reason).toBe('délai dépassé');
  });

  it('honore le signal de l’appelant et celui du client', async () => {
    const fake = fakeSupabase();
    fake.intercept = () => ({ hang: true });
    const perCall = new AbortController();
    const p = createSupabaseClient(config, fake.fetch).rpc('f', {}, Any, { signal: perCall.signal });
    perCall.abort();
    await expect(p).rejects.toThrow(/^Supabase f : /);
    const global = new AbortController();
    const q = createSupabaseClient(config, fake.fetch, { signal: global.signal }).download('pdf', 'a.pdf');
    global.abort();
    await expect(q).rejects.toThrow(/^Supabase Storage \(lecture pdf\/a\.pdf\) : /);
  });

  it('trois erreurs serveur de suite coupent Supabase ; un succès remet le compte à zéro', async () => {
    const fake = fakeSupabase();
    let status = 500;
    fake.intercept = () => ({ status, json: {} });
    const client = createSupabaseClient(config, fake.fetch);
    await expect(client.rpc('f', {}, Any)).rejects.toThrow('HTTP 500');
    await expect(client.rpc('f', {}, Any)).rejects.toThrow('HTTP 500');
    status = 200;
    await client.rpc('f', {}, Any);
    status = 503;
    for (let i = 0; i < 3; i++) await expect(client.rpc('f', {}, Any)).rejects.toThrow('HTTP 503');
    expect(client.breaker.reason).toBe('source coupée après 3 échecs consécutifs');
    await expect(client.rpc('f', {}, Any)).rejects.toThrow(SupabaseDownError);
    expect(fake.calls).toHaveLength(6);
  });

  it('upload puis download : octets identiques, remplacement autorisé (x-upsert)', async () => {
    const fake = fakeSupabase();
    const client = createSupabaseClient(config, fake.fetch);
    await client.upload('pdf', '2026-11-06/a.pdf', PDF, 'application/pdf');
    await client.upload('pdf', '2026-11-06/a.pdf', PDF, 'application/pdf');
    expect(fake.calls[0]).toMatchObject({ method: 'POST', path: '/storage/v1/object/pdf/2026-11-06/a.pdf', headers: { 'content-type': 'application/pdf', 'x-upsert': 'true' } });
    expect(fake.files.get('pdf/2026-11-06/a.pdf')!.contentType).toBe('application/pdf');
    expect(new Uint8Array((await client.download('pdf', '2026-11-06/a.pdf'))!)).toEqual(PDF);
  });

  it('download : null pour un fichier absent, sans compter pour le disjoncteur', async () => {
    const fake = fakeSupabase();
    const client = createSupabaseClient(config, fake.fetch);
    for (let i = 0; i < 4; i++) expect(await client.download('audio', '2026-01-01/fr.mp3')).toBeNull();
    expect(client.breaker.open).toBe(false);
  });

  it('upload : refuse un fichier vide ou un chemin douteux sans rien envoyer', async () => {
    const fake = fakeSupabase();
    const client = createSupabaseClient(config, fake.fetch);
    await expect(client.upload('pdf', 'a.pdf', new Uint8Array(), 'application/pdf')).rejects.toThrow('fichier vide');
    await expect(client.upload('pdf', '../a.pdf', PDF, 'application/pdf')).rejects.toThrow('chemin de stockage refusé');
    expect(fake.calls).toEqual([]);
  });

  it('remove : un seul DELETE avec la liste des chemins ; rien à envoyer pour une liste vide', async () => {
    const fake = fakeSupabase();
    const client = createSupabaseClient(config, fake.fetch);
    await client.upload('audio', '2026-10-01/fr.mp3', PDF, 'audio/mpeg');
    await client.upload('audio', '2026-10-01/en.mp3', PDF, 'audio/mpeg');
    await client.remove('audio', []);
    await client.remove('audio', ['2026-10-01/fr.mp3', '2026-10-02/absent.mp3']);
    expect(fake.calls.at(-1)).toMatchObject({ method: 'DELETE', path: '/storage/v1/object/audio', body: '{"prefixes":["2026-10-01/fr.mp3","2026-10-02/absent.mp3"]}' });
    expect([...fake.files.keys()]).toEqual(['audio/2026-10-01/en.mp3']);
    expect(fake.calls).toHaveLength(3);
  });
});
```

- [ ] **Étape 2 : vérifier l'échec**

Commande : `npx vitest run pipeline/test/supabase/client.test.ts`
Attendu : échec, « Cannot find module '../../supabase/client' ».

- [ ] **Étape 3 : écrire la configuration et le client**

Fichier `pipeline/supabase/config.ts` :

```ts
import { readSupabaseEnv } from '../context/supabase-env';

export type SupabaseConfig = { url: string; serviceKey: string };

export const MISSING_SUPABASE = 'SUPABASE_URL ou SUPABASE_SERVICE_ROLE_KEY absente';

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

/**
 * Configuration Supabase tirée de l'environnement. L'URL doit être l'origine du projet, en https
 * (http n'est accepté que pour une pile locale) : la clé service n'est jamais envoyée en clair
 * sur le réseau, ni à une URL qui porterait des identifiants, un chemin ou une requête.
 */
export function supabaseConfig(env: Record<string, string | undefined>): { ok: true; config: SupabaseConfig } | { ok: false; error: string } {
  const { url, serviceKey } = readSupabaseEnv(env);
  if (!url || !serviceKey) return { ok: false, error: MISSING_SUPABASE };
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { ok: false, error: 'SUPABASE_URL invalide : URL attendue (https://<projet>.supabase.co)' };
  }
  const local = LOCAL_HOSTS.has(parsed.hostname);
  if (parsed.protocol !== 'https:' && !(parsed.protocol === 'http:' && local)) {
    return { ok: false, error: 'SUPABASE_URL invalide : https obligatoire (http seulement pour localhost)' };
  }
  if (parsed.username || parsed.password || parsed.search || parsed.hash || (parsed.pathname !== '/' && parsed.pathname !== '')) {
    return { ok: false, error: 'SUPABASE_URL invalide : origine seule attendue, sans chemin, requête ni identifiants' };
  }
  return { ok: true, config: { url: parsed.origin, serviceKey } };
}
```

Fichier `pipeline/supabase/client.ts` :

```ts
import { z } from 'zod';
import { Breaker } from '../collect/breaker';
import { deadline, HttpError, messageOf, readCapped, type HttpResponse } from '../collect/http';
import { stripSecrets } from '../lib/redact';
import type { SupabaseConfig } from './config';

/** Requête vers Supabase : comme `HttpInit`, avec DELETE et un corps binaire (envoi de fichiers). */
export type SupabaseInit = {
  method?: 'GET' | 'POST' | 'DELETE';
  headers?: Record<string, string>;
  body?: string | Uint8Array;
  signal?: AbortSignal;
};

/** Sous-ensemble de `fetch` utilisé pour Supabase : injectable dans les tests, aucun appel réseau réel. */
export type SupabaseFetch = (url: string, init?: SupabaseInit) => Promise<HttpResponse>;

/** Réponse en erreur de PostgREST ou de Storage. Le message ne contient ni clé ni corps de requête. */
export class SupabaseError extends HttpError {
  constructor(
    status: number,
    readonly what: string,
    readonly code?: string,
    detail?: string,
  ) {
    super(status, '');
    this.name = 'SupabaseError';
    this.message = `${what} : HTTP ${status}${code ? ` ${code}` : ''}${detail ? ` — ${detail}` : ''}`;
  }
}

/** Supabase n'est plus appelé pendant le reste du passage (voir `Breaker`). */
export class SupabaseDownError extends Error {
  constructor(reason: string) {
    super(`Supabase coupé (${reason})`);
    this.name = 'SupabaseDownError';
  }
}

export type CallOptions = { signal?: AbortSignal; timeoutMs?: number };

export type SupabaseClient = {
  /** Appelle une fonction SQL (`POST /rest/v1/rpc/<fn>`) et valide sa réponse. */
  rpc<T>(fn: string, args: Record<string, unknown>, schema: z.ZodType<T>, opts?: CallOptions): Promise<T>;
  /** Dépose (ou remplace) un fichier dans un bucket. */
  upload(bucket: string, path: string, bytes: Uint8Array, contentType: string, opts?: CallOptions): Promise<void>;
  /** Lit un fichier d'un bucket ; `null` s'il n'existe pas. */
  download(bucket: string, path: string, opts?: CallOptions): Promise<Buffer | null>;
  /** Supprime des fichiers d'un bucket (les fichiers absents sont ignorés). */
  remove(bucket: string, paths: string[], opts?: CallOptions): Promise<void>;
  readonly breaker: Breaker;
};

export const RPC_TIMEOUT_MS = 30_000;
export const STORAGE_TIMEOUT_MS = 120_000;
/** Taille maximale d'une réponse de fonction SQL (octets). */
export const MAX_RPC_BYTES = 5_000_000;
/** Taille maximale d'un fichier envoyé ou relu (octets) : limite du plan gratuit de Supabase Storage. */
export const MAX_FILE_BYTES = 50 * 1024 * 1024;

/** 401/403 : clé refusée ; 402 : quota ; 429 : trop de requêtes (mêmes statuts que `Breaker`). */
const FATAL_STATUS = new Set([401, 402, 403, 429]);

/** Réponse 2xx illisible ou d'une forme inattendue : erreur de données, pas de santé du service. */
class ResponseError extends Error {}

const ErrorBody = z.object({ code: z.string().optional(), message: z.string().optional(), error: z.string().optional() });
const NAME = /^[a-z][a-z0-9_]*$/;
/** Segment de chemin sûr : pas de « .. », pas de barre oblique, caractères simples seulement. */
const SEGMENT = /^(?!\.+$)[A-Za-z0-9._-]+$/;

/** Chemin d'objet `<bucket>/<a>/<b>` encodé, ou erreur si un segment est douteux. */
export function objectPath(bucket: string, path: string): string {
  const segments = [bucket, ...path.split('/')];
  for (const s of segments) if (!SEGMENT.test(s)) throw new Error(`chemin de stockage refusé : « ${bucket}/${path} »`);
  return segments.map(encodeURIComponent).join('/');
}

/**
 * Client Supabase minimal sur `fetch` : fonctions SQL par PostgREST et fichiers par l'API Storage.
 * Chaque appel est borné dans le temps, interruptible par un signal, et passe par un disjoncteur :
 * après un 401, 402, 403, 429, un délai dépassé ou trois échecs de suite, plus aucun appel ne part.
 */
export function createSupabaseClient(config: SupabaseConfig, fetch: SupabaseFetch, base: { signal?: AbortSignal } = {}): SupabaseClient {
  const breaker = new Breaker();
  const clean = (m: string) => stripSecrets(m, [config.serviceKey]);
  const auth = { apikey: config.serviceKey, authorization: `Bearer ${config.serviceKey}` };

  /**
   * Un appel : en-têtes d'authentification, délai, disjoncteur. `read` lit le corps sous le même
   * délai. Une erreur SQL ou de données (4xx hors 401, 402, 403 et 429) ne compte pas pour le
   * disjoncteur : elle ne dit rien de la santé de Supabase.
   */
  async function call<T>(what: string, url: string, init: SupabaseInit, opts: CallOptions | undefined, defaultTimeout: number, read: (res: HttpResponse) => Promise<T>, okStatuses: number[] = []): Promise<T> {
    if (breaker.open) throw new SupabaseDownError(breaker.reason!);
    const parents = [base.signal, opts?.signal].filter((s): s is AbortSignal => !!s);
    const signal = deadline(opts?.timeoutMs ?? defaultTimeout, parents.length ? AbortSignal.any(parents) : undefined);
    try {
      const res = await fetch(url, { ...init, headers: { ...auth, ...init.headers }, signal });
      if (!res.ok && !okStatuses.includes(res.status)) {
        let code: string | undefined;
        let detail: string | undefined;
        try {
          const body = ErrorBody.parse(JSON.parse(new TextDecoder().decode(await readCapped(res, 10_000))));
          code = body.code;
          detail = (body.message ?? body.error)?.slice(0, 200);
        } catch {
          await res.body?.cancel().catch(() => {});
        }
        throw new SupabaseError(res.status, what, code, detail && clean(detail));
      }
      const out = await read(res);
      breaker.success();
      return out;
    } catch (e) {
      if (e instanceof ResponseError) throw new Error(`${what} : ${e.message}`);
      if (e instanceof SupabaseError) {
        if (e.status >= 500 || FATAL_STATUS.has(e.status)) breaker.trip(e);
        throw e;
      }
      breaker.trip(e);
      const err = new Error(`${what} : ${clean(messageOf(e))}`);
      if (e instanceof Error) err.name = e.name; // « TimeoutError » reste reconnaissable
      throw err;
    }
  }

  const discard = async (res: HttpResponse) => {
    await res.body?.cancel().catch(() => {});
  };

  return {
    breaker,

    async rpc(fn, args, schema, opts) {
      if (!NAME.test(fn)) throw new Error(`nom de fonction refusé : « ${fn} »`);
      const init: SupabaseInit = { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json' }, body: JSON.stringify(args) };
      return call(`Supabase ${fn}`, `${config.url}/rest/v1/rpc/${fn}`, init, opts, RPC_TIMEOUT_MS, async (res) => {
        const text = new TextDecoder().decode(await readCapped(res, MAX_RPC_BYTES));
        let data: unknown;
        try {
          data = JSON.parse(text);
        } catch {
          throw new ResponseError('réponse non JSON');
        }
        const parsed = schema.safeParse(data);
        if (!parsed.success) throw new ResponseError(`réponse inattendue (${parsed.error.issues.length} champs invalides)`);
        return parsed.data;
      });
    },

    async upload(bucket, path, bytes, contentType, opts) {
      const target = objectPath(bucket, path);
      if (bytes.byteLength === 0) throw new Error(`Supabase Storage (envoi ${bucket}/${path}) : fichier vide`);
      if (bytes.byteLength > MAX_FILE_BYTES) throw new Error(`Supabase Storage (envoi ${bucket}/${path}) : fichier trop lourd (${bytes.byteLength} octets)`);
      const init: SupabaseInit = { method: 'POST', headers: { 'content-type': contentType, 'x-upsert': 'true' }, body: bytes };
      await call(`Supabase Storage (envoi ${bucket}/${path})`, `${config.url}/storage/v1/object/${target}`, init, opts, STORAGE_TIMEOUT_MS, discard);
    },

    async download(bucket, path, opts) {
      // Storage répond 400 ou 404 pour un objet absent, selon la version.
      return call(
        `Supabase Storage (lecture ${bucket}/${path})`,
        `${config.url}/storage/v1/object/${objectPath(bucket, path)}`,
        { method: 'GET' },
        opts,
        STORAGE_TIMEOUT_MS,
        async (res) => {
          if (!res.ok) {
            await discard(res);
            return null;
          }
          return readCapped(res, MAX_FILE_BYTES);
        },
        [400, 404],
      );
    },

    async remove(bucket, paths, opts) {
      if (paths.length === 0) return;
      for (const p of paths) objectPath(bucket, p);
      const init: SupabaseInit = { method: 'DELETE', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ prefixes: paths }) };
      await call(`Supabase Storage (suppression dans ${bucket})`, `${config.url}/storage/v1/object/${encodeURIComponent(bucket)}`, init, opts, STORAGE_TIMEOUT_MS, discard);
    },
  };
}
```

- [ ] **Étape 4 : vérifier le succès**

Commande : `npx vitest run pipeline/test/supabase/client.test.ts`
Attendu : `Test Files  1 passed (1)` et `Tests  21 passed (21)`.

Commande : `npm test && npm run typecheck`
Attendu : `Test Files  56 passed (56)`, `Tests  509 passed (509)`, et `tsc` sans sortie.

- [ ] **Étape 5 : commit**

```bash
git add pipeline/supabase/config.ts pipeline/supabase/client.ts pipeline/test/supabase/fake-supabase.ts pipeline/test/supabase/client.test.ts
git commit -m "feat(supabase): client REST borné (fonctions SQL et Storage)"
```

---

### Tâche 3 : store Supabase de `brief:context`

**Fichiers :**
- Créer : `supabase/migrations/0002_context_runs.sql`, `pipeline/context/supabase-store.ts`
- Test : `pipeline/test/context/supabase-store.test.ts`

Comportement attendu :
- **Fermeture R12.** `close_stale_threads(p_date, p_days)` ferme, en une seule instruction, les Threads ouverts dont le dernier événement (sinon `updated_at` en date de Paris) date d'au moins 21 jours. Elle renvoie leurs id triés et les note dans `runs.steps.closedThreads`, cumulés entre deux passages du même jour, sans créer de ligne quand rien n'est fermé.
- **Même règle que la mémoire.** Les Threads fermés sont exactement ceux du `MemoryContextStore` sur les mêmes données, y compris un `updated_at` à 22 h 30 UTC, qui est le lendemain à Paris.
- **Threads ouverts.** `context_open_threads()` les renvoie au format `OpenThread`, `updatedAt` en ISO avec `T` et `Z`.
- **Sujets de la veille.** `context_yesterday_topics(p_date)` renvoie ceux de la veille seulement, par langue puis par position.
- **Anomalies.** `context_anomalies` signale un événement à plus de 7 jours dans le futur, sur les Threads ouverts seulement, au même format de message que le store en mémoire.
- **Bilan.** `save_run` écrit le bilan d'une date en gardant les fermetures déjà notées.
- **Droits.** Toutes ces fonctions sont refusées à `anon` et à l'utilisateur de l'appli.
- **Store.** Il transmet le signal : rien n'est écrit après une annulation. Une réponse d'une autre forme est une erreur, jamais une liste vide.
- **Avec `runContext`.** `context.json` est écrit, les Threads périmés sont fermés et l'anomalie est signalée. Une clé refusée donne le code 2, sans la clé dans aucun fichier.

- [ ] **Étape 1 : écrire les tests**

Fichier `pipeline/test/context/supabase-store.test.ts` :

```ts
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ContextSchema, OpenThreadSchema } from '@daily-brief/schema';
import { MemoryContextStore, type StoredThread } from '../../context/memory-store';
import { runContext } from '../../context/run-context';
import { SupabaseContextStore } from '../../context/supabase-store';
import { createSupabaseClient } from '../../supabase/client';
import { FAKE_KEY, FAKE_URL, fakeSupabase, type FakeSupabase } from '../supabase/fake-supabase';
import { asRole, createTestDb, resetData, rows, rpc, type TestDb } from '../supabase/pg';

type Seed = { slug: string; lang?: 'fr' | 'en' | 'es'; updatedAt?: string; status?: 'open' | 'closed'; events?: string[] };

let db: TestDb;
let fake: FakeSupabase;
let store: SupabaseContextStore;

beforeAll(async () => {
  db = await createTestDb();
}, 60_000);
afterAll(async () => {
  await db.close();
});
beforeEach(async () => {
  await resetData(db);
  fake = fakeSupabase(db);
  store = new SupabaseContextStore(createSupabaseClient({ url: FAKE_URL, serviceKey: FAKE_KEY }, fake.fetch));
});

/** Insère des Threads et leurs événements ; renvoie l'id de chaque slug. */
async function seed(threads: Seed[]): Promise<Record<string, string>> {
  const ids: Record<string, string> = {};
  for (const t of threads) {
    const id = (
      await db.query<{ id: string }>(`insert into public.threads (slug, title, lang, status, updated_at) values ($1, $2, $3, $4, $5) returning id`, [
        t.slug,
        `Thread ${t.slug}`,
        t.lang ?? 'fr',
        t.status ?? 'open',
        t.updatedAt ?? '2026-10-01T08:00:00+02:00',
      ])
    ).rows[0].id;
    ids[t.slug] = id;
    for (const date of t.events ?? []) await db.query(`insert into public.thread_events (thread_id, date, title) values ($1, $2, 'événement')`, [id, date]);
  }
  return ids;
}

const slugsOf = (ids: Record<string, string>, list: string[]) => list.map((id) => Object.keys(ids).find((s) => ids[s] === id)).sort();
const openSlugs = async () => (await rows<{ slug: string }>(db, `select slug from public.threads where status = 'open' order by slug`)).map((r) => r.slug);

const R12: Seed[] = [
  { slug: 'vieux', events: ['2026-10-01', '2026-10-16'] },
  { slug: 'frais', events: ['2026-10-17'] },
  { slug: 'sans-evenement', updatedAt: '2026-10-10T09:00:00Z' },
  { slug: 'minuit-paris', updatedAt: '2026-10-16T22:30:00Z' },
  { slug: 'deja-ferme', status: 'closed', events: ['2026-01-01'] },
  { slug: 'futur', events: ['2026-11-20'] },
];

describe('SupabaseContextStore', () => {
  it('ferme les seuls Threads périmés (21 jours pleins), une seule fois', async () => {
    const ids = await seed(R12);
    expect(slugsOf(ids, await store.closeStaleThreads('2026-11-06'))).toEqual(['sans-evenement', 'vieux']);
    expect(await openSlugs()).toEqual(['frais', 'futur', 'minuit-paris']);
    expect(await store.closeStaleThreads('2026-11-06')).toEqual([]);
    // « minuit-paris » : 22:30 UTC le 16 = le 17 à Paris, donc fermé le 7 seulement, comme « frais ».
    expect(slugsOf(ids, await store.closeStaleThreads('2026-11-07', 21))).toEqual(['frais', 'minuit-paris']);
  });

  it('ferme exactement les mêmes Threads que le store en mémoire', async () => {
    const ids = await seed(R12);
    const memory = new MemoryContextStore({
      threads: R12.map((t): StoredThread => ({ id: t.slug, slug: t.slug, title: t.slug, lang: t.lang ?? 'fr', updatedAt: t.updatedAt ?? '2026-10-01T08:00:00+02:00', status: t.status ?? 'open', events: t.events ?? [] })),
    });
    for (const date of ['2026-11-01', '2026-11-06', '2026-11-07', '2026-12-31']) {
      expect(slugsOf(ids, await store.closeStaleThreads(date))).toEqual(await memory.closeStaleThreads(date));
    }
  });

  it('renvoie les ids fermés triés', async () => {
    await seed([{ slug: 'a', events: ['2026-01-01'] }, { slug: 'b', events: ['2026-01-01'] }, { slug: 'c', events: ['2026-01-01'] }]);
    const closed = await store.closeStaleThreads('2026-11-06');
    expect(closed).toHaveLength(3);
    expect(closed).toEqual([...closed].sort());
  });

  it('note les fermetures dans runs, et les cumule entre deux passages du même jour', async () => {
    const ids = await seed([{ slug: 'vieux', events: ['2026-10-01'] }, { slug: 'frais', events: ['2026-10-17'] }]);
    await store.closeStaleThreads('2026-11-06');
    expect(await rows(db, `select date::text as date, status, steps from public.runs`)).toEqual([{ date: '2026-11-06', status: 'running', steps: { closedThreads: [ids.vieux] } }]);
    // Second passage le même jour, avec un délai plus court : le premier Thread fermé reste noté.
    await store.closeStaleThreads('2026-11-06', 20);
    const [run] = await rows<{ steps: { closedThreads: string[] } }>(db, 'select steps from public.runs');
    expect(run.steps.closedThreads).toEqual([ids.vieux, ids.frais].sort());
    // Rien à fermer : pas de nouvelle ligne.
    expect(await store.closeStaleThreads('2026-11-07', 1)).toEqual([]);
    expect(await rows(db, 'select date::text as date from public.runs')).toEqual([{ date: '2026-11-06' }]);
  });

  it('save_run garde les fermetures déjà notées', async () => {
    const ids = await seed([{ slug: 'vieux', events: ['2026-10-01'] }]);
    await store.closeStaleThreads('2026-11-06');
    await rpc(db, 'save_run', { p_date: '2026-11-06', p_status: 'ok', p_steps: { publish: { status: 'ok' }, closedThreads: ['intrus'] }, p_notes: null });
    expect(await rows(db, 'select status, steps from public.runs')).toEqual([{ status: 'ok', steps: { publish: { status: 'ok' }, closedThreads: [ids.vieux] } }]);
  });

  it('Threads ouverts au format OpenThread : updatedAt en ISO avec T et Z', async () => {
    const ids = await seed([
      { slug: 'fr-greve', updatedAt: '2026-11-05T08:00:00+01:00' },
      { slug: 'en-midterms', lang: 'en', updatedAt: '2026-11-04T23:59:59.123Z' },
      { slug: 'ferme', status: 'closed' },
    ]);
    const threads = await store.openThreads();
    expect(threads).toEqual([
      { id: ids['en-midterms'], slug: 'en-midterms', title: 'Thread en-midterms', lang: 'en', updatedAt: '2026-11-04T23:59:59.123Z' },
      { id: ids['fr-greve'], slug: 'fr-greve', title: 'Thread fr-greve', lang: 'fr', updatedAt: '2026-11-05T07:00:00.000Z' },
    ]);
    for (const t of threads) expect(OpenThreadSchema.safeParse(t).success).toBe(true);
  });

  it('sujets de la veille seulement, par langue puis par position', async () => {
    const edition = async (date: string, lang: string, titles: string[]) => {
      const id = (await db.query<{ id: string }>(`insert into public.editions (date, lang, region, headline, morning_brief, generated_at) values ($1, $2, 'r', 'h', '[]', now()) returning id`, [date, lang])).rows[0].id;
      for (const [i, title] of titles.entries()) {
        await db.query(`insert into public.stories (edition_id, key, rubric, position, kicker, date_label, title, summary, visual) values ($1, $2, 'pol', $3, 'k', 'd', $4, 's', '{}')`, [id, `k${i}`, titles.length - i, title]);
      }
    };
    await edition('2026-11-05', 'fr', ['Second', 'Budget au Sénat']);
    await edition('2026-11-05', 'es', ['Presupuestos']);
    await edition('2026-11-04', 'fr', ['Avant-veille']);
    await edition('2026-11-06', 'fr', ['Aujourd’hui']);
    expect(await store.yesterdayTopics('2026-11-06')).toEqual([
      { lang: 'es', title: 'Presupuestos' },
      { lang: 'fr', title: 'Budget au Sénat' },
      { lang: 'fr', title: 'Second' },
    ]);
    expect(await store.yesterdayTopics('2026-03-01')).toEqual([]);
  });

  it('anomalies : événement à plus de 7 jours dans le futur, Threads ouverts seulement', async () => {
    const ids = await seed([
      { slug: 'loin', events: ['2026-11-05', '2026-11-14', '2026-12-01'] },
      { slug: 'limite', events: ['2026-11-13'] },
      { slug: 'ferme', status: 'closed', events: ['2027-01-01'] },
    ]);
    expect(await store.anomalies('2026-11-06')).toEqual([{ threadId: ids.loin, kind: 'future-event', detail: 'événement daté du 2026-12-01, à plus de 7 jours dans le futur' }]);
  });

  it('transmet le signal reçu : rien n’est écrit après une annulation', async () => {
    await seed([{ slug: 'vieux', events: ['2026-10-01'] }]);
    const c = new AbortController();
    c.abort();
    await expect(store.closeStaleThreads('2026-11-06', 21, c.signal)).rejects.toThrow();
    expect(await openSlugs()).toEqual(['vieux']);
    expect(fake.calls[0].signal?.aborted).toBe(true);
  });

  it('une réponse d’une forme inattendue est une erreur, pas une liste vide', async () => {
    fake.intercept = () => ({ json: { ids: [] } });
    await expect(store.closeStaleThreads('2026-11-06')).rejects.toThrow('Supabase close_stale_threads : réponse inattendue');
    await expect(store.openThreads()).rejects.toThrow('Supabase context_open_threads : réponse inattendue');
  });

  it('les fonctions de contexte sont refusées à l’utilisateur de l’appli et au rôle anon', async () => {
    for (const role of ['anon', { email: 'nanigeek@gmail.com' }] as const) {
      await expect(asRole(db, role, (tx) => tx.query(`select public.close_stale_threads('2026-11-06')`))).rejects.toThrow(/permission denied/);
      await expect(asRole(db, role, (tx) => tx.query('select public.context_open_threads()'))).rejects.toThrow(/permission denied/);
      await expect(asRole(db, role, (tx) => tx.query(`select public.save_run('2026-11-06', 'ok', '{}')`))).rejects.toThrow(/permission denied/);
    }
  });
});

describe('runContext avec le store Supabase', () => {
  it('écrit context.json et le rapport, ferme les Threads périmés, signale une anomalie', async () => {
    const ids = await seed([
      { slug: 'vieux', events: ['2026-10-01'] },
      { slug: 'fr-greve', updatedAt: '2026-11-05T08:00:00Z', events: ['2026-11-05'] },
      { slug: 'en-midterms', lang: 'en', updatedAt: '2026-11-04T08:00:00Z', events: ['2026-11-04', '2026-12-25'] },
    ]);
    const outDir = mkdtempSync(join(tmpdir(), 'context-sb-'));
    const r = await runContext({ outDir, date: '2026-11-06', store, secrets: [FAKE_KEY], now: new Date('2026-11-06T04:13:00Z') });
    expect(r.exitCode).toBe(0);
    const context = ContextSchema.parse(JSON.parse(readFileSync(join(outDir, '2026-11-06', 'context.json'), 'utf8')));
    expect(context.openThreads.map((t) => t.slug)).toEqual(['fr-greve', 'en-midterms']);
    expect(r.report).toMatchObject({ store: 'supabase', closedThreads: [ids.vieux], openThreads: 2 });
    expect(r.report.issues).toEqual([{ level: 'warning', message: `Thread ${ids['en-midterms']} : événement daté du 2026-12-25, à plus de 7 jours dans le futur` }]);
  });

  it('clé refusée : code 2, pas de context.json, la clé n’est dans aucun fichier', async () => {
    const outDir = mkdtempSync(join(tmpdir(), 'context-sb-'));
    const bad = new SupabaseContextStore(createSupabaseClient({ url: FAKE_URL, serviceKey: 'mauvaise-clé-secrète' }, fake.fetch));
    const r = await runContext({ outDir, date: '2026-11-06', store: bad, secrets: ['mauvaise-clé-secrète'] });
    expect(r.exitCode).toBe(2);
    expect(r.report.issues).toEqual([{ level: 'error', message: 'store supabase : Supabase close_stale_threads : HTTP 401 — Invalid API key' }]);
    expect(readFileSync(join(outDir, '2026-11-06', 'context-report.json'), 'utf8')).not.toContain('mauvaise-clé-secrète');
  });
});
```

- [ ] **Étape 2 : vérifier l'échec**

Commande : `npx vitest run pipeline/test/context/supabase-store.test.ts`
Attendu : échec, « Cannot find module '../../context/supabase-store' ».

- [ ] **Étape 3 : écrire les fonctions SQL et le store**

Fichier `supabase/migrations/0002_context_runs.sql` :

```sql
-- Daily Brief — fonctions de `brief:context` (fermeture R12, Threads ouverts, sujets de la veille)
-- et bilan du passage (`runs`). Chacune renvoie du jsonb et n'est exécutable que par la clé service.

-- R12 : ferme, en une seule instruction, les Threads ouverts dont le dernier événement
-- (à défaut : updated_at en date de Paris) date d'au moins p_days jours avant p_date.
-- Les fermetures sont notées dans runs.steps.closedThreads : une relance ne les perd pas.
create or replace function public.close_stale_threads(p_date date, p_days integer default 21) returns jsonb
language sql security invoker set search_path = ''
as $$
  with last as (
    select t.id,
           coalesce(
             (select max(te.date) from public.thread_events te where te.thread_id = t.id),
             (t.updated_at at time zone 'Europe/Paris')::date
           ) as last_date
    from public.threads t
    where t.status = 'open'
  ),
  closed as (
    update public.threads t set status = 'closed'
    from last l
    where t.id = l.id and t.status = 'open' and l.last_date <= p_date - p_days
    returning t.id
  ),
  ids as (
    select coalesce(jsonb_agg(c.id::text order by c.id::text), '[]'::jsonb) as list from closed c
  ),
  logged as (
    insert into public.runs as r (date, status, steps)
    select p_date, 'running', jsonb_build_object('closedThreads', ids.list) from ids where jsonb_array_length(ids.list) > 0
    on conflict (date) do update set
      steps = jsonb_set(
        r.steps, '{closedThreads}',
        (select coalesce(jsonb_agg(distinct x.value order by x.value), '[]'::jsonb)
         from jsonb_array_elements(coalesce(r.steps -> 'closedThreads', '[]'::jsonb) || (excluded.steps -> 'closedThreads')) x)
      ),
      updated_at = now()
    returning 1
  )
  select ids.list from ids;
$$;

-- Threads ouverts, au format OpenThread du schéma (updatedAt en ISO 8601 avec « T » et « Z »).
create or replace function public.context_open_threads() returns jsonb
language sql stable security invoker set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', t.id::text, 'slug', t.slug, 'title', t.title, 'lang', t.lang,
    'updatedAt', to_char(t.updated_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
  ) order by t.lang, t.updated_at desc, t.id), '[]'::jsonb)
  from public.threads t
  where t.status = 'open';
$$;

-- Titres des sujets publiés la veille de p_date, toutes langues.
create or replace function public.context_yesterday_topics(p_date date) returns jsonb
language sql stable security invoker set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object('lang', e.lang, 'title', s.title) order by e.lang, s.position), '[]'::jsonb)
  from public.stories s
  join public.editions e on e.id = s.edition_id
  where e.date = p_date - 1;
$$;

-- Threads ouverts ayant un événement daté de plus de p_days jours après p_date (diagnostic).
create or replace function public.context_anomalies(p_date date, p_days integer default 7) returns jsonb
language sql stable security invoker set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object('threadId', x.id::text, 'date', x.last_date::text) order by x.id::text), '[]'::jsonb)
  from (
    select t.id, max(te.date) as last_date
    from public.threads t
    join public.thread_events te on te.thread_id = t.id
    where t.status = 'open' and te.date > p_date + p_days
    group by t.id
  ) x;
$$;

-- Enregistre le bilan du passage d'une date. Les fermetures de Threads déjà notées par
-- close_stale_threads (`steps.closedThreads`) sont conservées.
create or replace function public.save_run(p_date date, p_status text, p_steps jsonb, p_notes text default null) returns jsonb
language sql security invoker set search_path = ''
as $$
  insert into public.runs as r (date, status, steps, notes)
  values (p_date, p_status, (coalesce(p_steps, '{}'::jsonb) - 'closedThreads') || jsonb_build_object('closedThreads', '[]'::jsonb), p_notes)
  on conflict (date) do update set
    status = excluded.status,
    steps = excluded.steps || jsonb_build_object('closedThreads', coalesce(r.steps -> 'closedThreads', '[]'::jsonb)),
    notes = excluded.notes,
    updated_at = now()
  returning jsonb_build_object('id', r.id::text, 'closedThreads', r.steps -> 'closedThreads');
$$;

-- Supabase accorde par défaut l'exécution des fonctions de `public` à anon et authenticated :
-- celles-ci sont réservées à la clé service.
do $$
declare
  f text;
begin
  foreach f in array array[
    'close_stale_threads(date, integer)',
    'context_open_threads()',
    'context_yesterday_topics(date)',
    'context_anomalies(date, integer)',
    'save_run(date, text, jsonb, text)'
  ]
  loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
    execute format('grant execute on function public.%s to service_role', f);
  end loop;
end
$$;
```

Fichier `pipeline/context/supabase-store.ts` :

```ts
import { z } from 'zod';
import { IsoDateSchema, type OpenThread } from '@daily-brief/schema';
import type { SupabaseClient } from '../supabase/client';
import { FUTURE_EVENT_DAYS } from './memory-store';
import { STALE_DAYS } from './stale';
import type { ContextStore, StoreAnomaly, Topic } from './store';

/** Lignes brutes : `runContext` revalide chaque élément, on ne vérifie ici que la forme d'ensemble. */
const Rows = z.array(z.unknown());
const Ids = z.array(z.string().min(1));
const Anomalies = z.array(z.object({ threadId: z.string().min(1), date: IsoDateSchema }));

/**
 * Store Supabase de `brief:context`, avec la clé service. Chaque méthode appelle une fonction SQL
 * de `supabase/migrations/0002_context_runs.sql` et transmet l'`AbortSignal` reçu à la requête HTTP
 * (l'équivalent de `.abortSignal(signal)` de supabase-js). La fermeture R12 est une seule
 * instruction `UPDATE … RETURNING`, qui note aussi les Threads fermés dans `runs`.
 */
export class SupabaseContextStore implements ContextStore {
  readonly name = 'supabase';

  constructor(private readonly client: SupabaseClient) {}

  async openThreads(signal?: AbortSignal): Promise<OpenThread[]> {
    return (await this.client.rpc('context_open_threads', {}, Rows, { signal })) as OpenThread[];
  }

  async yesterdayTopics(date: string, signal?: AbortSignal): Promise<Topic[]> {
    return (await this.client.rpc('context_yesterday_topics', { p_date: date }, Rows, { signal })) as Topic[];
  }

  async closeStaleThreads(date: string, days: number = STALE_DAYS, signal?: AbortSignal): Promise<string[]> {
    return this.client.rpc('close_stale_threads', { p_date: date, p_days: days }, Ids, { signal });
  }

  async anomalies(date: string, signal?: AbortSignal): Promise<StoreAnomaly[]> {
    const found = await this.client.rpc('context_anomalies', { p_date: date, p_days: FUTURE_EVENT_DAYS }, Anomalies, { signal });
    return found.map((a) => ({ threadId: a.threadId, kind: 'future-event' as const, detail: `événement daté du ${a.date}, à plus de ${FUTURE_EVENT_DAYS} jours dans le futur` }));
  }
}
```

- [ ] **Étape 4 : vérifier le succès**

Commande : `npx vitest run pipeline/test/context/supabase-store.test.ts`
Attendu : `Test Files  1 passed (1)` et `Tests  13 passed (13)`.

Commande : `npm test && npm run typecheck`
Attendu : `Test Files  57 passed (57)`, `Tests  522 passed (522)`, et `tsc` sans sortie.

- [ ] **Étape 5 : commit**

```bash
git add supabase/migrations/0002_context_runs.sql pipeline/context/supabase-store.ts pipeline/test/context/supabase-store.test.ts
git commit -m "feat(context): store Supabase, fermeture R12 atomique notée dans runs"
```

---

### Tâche 4 : `brief:context` branché sur Supabase

**Fichiers :**
- Modifier : `pipeline/context/select-store.ts` (réécrit), `pipeline/context/cli.ts`
- Modifier (tests) : `pipeline/test/context/run-context.test.ts`, `pipeline/test/context/cli.test.ts`
- Test : `pipeline/test/context/select-store.test.ts`

Comportement attendu :
- **Avec les deux variables.** `selectStore` renvoie le store Supabase, sans avertissement.
- **Sans elles.** Il renvoie `UnavailableContextStore`, dont chaque appel échoue avec un message qui cite `--allow-empty`. `runContext` écrit alors son rapport et sort avec le code 2, sans `context.json`, sans aucun appel réseau.
- **`--allow-empty`.** Sans configuration, il donne le store vide et l'avertissement d'avant (code 0). Une URL invalide reste une erreur, même avec l'option.
- **CLI.** `brief:context` accepte `--allow-empty`. Supabase injoignable donne le code 2 sans afficher ni écrire la clé.

La signature de `selectStore` change : `selectStore(env, { allowEmpty?, fetch })` renvoie `{ store, warnings }` (une liste, vide quand tout va bien) au lieu de `{ store, warning }`. Ses deux appelants (`cli.ts` et `run-context.test.ts`) changent dans cette tâche.

- [ ] **Étape 1 : écrire les tests**

Fichier `pipeline/test/context/select-store.test.ts` :

```ts
import { describe, expect, it } from 'vitest';
import { selectStore, UnavailableContextStore } from '../../context/select-store';
import { EmptyContextStore } from '../../context/store';
import { SupabaseContextStore } from '../../context/supabase-store';
import { FAKE_KEY, FAKE_URL, fakeSupabase } from '../supabase/fake-supabase';

const ENV = { SUPABASE_URL: FAKE_URL, SUPABASE_SERVICE_ROLE_KEY: FAKE_KEY };

describe('selectStore', () => {
  it('avec les deux variables : store Supabase, sans avertissement, qui appelle le projet avec la clé', async () => {
    const fake = fakeSupabase();
    fake.intercept = () => ({ json: [] });
    const { store, warnings } = selectStore(ENV, { fetch: fake.fetch });
    expect(store).toBeInstanceOf(SupabaseContextStore);
    expect(store.name).toBe('supabase');
    expect(warnings).toEqual([]);
    expect(await store.openThreads()).toEqual([]);
    expect(fake.calls[0]).toMatchObject({ path: '/rest/v1/rpc/context_open_threads', headers: { apikey: FAKE_KEY } });
  });

  it('sans configuration : store indisponible dont chaque appel échoue, aucun appel réseau', async () => {
    const fake = fakeSupabase();
    for (const env of [{}, { SUPABASE_URL: FAKE_URL }, { SUPABASE_SERVICE_ROLE_KEY: FAKE_KEY }, { SUPABASE_URL: FAKE_URL, SUPABASE_SERVICE_ROLE_KEY: '   ' }]) {
      const { store, warnings } = selectStore(env, { fetch: fake.fetch });
      expect(store).toBeInstanceOf(UnavailableContextStore);
      expect(warnings).toEqual([]);
      const message = 'SUPABASE_URL ou SUPABASE_SERVICE_ROLE_KEY absente (--allow-empty pour un contexte vide en développement local)';
      await expect(store.closeStaleThreads('2026-11-06')).rejects.toThrow(message);
      await expect(store.openThreads()).rejects.toThrow(message);
      await expect(store.yesterdayTopics('2026-11-06')).rejects.toThrow(message);
    }
    expect(fake.calls).toEqual([]);
  });

  it('--allow-empty : store vide et avertissement, seulement si la configuration est absente', () => {
    const fake = fakeSupabase();
    const empty = selectStore({}, { allowEmpty: true, fetch: fake.fetch });
    expect(empty.store).toBeInstanceOf(EmptyContextStore);
    expect(empty.warnings).toEqual(['SUPABASE_URL ou SUPABASE_SERVICE_ROLE_KEY absente : contexte vide (aucun Thread ouvert, aucun sujet de la veille)']);
    expect(selectStore(ENV, { allowEmpty: true, fetch: fake.fetch }).store).toBeInstanceOf(SupabaseContextStore);
  });

  it('une URL invalide est une erreur même avec --allow-empty, et la clé n’est envoyée nulle part', async () => {
    const fake = fakeSupabase();
    const { store } = selectStore({ SUPABASE_URL: 'http://projet.supabase.co', SUPABASE_SERVICE_ROLE_KEY: FAKE_KEY }, { allowEmpty: true, fetch: fake.fetch });
    expect(store).toBeInstanceOf(UnavailableContextStore);
    await expect(store.openThreads()).rejects.toThrow('SUPABASE_URL invalide : https obligatoire (http seulement pour localhost)');
    expect(fake.calls).toEqual([]);
  });
});
```

Dans `pipeline/test/context/run-context.test.ts`, le test du store vide passe à la nouvelle signature et un test du code 2 s'ajoute :

Dans `pipeline/test/context/run-context.test.ts`, remplacer :

```ts
import { EmptyContextStore, type ContextStore } from '../../context/store';

```

par :

```ts
import { EmptyContextStore, type ContextStore } from '../../context/store';
import type { SupabaseFetch } from '../../supabase/client';

```

Dans `pipeline/test/context/run-context.test.ts`, remplacer :

```ts
const read = (p: string) => JSON.parse(readFileSync(p, 'utf8'));

```

par :

```ts
const read = (p: string) => JSON.parse(readFileSync(p, 'utf8'));
/** Aucun appel réseau n'est attendu dans ces tests. */
const noFetch: SupabaseFetch = async () => {
  throw new Error('appel réseau inattendu');
};

```

Dans `pipeline/test/context/run-context.test.ts`, remplacer :

```ts
    const { outDir, dayDir } = setup();
    const { store, warning } = selectStore({});
    const r = await runContext({ outDir, date: DAY, store, warnings: [warning], now: NOW });
    expect(r.exitCode).toBe(0);
```

par :

```ts
    const { outDir, dayDir } = setup();
    const { store, warnings } = selectStore({}, { allowEmpty: true, fetch: noFetch });
    const r = await runContext({ outDir, date: DAY, store, warnings, now: NOW });
    expect(r.exitCode).toBe(0);
```

Dans `pipeline/test/context/run-context.test.ts`, remplacer :

```ts
    expect(r.report.issues).toEqual([{ level: 'warning', message: 'SUPABASE_URL ou SUPABASE_SERVICE_ROLE_KEY absente : contexte vide (aucun Thread ouvert, aucun sujet de la veille)' }]);
    expect(selectStore({ SUPABASE_URL: 'https://x.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'k' }).warning).toBe('store Supabase pas encore disponible (lot 4) : contexte vide');
  });
```

par :

```ts
    expect(r.report.issues).toEqual([{ level: 'warning', message: 'SUPABASE_URL ou SUPABASE_SERVICE_ROLE_KEY absente : contexte vide (aucun Thread ouvert, aucun sujet de la veille)' }]);
  });

  it('sans configuration Supabase ni --allow-empty : pas de context.json, rapport écrit, code 2', async () => {
    const { outDir, dayDir } = setup();
    mkdirSync(dayDir, { recursive: true });
    writeFileSync(join(dayDir, 'context.json'), '{"périmé":true}');
    const { store, warnings } = selectStore({}, { fetch: noFetch });
    const r = await runContext({ outDir, date: DAY, store, warnings, now: NOW });
    expect(r.exitCode).toBe(2);
    expect(existsSync(join(dayDir, 'context.json'))).toBe(false);
    expect(read(join(dayDir, 'context-report.json')).issues).toEqual([
      { level: 'error', message: 'store indisponible : SUPABASE_URL ou SUPABASE_SERVICE_ROLE_KEY absente (--allow-empty pour un contexte vide en développement local)' },
    ]);
  });
```

Dans `pipeline/test/context/cli.test.ts`, le comportement sans Supabase change (code 2), `--allow-empty` donne l'ancien comportement, et deux tests s'ajoutent (Supabase injoignable, URL invalide) :

Dans `pipeline/test/context/cli.test.ts`, remplacer :

```ts
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
```

par :

```ts
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
```

Dans `pipeline/test/context/cli.test.ts`, remplacer :

```ts
describe('CLI brief:context', () => {
  it('sans Supabase : contexte vide, avertissement, code 0', () => {
    const r = runCli('pipeline/context/cli.ts', ['--date', '2026-11-06']);
    expect(r.status).toBe(0);
```

par :

```ts
describe('CLI brief:context', () => {
  it('sans Supabase : code 2, rapport écrit, pas de context.json', () => {
    const r = runCli('pipeline/context/cli.ts', ['--date', '2026-11-06']);
    expect(r.status).toBe(2);
    expect(r.stdout).toBe(
      'brief:context 2026-11-06 (store indisponible)\n' +
        '[error] store indisponible : SUPABASE_URL ou SUPABASE_SERVICE_ROLE_KEY absente (--allow-empty pour un contexte vide en développement local)\n' +
        'Erreur : context.json non écrit.\n',
    );
    expect(existsSync(join(r.cwd, 'out/2026-11-06/context.json'))).toBe(false);
    expect(JSON.parse(readFileSync(join(r.cwd, 'out/2026-11-06/context-report.json'), 'utf8')).exitCode).toBe(2);
  }, 30_000);

  it('sans Supabase, avec --allow-empty : contexte vide, avertissement, code 0', () => {
    const r = runCli('pipeline/context/cli.ts', ['--date', '2026-11-06', '--allow-empty']);
    expect(r.status).toBe(0);
```

Dans `pipeline/test/context/cli.test.ts`, remplacer :

```ts

  it('rogne la clé de service : une clé blanche compte pour absente, une clé entourée d’espaces pour présente', () => {
    const blank = runCli('pipeline/context/cli.ts', ['--date', '2026-11-06'], { SUPABASE_URL: 'https://x.supabase.co', SUPABASE_SERVICE_ROLE_KEY: '   ' });
    expect(blank.stdout).toContain('SUPABASE_URL ou SUPABASE_SERVICE_ROLE_KEY absente');
    const padded = runCli('pipeline/context/cli.ts', ['--date', '2026-11-06'], { SUPABASE_URL: 'https://x.supabase.co', SUPABASE_SERVICE_ROLE_KEY: '  clé-secrète  ' });
    expect(padded.stdout).toContain('store Supabase pas encore disponible (lot 4)');
    expect(padded.stdout).not.toContain('clé-secrète');
  }, 30_000);
```

par :

```ts

  it('rogne la clé de service : une clé blanche compte pour absente, même dans l’environnement du processus', () => {
    const blank = runCli('pipeline/context/cli.ts', ['--date', '2026-11-06'], { SUPABASE_URL: 'http://127.0.0.1:9', SUPABASE_SERVICE_ROLE_KEY: '   ' });
    expect(blank.status).toBe(2);
    expect(blank.stdout).toContain('SUPABASE_URL ou SUPABASE_SERVICE_ROLE_KEY absente');
  }, 30_000);

  it('Supabase injoignable : code 2, et la clé n’est ni affichée ni écrite', () => {
    // Port 9 (discard) de la machine locale : connexion refusée, aucun appel hors de la machine.
    const r = runCli('pipeline/context/cli.ts', ['--date', '2026-11-06'], { SUPABASE_URL: 'http://127.0.0.1:9', SUPABASE_SERVICE_ROLE_KEY: '  clé-secrète-de-test  ' });
    expect(r.status).toBe(2);
    expect(r.stdout).toContain('brief:context 2026-11-06 (store supabase)');
    expect(r.stdout).toContain('[error] store supabase : Supabase close_stale_threads : ');
    expect(r.stdout + r.stderr).not.toContain('clé-secrète-de-test');
    expect(readFileSync(join(r.cwd, 'out/2026-11-06/context-report.json'), 'utf8')).not.toContain('clé-secrète-de-test');
    expect(existsSync(join(r.cwd, 'out/2026-11-06/context.json'))).toBe(false);
  }, 30_000);

  it('SUPABASE_URL invalide : code 2 même avec --allow-empty', () => {
    const r = runCli('pipeline/context/cli.ts', ['--date', '2026-11-06', '--allow-empty'], { SUPABASE_URL: 'http://projet.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'clé-secrète-de-test' });
    expect(r.status).toBe(2);
    expect(r.stdout).toContain('[error] store indisponible : SUPABASE_URL invalide : https obligatoire (http seulement pour localhost)');
  }, 30_000);
```

- [ ] **Étape 2 : vérifier l'échec**

Commande : `npx vitest run pipeline/test/context`
Attendu : échec, « Tests  11 failed | 36 passed (47) ».

- [ ] **Étape 3 : réécrire `select-store.ts` et ajouter l'option au CLI**

Contenu actuel de `pipeline/context/select-store.ts`, pour mémoire :

```ts
import { EmptyContextStore, type ContextStore } from './store';

/**
 * Store de `brief:context` d'après l'environnement. Sans SUPABASE_URL ni SUPABASE_SERVICE_ROLE_KEY :
 * store vide et avertissement. Le store Supabase remplace la seconde branche au lot 4.
 */
export function selectStore(env: Record<string, string | undefined>): { store: ContextStore; warning: string } {
  const configured = !!env.SUPABASE_URL?.trim() && !!env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  return {
    store: new EmptyContextStore(),
    warning: configured
      ? 'store Supabase pas encore disponible (lot 4) : contexte vide'
      : 'SUPABASE_URL ou SUPABASE_SERVICE_ROLE_KEY absente : contexte vide (aucun Thread ouvert, aucun sujet de la veille)',
  };
}
```

Nouveau contenu :

Fichier `pipeline/context/select-store.ts` :

```ts
import { createSupabaseClient, type SupabaseFetch } from '../supabase/client';
import { MISSING_SUPABASE, supabaseConfig } from '../supabase/config';
import { EmptyContextStore, type ContextStore } from './store';
import { SupabaseContextStore } from './supabase-store';

/** Store qui échoue toujours : `runContext` écrit alors son rapport et sort avec le code 2. */
export class UnavailableContextStore implements ContextStore {
  readonly name = 'indisponible';

  constructor(private readonly reason: string) {}

  private fail(): never {
    throw new Error(this.reason);
  }

  async openThreads(): Promise<never> {
    return this.fail();
  }

  async yesterdayTopics(): Promise<never> {
    return this.fail();
  }

  async closeStaleThreads(): Promise<never> {
    return this.fail();
  }
}

export type SelectStoreOptions = {
  /** `--allow-empty` : sans configuration Supabase, contexte vide et avertissement (développement local). */
  allowEmpty?: boolean;
  fetch: SupabaseFetch;
};

/**
 * Store de `brief:context` d'après l'environnement. Avec SUPABASE_URL et SUPABASE_SERVICE_ROLE_KEY :
 * store Supabase. Sans elles : store indisponible (code 2), sauf avec `allowEmpty`, qui donne un
 * contexte vide et un avertissement. Une URL invalide est toujours une erreur.
 */
export function selectStore(env: Record<string, string | undefined>, opts: SelectStoreOptions): { store: ContextStore; warnings: string[] } {
  const r = supabaseConfig(env);
  if (r.ok) return { store: new SupabaseContextStore(createSupabaseClient(r.config, opts.fetch)), warnings: [] };
  if (r.error === MISSING_SUPABASE && opts.allowEmpty) {
    return { store: new EmptyContextStore(), warnings: [`${MISSING_SUPABASE} : contexte vide (aucun Thread ouvert, aucun sujet de la veille)`] };
  }
  const hint = r.error === MISSING_SUPABASE ? ' (--allow-empty pour un contexte vide en développement local)' : '';
  return { store: new UnavailableContextStore(`${r.error}${hint}`), warnings: [] };
}
```

Dans `pipeline/context/cli.ts`, remplacer :

```ts
import { redactText } from '../lib/redact';
import { runContext } from './run-context';
```

par :

```ts
import { redactText } from '../lib/redact';
import type { SupabaseFetch } from '../supabase/client';
import { runContext } from './run-context';
```

Dans `pipeline/context/cli.ts`, remplacer :

```ts
  loadEnv(SECRET_ENV);
  const { values } = parseArgs({ options: { date: { type: 'string' }, out: { type: 'string', default: 'out' } } });
  const date = values.date ?? parisToday();
  const { url, serviceKey } = readSupabaseEnv(process.env);
  const { store, warning } = selectStore({ SUPABASE_URL: url, SUPABASE_SERVICE_ROLE_KEY: serviceKey });
  const { exitCode, report } = await runContext({
```

par :

```ts
  loadEnv(SECRET_ENV);
  const { values } = parseArgs({ options: { date: { type: 'string' }, out: { type: 'string', default: 'out' }, 'allow-empty': { type: 'boolean', default: false } } });
  const date = values.date ?? parisToday();
  const { url, serviceKey } = readSupabaseEnv(process.env);
  const { store, warnings } = selectStore({ SUPABASE_URL: url, SUPABASE_SERVICE_ROLE_KEY: serviceKey }, { allowEmpty: values['allow-empty'], fetch: fetch as SupabaseFetch });
  const { exitCode, report } = await runContext({
```

Dans `pipeline/context/cli.ts`, remplacer :

```ts
    store,
    warnings: [warning],
    secrets: [serviceKey],
```

par :

```ts
    store,
    warnings,
    secrets: [serviceKey],
```

- [ ] **Étape 4 : vérifier le succès**

Commande : `npx vitest run pipeline/test/context`
Attendu : `Test Files  5 passed (5)` et `Tests  47 passed (47)`.

Commande : `npm test && npm run typecheck`
Attendu : `Test Files  58 passed (58)`, `Tests  530 passed (530)`, et `tsc` sans sortie.

- [ ] **Étape 5 : commit**

```bash
git add pipeline/context/select-store.ts pipeline/context/cli.ts pipeline/test/context/select-store.test.ts pipeline/test/context/run-context.test.ts pipeline/test/context/cli.test.ts
git commit -m "feat(context): brief:context branché sur Supabase, code 2 sans configuration"
```

---

### Tâche 5 : lignes d'une édition et fichiers du jour

**Fichiers :**
- Créer : `pipeline/publish/files.ts`, `pipeline/publish/rows.ts`
- Test : `pipeline/test/publish/day.ts`, `pipeline/test/publish/rows.test.ts`

Comportement attendu :
- **Slug de Thread.** `threadSlug(lang, titre)` donne la langue, puis le titre sans accents ni ponctuation, borné à 80 caractères, sans tiret final. Un titre sans caractère latin donne une empreinte stable.
- **Charge de `publish_edition`.** `editionPayload(edition, meta)` est une fonction pure et déterministe :
  - les sujets sont numérotés d'un bout à l'autre de l'édition, et chacun garde ses champs JSON ;
  - les sources sont numérotées par sujet, les brèves par rubrique, les mots dans l'ordre du vocabulaire ;
  - l'édition garde ses rubriques et leur ordre (`sections: [{ key, title }]`) ;
  - le statut vaut `light` pour une édition allégée, et les chemins du PDF et du MP3 viennent de `meta` ;
  - l'id d'un Thread existant est gardé, et chaque Thread reçoit son slug.
- **Fichiers du jour.** Noms lisibles pour Drive (`Daily Brief 2026-11-06.pdf`, `Daily Brief 2026-11-06 FR.mp3`, spec §8.5 et §9), chemins ASCII pour Storage (`2026-11-06/daily-brief-2026-11-06.pdf`, `2026-11-06/fr.mp3`).
- **Contrôles.** `isDayFile` vérifie que nom, date, type, bucket et chemin concordent. `looksLikePdf` et `looksLikeMp3` lisent les premiers octets.

`day.ts` prépare un dossier `out/<date>` tel que `brief:render` le laisse : éditions de la fixture redatées, faux PDF, faux MP3, `render-report.json`.

- [ ] **Étape 1 : écrire l'aide de test et les tests**

Fichier `pipeline/test/publish/day.ts` :

```ts
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Edition, Lang } from '@daily-brief/schema';
import { fixtureEdition } from '../helpers';

export const DAY = '2026-11-06';
export const RENDERED_AT = '2026-11-06T04:40:00.000Z';
export const PDF_BYTES = Buffer.from('%PDF-1.7\nfaux PDF de test\n%%EOF\n');
/** Fausse trame MP3 : étiquette ID3 suivie d'octets quelconques. */
export const MP3_BYTES = Buffer.concat([Buffer.from('ID3'), Buffer.from([4, 0, 0, 0, 0, 0, 10, 1, 2, 3, 4, 5])]);

export type DayOptions = {
  date?: string;
  langs?: Lang[];
  /** Langues annoncées par le rendu (par défaut : `langs`). */
  finals?: string[];
  pdf?: Buffer | null;
  /** Nom du PDF annoncé par le rendu (par défaut : le nom attendu, ou null sans PDF). */
  pdfName?: string | null;
  audio?: Lang[];
  edit?: (edition: Edition) => void;
  /** Autres fichiers du dossier du jour (rapports des étapes précédentes, par exemple). */
  extra?: Record<string, string>;
};

/** Édition de la fixture, redatée. */
export function editionFor(lang: Lang, date: string = DAY, edit?: (e: Edition) => void): Edition {
  const edition = fixtureEdition(lang);
  edition.date = date;
  edit?.(edition);
  return edition;
}

/** Dossier `out/<date>` tel que `brief:render` le laisse : éditions finales, PDF, rapport de rendu. */
export function makeDay(opts: DayOptions = {}): { outDir: string; dayDir: string } {
  const date = opts.date ?? DAY;
  const langs = opts.langs ?? (['fr', 'en', 'es'] as Lang[]);
  const outDir = mkdtempSync(join(tmpdir(), 'publish-'));
  const dayDir = join(outDir, date);
  mkdirSync(dayDir, { recursive: true });
  for (const lang of langs) writeFileSync(join(dayDir, `${lang}.final.json`), JSON.stringify(editionFor(lang, date, opts.edit), null, 2) + '\n');
  const pdf = opts.pdf === undefined ? PDF_BYTES : opts.pdf;
  const pdfName = `Daily Brief ${date}.pdf`;
  if (pdf) writeFileSync(join(dayDir, pdfName), pdf);
  for (const lang of opts.audio ?? []) writeFileSync(join(dayDir, `Daily Brief ${date} ${lang.toUpperCase()}.mp3`), MP3_BYTES);
  const report = { date, generatedAt: RENDERED_AT, exitCode: pdf ? 0 : 2, pdf: opts.pdfName === undefined ? (pdf ? pdfName : null) : opts.pdfName, langs: pdf ? langs : [], finals: opts.finals ?? langs, issues: [] };
  writeFileSync(join(dayDir, 'render-report.json'), JSON.stringify(report, null, 2) + '\n');
  for (const [name, text] of Object.entries(opts.extra ?? {})) writeFileSync(join(dayDir, name), text);
  return { outDir, dayDir };
}
```

Fichier `pipeline/test/publish/rows.test.ts` :

```ts
import { describe, expect, it } from 'vitest';
import { isDayFile, looksLikeMp3, looksLikePdf, mp3File, mp3FileName, pdfFile } from '../../publish/files';
import { editionPayload, threadSlug } from '../../publish/rows';
import { fixtureEdition } from '../helpers';
import { MP3_BYTES, PDF_BYTES } from './day';

const META = { pdfPath: '2026-11-06/daily-brief-2026-11-06.pdf', audioPath: null, light: false, generatedAt: '2026-11-06T04:40:00.000Z' };

describe('threadSlug', () => {
  it('langue, puis titre sans accents ni ponctuation', () => {
    expect(threadSlug('fr', 'Épisodes méditerranéens 2026')).toBe('fr-episodes-mediterraneens-2026');
    expect(threadSlug('en', 'Midterms 2026')).toBe('en-midterms-2026');
    expect(threadSlug('fr', 'Midterms 2026')).toBe('fr-midterms-2026');
    expect(threadSlug('es', '  ¿Crisis ferroviaria? — ¡2026!  ')).toBe('es-crisis-ferroviaria-2026');
    expect(threadSlug('fr', 'L’Œuvre de l’été')).toBe('fr-l-uvre-de-l-ete');
  });

  it('borne la longueur et ne finit jamais par un tiret', () => {
    const slug = threadSlug('fr', `${'a'.repeat(79)} b c`);
    expect(slug).toBe(`fr-${'a'.repeat(79)}`);
  });

  it('donne une empreinte stable à un titre sans caractère latin', () => {
    expect(threadSlug('fr', '東京')).toMatch(/^fr-[0-9a-f]{12}$/);
    expect(threadSlug('fr', '東京')).toBe(threadSlug('fr', '東京'));
    expect(threadSlug('fr', '東京')).not.toBe(threadSlug('fr', '北京'));
  });
});

describe('editionPayload', () => {
  it('édition FR de la fixture : en-tête, sujets numérotés, brèves par rubrique, pas de vocabulaire', () => {
    const ed = fixtureEdition('fr');
    const p = editionPayload(ed, META);
    expect(p.edition).toEqual({
      date: '2026-11-06',
      lang: 'fr',
      region: ed.region,
      headline: ed.headline,
      morningBrief: ed.morningBrief,
      sections: ed.sections.map((s) => ({ key: s.key, title: s.title })),
      vocabTitle: null,
      audioPath: null,
      pdfPath: '2026-11-06/daily-brief-2026-11-06.pdf',
      status: 'published',
      generatedAt: '2026-11-06T04:40:00.000Z',
    });
    expect(p.stories.map((s) => [s.position, s.rubric, s.key])).toEqual([
      [1, 'pol', '2026-11-06-fr-1'],
      [2, 'int', '2026-11-06-fr-2'],
      [3, 'int', '2026-11-06-fr-3'],
      [4, 'env', '2026-11-06-fr-4'],
      [5, 'eco', '2026-11-06-fr-5'],
      [6, 'ent', '2026-11-06-fr-6'],
      [7, 'tec', '2026-11-06-fr-7'],
    ]);
    expect(p.briefs.map((b) => [b.rubric, b.position])).toEqual([
      ['eco', 1],
      ['dro', 1],
      ['spo', 1],
      ['spo', 2],
    ]);
    expect(p.vocab).toEqual([]);
  });

  it('reprend chaque champ du sujet et numérote ses sources', () => {
    const ed = fixtureEdition('fr');
    const st = ed.sections[0].stories[0];
    const s = editionPayload(ed, META).stories[0];
    expect(s).toMatchObject({ kicker: st.kicker, dateLabel: st.date, title: st.title, summary: st.summary, visual: st.visual, stats: st.stats, quote: st.quote, divergences: st.divergences, prepa: st.prepa });
    expect(s.thread).toEqual({ slug: 'fr-mobilisation-sociale-de-l-automne', title: 'Mobilisation sociale de l’automne', subtitle: '4e journée de grève nationale' });
    expect(s.sources.map((x) => x.position)).toEqual(st.sources.map((_, i) => i + 1));
    expect(s.sources[0]).toEqual({ rubric: 'pol', position: 1, outlet: st.sources[0].outlet, title: st.sources[0].title, url: st.sources[0].url, lang: st.sources[0].lang, readFull: st.sources[0].readFull, publishedAt: st.sources[0].publishedAt ?? null });
  });

  it('garde l’id d’un Thread existant et laisse null un sujet sans Thread', () => {
    const ed = fixtureEdition('fr');
    ed.sections[0].stories[0].thread = { id: 'abc', title: 'Titre', subtitle: 'suite' };
    ed.sections[1].stories[0].thread = null;
    const p = editionPayload(ed, META);
    expect(p.stories[0].thread).toEqual({ id: 'abc', slug: 'fr-titre', title: 'Titre', subtitle: 'suite' });
    expect(p.stories[1].thread).toBeNull();
  });

  it('édition EN : six mots numérotés, titre du vocabulaire, statut allégé, chemin audio', () => {
    const ed = fixtureEdition('en');
    const p = editionPayload(ed, { ...META, light: true, audioPath: '2026-11-06/en.mp3' });
    expect(p.edition).toMatchObject({ status: 'light', audioPath: '2026-11-06/en.mp3', vocabTitle: ed.vocab!.title });
    expect(p.vocab.map((v) => v.position)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(p.vocab[0]).toEqual({ position: 1, term: ed.vocab!.items[0].term, pos: ed.vocab!.items[0].pos, translation: ed.vocab!.items[0].translation, example: ed.vocab!.items[0].example, sourceUrl: ed.vocab!.items[0].sourceUrl ?? null });
  });

  it('est déterministe et ne modifie pas l’édition', () => {
    const ed = fixtureEdition('es');
    const before = JSON.stringify(ed);
    expect(JSON.stringify(editionPayload(ed, META))).toBe(JSON.stringify(editionPayload(ed, META)));
    expect(JSON.stringify(ed)).toBe(before);
  });
});

describe('fichiers du jour', () => {
  it('noms lisibles pour Drive, chemins ASCII pour Storage', () => {
    expect(pdfFile('2026-11-06')).toEqual({ name: 'Daily Brief 2026-11-06.pdf', mimeType: 'application/pdf', bucket: 'pdf', path: '2026-11-06/daily-brief-2026-11-06.pdf' });
    expect(mp3File('2026-11-06', 'es')).toEqual({ name: 'Daily Brief 2026-11-06 ES.mp3', mimeType: 'audio/mpeg', bucket: 'audio', path: '2026-11-06/es.mp3' });
    expect(mp3FileName('2026-11-06', 'fr')).toBe('Daily Brief 2026-11-06 FR.mp3');
  });

  it('isDayFile : nom, date, type, bucket et chemin doivent concorder', () => {
    expect(isDayFile(pdfFile('2026-11-06'), '2026-11-06')).toBe(true);
    expect(isDayFile(mp3File('2026-11-06', 'en'), '2026-11-06')).toBe(true);
    expect(isDayFile(pdfFile('2026-11-06'), '2026-11-07')).toBe(false);
    expect(isDayFile({ ...pdfFile('2026-11-06'), path: '2026-11-05/daily-brief-2026-11-05.pdf' }, '2026-11-06')).toBe(false);
    expect(isDayFile({ ...pdfFile('2026-11-06'), bucket: 'audio' }, '2026-11-06')).toBe(false);
    expect(isDayFile({ ...mp3File('2026-11-06', 'en'), mimeType: 'application/pdf' }, '2026-11-06')).toBe(false);
    expect(isDayFile({ ...pdfFile('2026-11-06'), name: 'Daily Brief 2026-11-06 FR.pdf' }, '2026-11-06')).toBe(false);
    expect(isDayFile({ ...pdfFile('2026-11-06'), name: '../secret.pdf' }, '2026-11-06')).toBe(false);
  });

  it('reconnaît un PDF et un MP3 à leurs premiers octets', () => {
    expect(looksLikePdf(PDF_BYTES)).toBe(true);
    expect(looksLikePdf(Buffer.from('<html>erreur</html>'))).toBe(false);
    expect(looksLikeMp3(MP3_BYTES)).toBe(true);
    expect(looksLikeMp3(Buffer.from([0xff, 0xfb, 0x90, 0x00]))).toBe(true);
    expect(looksLikeMp3(PDF_BYTES)).toBe(false);
    expect(looksLikeMp3(Buffer.alloc(0))).toBe(false);
  });
});
```

- [ ] **Étape 2 : vérifier l'échec**

Commande : `npx vitest run pipeline/test/publish/rows.test.ts`
Attendu : échec, « Cannot find module '../../publish/files' ».

- [ ] **Étape 3 : écrire les modules**

Fichier `pipeline/publish/files.ts` :

```ts
import type { Lang } from '@daily-brief/schema';
import { pdfFileName } from '../render/issue';

/** Fichier du jour à déposer : nom lisible (Drive), type, emplacement dans Supabase Storage. */
export type DayFile = { name: string; mimeType: 'application/pdf' | 'audio/mpeg'; bucket: 'pdf' | 'audio'; path: string };

export const PDF_MIME = 'application/pdf' as const;
export const MP3_MIME = 'audio/mpeg' as const;

/** Nom du MP3 d'une édition (spec §9) : « Daily Brief 2026-11-06 FR.mp3 ». */
export const mp3FileName = (date: string, lang: Lang) => `Daily Brief ${date} ${lang.toUpperCase()}.mp3`;

/** Les chemins de stockage sont en ASCII sans espace ; le nom lisible ne sert qu'à Drive. */
export const pdfFile = (date: string): DayFile => ({ name: pdfFileName(date), mimeType: PDF_MIME, bucket: 'pdf', path: `${date}/daily-brief-${date}.pdf` });
export const mp3File = (date: string, lang: Lang): DayFile => ({ name: mp3FileName(date, lang), mimeType: MP3_MIME, bucket: 'audio', path: `${date}/${lang}.mp3` });

const NAME = /^Daily Brief (\d{4}-\d{2}-\d{2})(?: (FR|EN|ES))?\.(pdf|mp3)$/;

/**
 * Vrai si le fichier est bien un fichier du Daily Brief de `date` : nom, type, bucket et chemin
 * cohérents entre eux. Sert à revalider les lignes de `drive_pending` avant de relire un fichier.
 */
export function isDayFile(f: DayFile, date: string): boolean {
  const m = NAME.exec(f.name);
  if (!m || m[1] !== date) return false;
  const expected = m[3] === 'pdf' ? (m[2] ? null : pdfFile(date)) : m[2] ? mp3File(date, m[2].toLowerCase() as Lang) : null;
  return expected !== null && expected.mimeType === f.mimeType && expected.bucket === f.bucket && expected.path === f.path;
}

/** Un PDF commence par « %PDF- ». */
export const looksLikePdf = (b: Uint8Array): boolean => b.length > 5 && b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46 && b[4] === 0x2d;

/** Un MP3 commence par une étiquette ID3 ou par une trame (11 bits de synchronisation à 1). */
export const looksLikeMp3 = (b: Uint8Array): boolean => b.length > 3 && ((b[0] === 0x49 && b[1] === 0x44 && b[2] === 0x33) || (b[0] === 0xff && (b[1] & 0xe0) === 0xe0));

export const looksLike = (f: DayFile, bytes: Uint8Array): boolean => (f.mimeType === PDF_MIME ? looksLikePdf(bytes) : looksLikeMp3(bytes));
```

Fichier `pipeline/publish/rows.ts` :

```ts
import { createHash } from 'node:crypto';
import type { Edition, Lang, RubricKey, SourceRef } from '@daily-brief/schema';

export type SourcePayload = { rubric: RubricKey; position: number; outlet: string; title: string; url: string; lang: string; readFull: boolean; publishedAt: string | null };

export type StoryPayload = {
  key: string;
  rubric: RubricKey;
  /** Rang du sujet dans l'édition, à partir de 1, toutes rubriques confondues. */
  position: number;
  kicker: string;
  dateLabel: string;
  title: string;
  summary: string;
  visual: unknown;
  stats: unknown[];
  quote: unknown | null;
  divergences: unknown[];
  prepa: unknown | null;
  /** `id` présent : Thread existant ; absent : nouveau Thread, retrouvé ou créé par son `slug`. */
  thread: { id?: string; slug: string; title: string; subtitle: string } | null;
  sources: SourcePayload[];
};

/** Argument de la fonction SQL `publish_edition` (supabase/migrations/0003_publish.sql). */
export type EditionPayload = {
  edition: {
    date: string;
    lang: Lang;
    region: string;
    headline: string;
    morningBrief: Edition['morningBrief'];
    sections: { key: RubricKey; title: string }[];
    vocabTitle: string | null;
    audioPath: string | null;
    pdfPath: string | null;
    status: 'published' | 'light';
    generatedAt: string;
  };
  stories: StoryPayload[];
  /** Brèves (« En bref ») : sources sans sujet, rangées par rubrique. */
  briefs: SourcePayload[];
  vocab: { position: number; term: string; pos: string; translation: string; example: string; sourceUrl: string | null }[];
};

export type EditionMeta = {
  /** Chemin du PDF dans le bucket `pdf`, ou null s'il n'a pas pu être déposé. */
  pdfPath: string | null;
  /** Chemin du MP3 dans le bucket `audio`, ou null (édition sans lecteur, spec §9). */
  audioPath: string | null;
  /** Édition allégée : moins de 15 textes lus à la collecte (spec §12). */
  light: boolean;
  /** Horodatage ISO du rendu (`generatedAt` de render-report.json). */
  generatedAt: string;
};

/**
 * Slug d'un nouveau Thread : langue, puis titre sans accents ni ponctuation (« fr-midterms-2026 »).
 * Deux éditions peuvent suivre la même histoire sous le même titre : la langue les distingue.
 * Un titre sans lettre ni chiffre latin donne une empreinte stable.
 */
export function threadSlug(lang: Lang, title: string): string {
  const base = title
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
    .replace(/-+$/, '');
  return `${lang}-${base || createHash('sha256').update(title.normalize('NFC')).digest('hex').slice(0, 12)}`;
}

const source = (rubric: RubricKey, position: number, s: SourceRef): SourcePayload => ({
  rubric,
  position,
  outlet: s.outlet,
  title: s.title,
  url: s.url,
  lang: s.lang,
  readFull: s.readFull,
  publishedAt: s.publishedAt ?? null,
});

/**
 * Édition → lignes à écrire (fonction pure). L'ordre du JSON est conservé par les rangs `position` :
 * sujets numérotés d'un bout à l'autre de l'édition, sources par sujet, brèves par rubrique, mots
 * dans l'ordre du « Vocab du jour ».
 */
export function editionPayload(edition: Edition, meta: EditionMeta): EditionPayload {
  let rank = 0;
  const stories: StoryPayload[] = [];
  const briefs: SourcePayload[] = [];
  for (const section of edition.sections) {
    for (const st of section.stories) {
      stories.push({
        key: st.id,
        rubric: section.key,
        position: ++rank,
        kicker: st.kicker,
        dateLabel: st.date,
        title: st.title,
        summary: st.summary,
        visual: st.visual,
        stats: st.stats,
        quote: st.quote,
        divergences: st.divergences,
        prepa: st.prepa,
        thread: st.thread ? { ...(st.thread.id ? { id: st.thread.id } : {}), slug: threadSlug(edition.lang, st.thread.title), title: st.thread.title, subtitle: st.thread.subtitle } : null,
        sources: st.sources.map((s, i) => source(section.key, i + 1, s)),
      });
    }
    section.briefs.forEach((s, i) => briefs.push(source(section.key, i + 1, s)));
  }
  return {
    edition: {
      date: edition.date,
      lang: edition.lang,
      region: edition.region,
      headline: edition.headline,
      morningBrief: edition.morningBrief,
      sections: edition.sections.map((s) => ({ key: s.key, title: s.title })),
      vocabTitle: edition.vocab?.title ?? null,
      audioPath: meta.audioPath,
      pdfPath: meta.pdfPath,
      status: meta.light ? 'light' : 'published',
      generatedAt: meta.generatedAt,
    },
    stories,
    briefs,
    vocab: (edition.vocab?.items ?? []).map((v, i) => ({ position: i + 1, term: v.term, pos: v.pos, translation: v.translation, example: v.example, sourceUrl: v.sourceUrl ?? null })),
  };
}
```

- [ ] **Étape 4 : vérifier le succès**

Commande : `npx vitest run pipeline/test/publish/rows.test.ts`
Attendu : `Test Files  1 passed (1)` et `Tests  11 passed (11)`.

Commande : `npm test && npm run typecheck`
Attendu : `Test Files  59 passed (59)`, `Tests  541 passed (541)`, et `tsc` sans sortie.

- [ ] **Étape 5 : commit**

```bash
git add pipeline/publish/files.ts pipeline/publish/rows.ts pipeline/test/publish/day.ts pipeline/test/publish/rows.test.ts
git commit -m "feat(publish): lignes d'une édition et fichiers du jour"
```

---

### Tâche 6 : lecture contrôlée des sorties du rendu

**Fichiers :**
- Créer : `pipeline/publish/inputs.ts`
- Test : `pipeline/test/publish/inputs.test.ts`

Comportement attendu :
- **Rapport du rendu.** `loadPublishInputs(dayDir, date)` lit `render-report.json`. S'il est absent, illisible, d'une forme inattendue ou d'une autre date, rien n'est publiable, avec une erreur et sans exception.
- **Éditions.** Ne sont lues que celles de `finals`, dans l'ordre FR, EN, ES. Chacune est revalidée par le schéma et contrôlée contre sa langue et sa date ; une édition fautive est écartée avec une erreur, les autres restent.
- **PDF.** Il doit porter exactement le nom attendu (ce qui interdit `../`), exister, être non vide, peser moins de 30 Mo et commencer par `%PDF-`. Sinon, il n'est pas publié et une erreur le dit. Sans PDF au rapport, un simple avertissement.
- **MP3.** Ils sont facultatifs (lot 5) : seuls ceux des éditions publiables sont pris. Un MP3 qui n'en est pas un donne un avertissement, et l'édition est publiée sans lecteur.

- [ ] **Étape 1 : écrire les tests**

Fichier `pipeline/test/publish/inputs.test.ts` :

```ts
import { rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadPublishInputs, MAX_PDF_BYTES } from '../../publish/inputs';
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
      ['fr', 'fr.final.json invalide (1 erreurs)'],
      ['en', 'en.final.json contient l’édition es du 2026-11-06 (attendu'],
      ['es', 'es.final.json illisible'],
    ]);
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
```

- [ ] **Étape 2 : vérifier l'échec**

Commande : `npx vitest run pipeline/test/publish/inputs.test.ts`
Attendu : échec, « Cannot find module '../../publish/inputs' ».

- [ ] **Étape 3 : écrire le module**

Fichier `pipeline/publish/inputs.ts` :

```ts
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import { IsoDateSchema, LANGS, LangSchema, parseEdition, type Edition, type Lang } from '@daily-brief/schema';
import { messageOf } from '../collect/http';
import { pdfFileName } from '../render/issue';
import { looksLike, mp3File, pdfFile, type DayFile } from './files';

export type PublishIssue = { level: 'error' | 'warning'; lang?: Lang; message: string };

/** Fichier local prêt à déposer, avec son contenu. */
export type LocalFile = DayFile & { bytes: Buffer; lang?: Lang };

export type PublishInputs = {
  editions: Edition[];
  pdf: LocalFile | null;
  /** MP3 présents (le lot 5 les produit) : au plus un par édition publiable. */
  audio: LocalFile[];
  /** Horodatage du rendu, ou null si render-report.json est inutilisable. */
  renderedAt: string | null;
  issues: PublishIssue[];
};

const RenderReport = z.object({
  date: IsoDateSchema,
  generatedAt: z.iso.datetime({ offset: true }),
  pdf: z.string().nullable(),
  finals: z.array(LangSchema),
});

/** Taille maximale d'un PDF (octets) : sous la limite de Storage et de l'envoi à Apps Script. */
export const MAX_PDF_BYTES = 30 * 1024 * 1024;
export const MAX_MP3_BYTES = 15 * 1024 * 1024;

function readChecked(dayDir: string, file: DayFile, max: number): Buffer {
  const path = join(dayDir, file.name);
  const size = statSync(path).size;
  if (size === 0) throw new Error('fichier vide');
  if (size > max) throw new Error(`fichier trop lourd (${size} octets, ${max} au plus)`);
  const bytes = readFileSync(path);
  if (!looksLike(file, bytes)) throw new Error(file.bucket === 'pdf' ? 'ce n’est pas un PDF' : 'ce n’est pas un MP3');
  return bytes;
}

/**
 * Lit ce que `brief:render` a produit pour `date` : les `{lang}.final.json` listés dans `finals` de
 * render-report.json, le PDF et, s'ils existent, les MP3. Chaque fichier est contrôlé contre son
 * nom et sa date ; un fichier absent, illisible ou incohérent devient un problème, jamais une
 * exception, et n'est pas publié.
 */
export function loadPublishInputs(dayDir: string, date: string): PublishInputs {
  const out: PublishInputs = { editions: [], pdf: null, audio: [], renderedAt: null, issues: [] };
  const issue = (level: PublishIssue['level'], message: string, lang?: Lang) => out.issues.push({ level, ...(lang ? { lang } : {}), message });

  const reportPath = join(dayDir, 'render-report.json');
  if (!existsSync(reportPath)) {
    issue('error', 'render-report.json absent : rien à publier (lancer brief:render)');
    return out;
  }
  let report: z.infer<typeof RenderReport>;
  try {
    report = RenderReport.parse(JSON.parse(readFileSync(reportPath, 'utf8')));
  } catch (e) {
    issue('error', `render-report.json illisible : ${e instanceof z.ZodError ? `${e.issues.length} champs invalides` : messageOf(e)}`);
    return out;
  }
  if (report.date !== date) {
    issue('error', `render-report.json est celui du ${report.date} (attendu : ${date}) : rien à publier`);
    return out;
  }
  out.renderedAt = report.generatedAt;

  for (const lang of LANGS.filter((l) => report.finals.includes(l))) {
    const name = `${lang}.final.json`;
    const path = join(dayDir, name);
    if (!existsSync(path)) {
      issue('error', `${name} absent alors que le rendu l’annonce : édition non publiée`, lang);
      continue;
    }
    let parsed: ReturnType<typeof parseEdition>;
    try {
      parsed = parseEdition(JSON.parse(readFileSync(path, 'utf8')));
    } catch (e) {
      issue('error', `${name} illisible : ${messageOf(e)}`, lang);
      continue;
    }
    if (!parsed.success) {
      issue('error', `${name} invalide (${parsed.errors.length} erreurs) : ${parsed.errors.slice(0, 3).join(' ; ')}`, lang);
      continue;
    }
    if (parsed.data.lang !== lang || parsed.data.date !== date) {
      issue('error', `${name} contient l’édition ${parsed.data.lang} du ${parsed.data.date} (attendu : ${lang}, ${date}) : édition non publiée`, lang);
      continue;
    }
    out.editions.push(parsed.data);
  }
  if (report.finals.length === 0) issue('error', 'le rendu n’annonce aucune édition (finals vide) : rien à publier');

  if (report.pdf === null) issue('warning', 'le rendu n’a pas produit de PDF : éditions publiées sans PDF');
  else if (report.pdf !== pdfFileName(date)) issue('error', `PDF inattendu « ${report.pdf} » (attendu : ${pdfFileName(date)}) : non publié`);
  else {
    const file = pdfFile(date);
    try {
      out.pdf = { ...file, bytes: readChecked(dayDir, file, MAX_PDF_BYTES) };
    } catch (e) {
      issue('error', `${file.name} : ${(e as NodeJS.ErrnoException).code === 'ENOENT' ? 'absent alors que le rendu l’annonce' : messageOf(e)} — non publié`);
    }
  }

  // MP3 : facultatifs (lot 5). Seuls ceux des éditions publiables sont pris.
  for (const ed of out.editions) {
    const file = mp3File(date, ed.lang);
    if (!existsSync(join(dayDir, file.name))) continue;
    try {
      out.audio.push({ ...file, lang: ed.lang, bytes: readChecked(dayDir, file, MAX_MP3_BYTES) });
    } catch (e) {
      issue('warning', `${file.name} : ${messageOf(e)} — édition publiée sans lecteur`, ed.lang);
    }
  }
  return out;
}
```

- [ ] **Étape 4 : vérifier le succès**

Commande : `npx vitest run pipeline/test/publish/inputs.test.ts`
Attendu : `Test Files  1 passed (1)` et `Tests  12 passed (12)`.

Commande : `npm test && npm run typecheck`
Attendu : `Test Files  60 passed (60)`, `Tests  553 passed (553)`, et `tsc` sans sortie.

- [ ] **Étape 5 : commit**

```bash
git add pipeline/publish/inputs.ts pipeline/test/publish/inputs.test.ts
git commit -m "feat(publish): lecture contrôlée des sorties du rendu"
```

---

### Tâche 7 : publication atomique des éditions

**Fichiers :**
- Créer : `supabase/migrations/0003_publish.sql`, `pipeline/publish/supabase.ts`
- Test : `pipeline/test/publish/supabase.test.ts`

Comportement attendu :
- **Publication.** `publishEditions` appelle `publish_edition` une fois par édition. Les trois éditions de la fixture donnent 7, 1 et 2 sujets, 26, 11 et 13 sources, 0, 6 et 6 mots, et 6 Threads.
- **Fidélité.** Chaque sujet est écrit tel que dans le JSON ; une citation ou un lien prépa absent est `NULL`, pas le JSON `null`. L'événement de son Thread est daté du jour de l'édition.
- **Relance.** Relancer remplace sans doublon, et l'id de l'édition reste le même. Une édition modifiée fait suivre titre, sujets et brèves, et les Threads devenus orphelins disparaissent.
- **Ce qui est gardé.** Mots cochés et état Anki (même terme sans casse ni espaces, dans la même édition) ; Threads suivis. L'état ne passe ni à une autre langue ni à une autre date.
- **Threads.** Rattachement par id, sans renommer le Thread, qui est rafraîchi. Un id inconnu ou d'une autre langue crée un nouveau Thread avec un avertissement. Même titre qu'un Thread ouvert : rattaché ; qu'un Thread fermé : slug daté, stable à la relance. Un événement rouvre un Thread fermé.
- **Atomicité.** Une contrainte violée en fin de charge n'écrit rien de l'édition (transaction), et les autres éditions sont publiées.
- **Fichiers.** Le statut `light` et les chemins viennent des fichiers réellement déposés. `uploadFiles` dépose PDF et MP3 à leur chemin, avec leur type ; un envoi en échec ne coûte qu'un avertissement.
- **Supabase coupé.** Chaque édition est en erreur, sans nouvel appel.
- **Droits.** `publish_edition` refuse une charge sans édition et n'est pas appelable par l'appli.

- [ ] **Étape 1 : écrire les tests**

Fichier `pipeline/test/publish/supabase.test.ts` :

```ts
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Edition } from '@daily-brief/schema';
import { mp3File, pdfFile } from '../../publish/files';
import type { LocalFile } from '../../publish/inputs';
import { editionPayload } from '../../publish/rows';
import { publishEditions, uploadFiles, type PublishMeta } from '../../publish/supabase';
import { createSupabaseClient, type SupabaseClient } from '../../supabase/client';
import { FAKE_KEY, FAKE_URL, fakeSupabase, type FakeSupabase } from '../supabase/fake-supabase';
import { ALLOWED_EMAIL, asRole, createTestDb, resetData, rows, rpc, type TestDb } from '../supabase/pg';
import { DAY, editionFor, MP3_BYTES, PDF_BYTES, RENDERED_AT } from './day';

let db: TestDb;
let fake: FakeSupabase;
let client: SupabaseClient;

beforeAll(async () => {
  db = await createTestDb();
}, 60_000);
afterAll(async () => {
  await db.close();
});
beforeEach(async () => {
  await resetData(db);
  fake = fakeSupabase(db);
  client = createSupabaseClient({ url: FAKE_URL, serviceKey: FAKE_KEY }, fake.fetch);
});

const META: PublishMeta = { stored: [pdfFile(DAY)], light: {}, generatedAt: RENDERED_AT };
const count = async (table: string, where = 'true') => (await rows<{ n: number }>(db, `select count(*)::int as n from public.${table} where ${where}`))[0].n;
const publish = (editions: Edition[], meta: PublishMeta = META) => publishEditions(client, editions, meta);
const threads = () => rows<{ slug: string; lang: string; status: string; followed: boolean; events: number }>(
  db,
  `select t.slug, t.lang, t.status, t.followed, (select count(*)::int from public.thread_events e where e.thread_id = t.id) as events from public.threads t order by t.slug`,
);

describe('publishEditions', () => {
  it('publie les trois éditions de la fixture : lignes, rangs et Threads', async () => {
    const editions = [editionFor('fr'), editionFor('en'), editionFor('es')];
    const r = await publish(editions);
    expect(r.issues).toEqual([]);
    expect(r.results).toEqual([
      { lang: 'fr', published: true, stories: 7, sources: 26, vocab: 0, threadsCreated: 4 },
      { lang: 'en', published: true, stories: 1, sources: 11, vocab: 6, threadsCreated: 1 },
      { lang: 'es', published: true, stories: 2, sources: 13, vocab: 6, threadsCreated: 1 },
    ]);
    expect(await rows(db, `select date::text as date, lang, status, pdf_path, audio_path, vocab_title, generated_at = $1::timestamptz as same from public.editions order by lang`, [RENDERED_AT])).toEqual([
      { date: DAY, lang: 'en', status: 'published', pdf_path: '2026-11-06/daily-brief-2026-11-06.pdf', audio_path: null, vocab_title: editions[1].vocab!.title, same: true },
      { date: DAY, lang: 'es', status: 'published', pdf_path: '2026-11-06/daily-brief-2026-11-06.pdf', audio_path: null, vocab_title: editions[2].vocab!.title, same: true },
      { date: DAY, lang: 'fr', status: 'published', pdf_path: '2026-11-06/daily-brief-2026-11-06.pdf', audio_path: null, vocab_title: null, same: true },
    ]);
    expect(await threads()).toEqual([
      { slug: 'en-midterms-2026', lang: 'en', status: 'open', followed: false, events: 1 },
      { slug: 'es-crisis-ferroviaria-2026', lang: 'es', status: 'open', followed: false, events: 1 },
      { slug: 'fr-episodes-mediterraneens-2026', lang: 'fr', status: 'open', followed: false, events: 1 },
      { slug: 'fr-guerre-en-ukraine', lang: 'fr', status: 'open', followed: false, events: 1 },
      { slug: 'fr-midterms-2026', lang: 'fr', status: 'open', followed: false, events: 1 },
      { slug: 'fr-mobilisation-sociale-de-l-automne', lang: 'fr', status: 'open', followed: false, events: 1 },
    ]);
  });

  it('écrit le sujet tel que dans le JSON, et l’événement de son Thread à la date de l’édition', async () => {
    const fr = editionFor('fr');
    await publish([fr]);
    const st = fr.sections[0].stories[0];
    const [row] = await rows(
      db,
      `select s.key, s.rubric, s.position, s.kicker, s.date_label, s.title, s.summary, s.visual, s.stats, s.quote, s.divergences, s.prepa, s.thread_subtitle, t.slug
       from public.stories s left join public.threads t on t.id = s.thread_id where s.position = 1`,
    );
    expect(row).toEqual({ key: st.id, rubric: 'pol', position: 1, kicker: st.kicker, date_label: st.date, title: st.title, summary: st.summary, visual: st.visual, stats: st.stats, quote: st.quote, divergences: st.divergences, prepa: st.prepa, thread_subtitle: st.thread!.subtitle, slug: 'fr-mobilisation-sociale-de-l-automne' });
    expect(await rows(db, `select e.date::text as date, e.title, e.text from public.thread_events e join public.threads t on t.id = e.thread_id where t.slug = 'fr-mobilisation-sociale-de-l-automne'`)).toEqual([
      { date: DAY, title: st.title, text: st.thread!.subtitle },
    ]);
    expect(await rows(db, `select outlet, url, read_full, position from public.sources where story_id = (select id from public.stories where position = 1) order by position`)).toEqual(
      st.sources.map((s, i) => ({ outlet: s.outlet, url: s.url, read_full: s.readFull, position: i + 1 })),
    );
    expect(await count('sources', 'story_id is null')).toBe(4);
    // Une citation ou un lien prépa absent est NULL en base, pas le JSON « null ».
    expect(await count('stories', `quote = 'null'::jsonb or prepa = 'null'::jsonb`)).toBe(0);
    expect(await count('stories', 'quote is null')).toBe(fr.sections.flatMap((s) => s.stories).filter((s) => s.quote === null).length);
  });

  it('relancer la même date remplace les données sans doublon', async () => {
    const editions = [editionFor('fr'), editionFor('en'), editionFor('es')];
    await publish(editions);
    const before = [await count('editions'), await count('stories'), await count('sources'), await count('vocab_items'), await count('threads'), await count('thread_events')];
    const ids = await rows(db, 'select id from public.editions order by lang');
    const r = await publish(editions);
    expect(r.results.map((x) => x.threadsCreated)).toEqual([0, 0, 0]);
    expect([await count('editions'), await count('stories'), await count('sources'), await count('vocab_items'), await count('threads'), await count('thread_events')]).toEqual(before);
    expect(before).toEqual([3, 10, 50, 12, 6, 6]);
    expect(await rows(db, 'select id from public.editions order by lang')).toEqual(ids);
  });

  it('relancer avec une édition modifiée : titre, sujets retirés et brèves suivent', async () => {
    await publish([editionFor('fr')]);
    const changed = editionFor('fr', DAY, (e) => {
      e.headline = 'Nouveau titre du jour';
      e.sections = e.sections.slice(0, 1);
      e.sections[0].briefs = [];
    });
    await publish([changed]);
    expect(await rows(db, 'select headline from public.editions')).toEqual([{ headline: 'Nouveau titre du jour' }]);
    expect([await count('stories'), await count('sources', 'story_id is null')]).toEqual([1, 0]);
    // Les Threads créés par la première publication et restés sans événement disparaissent.
    expect((await threads()).map((t) => t.slug)).toEqual(['fr-mobilisation-sociale-de-l-automne']);
  });

  it('garde les mots cochés et leur état Anki quand la date est relancée', async () => {
    const en = editionFor('en');
    await publish([en]);
    const [a, b, c] = en.vocab!.items.map((v) => v.term);
    await asRole(db, { email: ALLOWED_EMAIL }, async (tx) => {
      await tx.query(`update public.vocab_items set selected = true, anki_status = 'queued' where term = $1`, [a]);
      await tx.query(`update public.vocab_items set selected = true where term = $1`, [b]);
    });
    await db.query(`update public.vocab_items set anki_status = 'sent' where term = $1`, [c]);
    // Relance : même mot écrit autrement (casse, espaces), un mot remplacé, ordre inversé.
    const again = editionFor('en', DAY, (e) => {
      e.vocab!.items[0].term = `  ${a.toUpperCase()} `;
      e.vocab!.items[5].term = 'brand-new word';
      e.vocab!.items.reverse();
    });
    await publish([again]);
    const state = await rows<{ term: string; selected: boolean; anki_status: string; position: number }>(db, 'select term, selected, anki_status, position from public.vocab_items order by position');
    expect(state).toHaveLength(6);
    expect(state.find((v) => v.term === `  ${a.toUpperCase()} `)).toMatchObject({ selected: true, anki_status: 'queued', position: 6 });
    expect(state.find((v) => v.term === b)).toMatchObject({ selected: true, anki_status: 'none' });
    expect(state.find((v) => v.term === c)).toMatchObject({ selected: false, anki_status: 'sent' });
    expect(state.find((v) => v.term === 'brand-new word')).toMatchObject({ selected: false, anki_status: 'none', position: 1 });
  });

  it('l’état d’un mot ne passe ni à une autre langue ni à une autre date', async () => {
    const en = editionFor('en');
    await publish([en]);
    await db.query(`update public.vocab_items set selected = true, anki_status = 'queued'`);
    const es = editionFor('es', DAY, (e) => {
      e.vocab!.items[0].term = en.vocab!.items[0].term;
    });
    const tomorrow = editionFor('en', '2026-11-07');
    await publish([es, tomorrow], { ...META, stored: [] });
    expect(await count('vocab_items', `selected and edition_id in (select id from public.editions where lang = 'es' or date = '2026-11-07')`)).toBe(0);
    expect(await count('vocab_items', 'selected')).toBe(6);
  });

  it('garde « suivi » sur un Thread quand la date est relancée', async () => {
    const fr = editionFor('fr');
    await publish([fr]);
    await asRole(db, { email: ALLOWED_EMAIL }, (tx) => tx.query(`update public.threads set followed = true where slug = 'fr-guerre-en-ukraine'`));
    const id = (await rows<{ id: string }>(db, `select id from public.threads where slug = 'fr-guerre-en-ukraine'`))[0].id;
    await publish([fr]);
    expect(await rows(db, `select id, followed from public.threads where slug = 'fr-guerre-en-ukraine'`)).toEqual([{ id, followed: true }]);
  });

  it('rattache un sujet au Thread existant désigné par son id, sans le renommer', async () => {
    const id = (await db.query<{ id: string }>(`insert into public.threads (slug, title, lang, updated_at) values ('fr-guerre-en-ukraine', 'Guerre en Ukraine', 'fr', '2026-10-01T00:00:00Z') returning id`)).rows[0].id;
    await db.query(`insert into public.thread_events (thread_id, date, title) values ($1, '2026-10-30', 'Étape précédente')`, [id]);
    const fr = editionFor('fr', DAY, (e) => {
      e.sections = e.sections.filter((s) => s.key === 'int');
      e.sections[0].stories = e.sections[0].stories.filter((s) => s.thread?.title === 'Guerre en Ukraine');
      e.sections[0].stories[0].thread = { id, title: 'Un autre libellé', subtitle: 'l’énergie, cible de l’hiver' };
    });
    const r = await publish([fr]);
    expect(r.issues).toEqual([]);
    expect(r.results[0].threadsCreated).toBe(0);
    expect(await rows(db, `select t.title, (t.updated_at > '2026-11-01') as refreshed, (select count(*)::int from public.thread_events e where e.thread_id = t.id) as events from public.threads t`)).toEqual([
      { title: 'Guerre en Ukraine', refreshed: true, events: 2 },
    ]);
    // Relance : l'événement du jour est remplacé, l'ancien reste, le Thread aussi.
    await publish([fr]);
    expect(await rows(db, `select date::text as date from public.thread_events order by date`)).toEqual([{ date: '2026-10-30' }, { date: DAY }]);
  });

  it('id de Thread inconnu ou d’une autre langue : nouveau Thread et avertissement', async () => {
    const other = (await db.query<{ id: string }>(`insert into public.threads (slug, title, lang) values ('en-x', 'X', 'en') returning id`)).rows[0].id;
    await db.query(`insert into public.thread_events (thread_id, date, title) values ($1, '2026-11-01', 'x')`, [other]);
    const fr = editionFor('fr', DAY, (e) => {
      e.sections = e.sections.slice(0, 2);
      e.sections[0].stories[0].thread = { id: other, title: 'Mobilisation', subtitle: 's' };
      e.sections[1].stories[0].thread = { id: 'pas-un-uuid', title: 'Midterms 2026', subtitle: 's' };
      e.sections[1].stories[1].thread = null;
    });
    const r = await publish([fr]);
    expect(r.results[0]).toMatchObject({ published: true, threadsCreated: 2 });
    expect(r.issues).toEqual([
      { level: 'warning', lang: 'fr', message: `2026-11-06-fr-1 : Thread ${other} inconnu ou d'une autre langue, traité comme nouveau Thread` },
      { level: 'warning', lang: 'fr', message: `2026-11-06-fr-2 : Thread pas-un-uuid inconnu ou d'une autre langue, traité comme nouveau Thread` },
    ]);
    expect((await threads()).map((t) => [t.slug, t.events])).toEqual([
      ['en-x', 1],
      ['fr-midterms-2026', 1],
      ['fr-mobilisation', 1],
    ]);
  });

  it('nouveau Thread de même titre qu’un Thread ouvert : rattaché ; qu’un Thread fermé : nouveau slug daté, stable à la relance', async () => {
    await db.query(`insert into public.threads (slug, title, lang, status) values ('fr-midterms-2026', 'Midterms 2026', 'fr', 'open'), ('fr-guerre-en-ukraine', 'Guerre en Ukraine', 'fr', 'closed')`);
    const fr = editionFor('fr', DAY, (e) => {
      e.sections = e.sections.filter((s) => s.key === 'int');
    });
    const first = await publish([fr]);
    expect(first.results[0].threadsCreated).toBe(1);
    const expected = [
      { slug: 'fr-guerre-en-ukraine', lang: 'fr', status: 'closed', followed: false, events: 0 },
      { slug: 'fr-guerre-en-ukraine-2026-11-06', lang: 'fr', status: 'open', followed: false, events: 1 },
      { slug: 'fr-midterms-2026', lang: 'fr', status: 'open', followed: false, events: 1 },
    ];
    expect(await threads()).toEqual(expected);
    const second = await publish([fr]);
    expect(second.results[0].threadsCreated).toBe(0);
    expect(await threads()).toEqual(expected);
  });

  it('un événement rouvre un Thread fermé désigné par son id', async () => {
    const id = (await db.query<{ id: string }>(`insert into public.threads (slug, title, lang, status) values ('fr-ancien', 'Ancien', 'fr', 'closed') returning id`)).rows[0].id;
    const fr = editionFor('fr', DAY, (e) => {
      e.sections = e.sections.slice(0, 1);
      e.sections[0].stories[0].thread = { id, title: 'Ancien', subtitle: 'reprise' };
    });
    await publish([fr]);
    expect(await threads()).toEqual([{ slug: 'fr-ancien', lang: 'fr', status: 'open', followed: false, events: 1 }]);
  });

  it('une édition en échec n’écrit rien (transaction) et n’empêche pas les autres', async () => {
    await publish([editionFor('en')]);
    const before = [await count('stories'), await count('sources'), await count('vocab_items'), await count('threads')];
    const headline = (await rows<{ headline: string }>(db, 'select headline from public.editions'))[0].headline;
    // Charge altérée en route : la seconde source du dernier sujet viole une contrainte NOT NULL,
    // après que l'en-tête, les sujets et les premières sources ont été écrits dans la transaction.
    const viaBroken = createSupabaseClient({ url: FAKE_URL, serviceKey: FAKE_KEY }, async (url, init) => {
      const body = typeof init?.body === 'string' && url.endsWith('/publish_edition') ? JSON.parse(init.body) : null;
      if (body?.payload.edition.lang !== 'en') return fake.fetch(url, init);
      body.payload.edition.headline = 'Titre qui ne doit pas rester';
      body.payload.stories.at(-1).sources[1].readFull = null;
      return fake.fetch(url, { ...init, body: JSON.stringify(body) });
    });
    const r = await publishEditions(viaBroken, [editionFor('en'), editionFor('es')], META);
    expect(r.results.map((x) => [x.lang, x.published])).toEqual([
      ['en', false],
      ['es', true],
    ]);
    expect(r.issues).toHaveLength(1);
    expect(r.issues[0]).toMatchObject({ level: 'error', lang: 'en' });
    expect(r.issues[0].message).toMatch(/^édition non publiée : Supabase publish_edition : HTTP 400 23502 — /);
    expect(await rows(db, `select headline from public.editions where lang = 'en'`)).toEqual([{ headline }]);
    expect([await count('stories', `edition_id in (select id from public.editions where lang = 'en')`), await count('vocab_items', `lang = 'en'`)]).toEqual([before[0], before[2]]);
    expect(await count('editions')).toBe(2);
  });

  it('statut « light » et chemin audio par édition, d’après les fichiers réellement déposés', async () => {
    await publish([editionFor('fr'), editionFor('en')], { stored: [mp3File(DAY, 'en')], light: { fr: true }, generatedAt: RENDERED_AT });
    expect(await rows(db, 'select lang, status, pdf_path, audio_path from public.editions order by lang')).toEqual([
      { lang: 'en', status: 'published', pdf_path: null, audio_path: '2026-11-06/en.mp3' },
      { lang: 'fr', status: 'light', pdf_path: null, audio_path: null },
    ]);
  });

  it('Supabase coupé : chaque édition est en erreur, sans nouvel appel', async () => {
    fake.intercept = () => ({ status: 401, json: { message: 'Invalid API key' } });
    const r = await publish([editionFor('fr'), editionFor('en')]);
    expect(r.results.map((x) => x.published)).toEqual([false, false]);
    expect(r.issues.map((i) => i.message)).toEqual(['édition non publiée : Supabase publish_edition : HTTP 401 — Invalid API key', 'édition non publiée : Supabase coupé (HTTP 401)']);
    expect(fake.calls).toHaveLength(1);
  });

  it('publish_edition refuse une charge sans édition, et n’est pas appelable par l’appli', async () => {
    await expect(rpc(db, 'publish_edition', { payload: {} })).rejects.toThrow('publish_edition : édition absente ou incomplète');
    const payload = editionPayload(editionFor('en'), { pdfPath: null, audioPath: null, light: false, generatedAt: RENDERED_AT });
    await expect(rpc(db, 'publish_edition', { payload }, { email: ALLOWED_EMAIL })).rejects.toThrow(/permission denied/);
    await expect(rpc(db, 'publish_edition', { payload }, 'anon')).rejects.toThrow(/permission denied/);
    expect(await count('editions')).toBe(0);
  });
});

describe('uploadFiles', () => {
  const pdf: LocalFile = { ...pdfFile(DAY), bytes: PDF_BYTES };
  const mp3: LocalFile = { ...mp3File(DAY, 'fr'), lang: 'fr', bytes: MP3_BYTES };

  it('dépose le PDF et les MP3 à leur chemin, avec leur type', async () => {
    const r = await uploadFiles(client, [pdf, mp3]);
    expect(r).toEqual({ stored: [pdfFile(DAY), mp3File(DAY, 'fr')], issues: [] });
    expect([...fake.files.entries()].map(([k, v]) => [k, v.contentType, v.bytes.length])).toEqual([
      ['pdf/2026-11-06/daily-brief-2026-11-06.pdf', 'application/pdf', PDF_BYTES.length],
      ['audio/2026-11-06/fr.mp3', 'audio/mpeg', MP3_BYTES.length],
    ]);
  });

  it('un envoi en échec donne un avertissement ; les autres fichiers passent', async () => {
    fake.intercept = (call) => (call.path.includes('/object/pdf/') ? { status: 413, json: { message: 'The object exceeded the maximum allowed size' } } : undefined);
    const r = await uploadFiles(client, [pdf, mp3]);
    expect(r.stored).toEqual([mp3File(DAY, 'fr')]);
    expect(r.issues).toEqual([
      { level: 'warning', message: 'Daily Brief 2026-11-06.pdf non déposé dans Supabase Storage : Supabase Storage (envoi pdf/2026-11-06/daily-brief-2026-11-06.pdf) : HTTP 413 — The object exceeded the maximum allowed size' },
    ]);
  });

  it('relancer remplace le fichier', async () => {
    await uploadFiles(client, [pdf]);
    const r = await uploadFiles(client, [{ ...pdf, bytes: Buffer.concat([PDF_BYTES, Buffer.from('v2')]) }]);
    expect(r.issues).toEqual([]);
    expect(fake.files.get('pdf/2026-11-06/daily-brief-2026-11-06.pdf')!.bytes.length).toBe(PDF_BYTES.length + 2);
  });
});
```

- [ ] **Étape 2 : vérifier l'échec**

Commande : `npx vitest run pipeline/test/publish/supabase.test.ts`
Attendu : échec, « Cannot find module '../../publish/supabase' ».

- [ ] **Étape 3 : écrire la fonction SQL et le module**

Fichier `supabase/migrations/0003_publish.sql` :

```sql
-- Daily Brief — publication d'une édition complète, d'un seul tenant.
-- Exécutable par la clé service seulement.

-- Publie une édition d'un seul tenant : la fonction s'exécute dans une transaction, donc une erreur
-- ne laisse jamais une édition à moitié publiée. Relancer une date remplace ses sujets, sources,
-- événements de Thread et mots, en gardant vocab_items.selected / anki_status (même mot, sans casse)
-- et threads.followed (les Threads ne sont jamais recréés).
create or replace function public.publish_edition(payload jsonb) returns jsonb
language plpgsql security invoker set search_path = ''
as $$
declare
  e jsonb := payload -> 'edition';
  v_date date;
  v_lang text;
  v_edition uuid;
  v_vocab_state jsonb;
  v_old_threads uuid[];
  s jsonb;
  t jsonb;
  v_slug text;
  v_thread uuid;
  v_story uuid;
  v_created jsonb := '[]'::jsonb;
  v_warnings jsonb := '[]'::jsonb;
  n_stories integer := 0;
  n_sources integer := 0;
  n_vocab integer := 0;
  n_removed integer := 0;
  n integer;
begin
  if e is null or jsonb_typeof(e) <> 'object' or e ->> 'date' is null or e ->> 'lang' is null then
    raise exception 'publish_edition : édition absente ou incomplète' using errcode = '22023';
  end if;
  v_date := (e ->> 'date')::date;
  v_lang := e ->> 'lang';
  -- Deux publications simultanées de la même édition s'exécutent l'une après l'autre.
  perform pg_advisory_xact_lock(hashtextextended('publish_edition:' || v_date::text || ':' || v_lang, 0));

  insert into public.editions as ed
    (date, lang, region, headline, morning_brief, sections, vocab_title, audio_path, pdf_path, status, generated_at, published_at)
  values (
    v_date, v_lang, e ->> 'region', e ->> 'headline', e -> 'morningBrief', coalesce(e -> 'sections', '[]'::jsonb),
    e ->> 'vocabTitle', e ->> 'audioPath', e ->> 'pdfPath', coalesce(e ->> 'status', 'published'),
    (e ->> 'generatedAt')::timestamptz, now()
  )
  on conflict (date, lang) do update set
    region = excluded.region,
    headline = excluded.headline,
    morning_brief = excluded.morning_brief,
    sections = excluded.sections,
    vocab_title = excluded.vocab_title,
    audio_path = excluded.audio_path,
    pdf_path = excluded.pdf_path,
    status = excluded.status,
    generated_at = excluded.generated_at,
    published_at = now()
  returning ed.id into v_edition;

  -- État choisi par l'utilisateur, par mot (sans casse ni espaces autour). Pour un mot en double,
  -- on garde le plus avancé : none < queued < sent (ordre alphabétique).
  select coalesce(jsonb_object_agg(x.k, x.st), '{}'::jsonb) into v_vocab_state
  from (
    select lower(btrim(v.term)) as k,
           jsonb_build_object('selected', bool_or(v.selected), 'anki_status', max(v.anki_status)) as st
    from public.vocab_items v
    where v.edition_id = v_edition
    group by 1
  ) x;

  select coalesce(array_agg(distinct te.thread_id), '{}'::uuid[]) into v_old_threads
  from public.thread_events te
  join public.stories st on st.id = te.story_id
  where st.edition_id = v_edition;

  delete from public.stories where edition_id = v_edition;      -- emporte ses sources et ses événements
  delete from public.sources where edition_id = v_edition;      -- brèves
  delete from public.vocab_items where edition_id = v_edition;

  for s in select value from jsonb_array_elements(coalesce(payload -> 'stories', '[]'::jsonb))
  loop
    v_thread := null;
    t := s -> 'thread';
    if t is not null and jsonb_typeof(t) = 'object' then
      if t ->> 'id' is not null then
        select th.id into v_thread from public.threads th where th.id::text = t ->> 'id' and th.lang = v_lang;
        if v_thread is null then
          v_warnings := v_warnings || to_jsonb(format('%s : Thread %s inconnu ou d''une autre langue, traité comme nouveau Thread', s ->> 'key', t ->> 'id'));
        end if;
      end if;
      if v_thread is null then
        v_slug := t ->> 'slug';
        select th.id into v_thread from public.threads th where th.slug = v_slug and th.lang = v_lang and th.status = 'open';
        if v_thread is null then
          -- Le slug est pris par un Thread fermé (ou d'une autre langue) : nouveau Thread daté.
          if exists (select 1 from public.threads th where th.slug = v_slug) then
            v_slug := v_slug || '-' || v_date::text;
          end if;
          select th.id into v_thread from public.threads th where th.slug = v_slug and th.lang = v_lang;
          if v_thread is null then
            insert into public.threads (slug, title, lang) values (v_slug, t ->> 'title', v_lang) returning id into v_thread;
            v_created := v_created || to_jsonb(v_thread::text);
          end if;
        end if;
      end if;
      -- Un nouvel événement rouvre le Thread et le rafraîchit.
      update public.threads set status = 'open', updated_at = now() where id = v_thread;
    end if;

    insert into public.stories
      (edition_id, key, rubric, position, kicker, date_label, title, summary, visual, stats, quote, divergences, prepa, thread_id, thread_subtitle)
    values (
      v_edition, s ->> 'key', s ->> 'rubric', (s ->> 'position')::integer, s ->> 'kicker', s ->> 'dateLabel',
      s ->> 'title', s ->> 'summary', s -> 'visual', coalesce(s -> 'stats', '[]'::jsonb),
      nullif(s -> 'quote', 'null'::jsonb), coalesce(s -> 'divergences', '[]'::jsonb), nullif(s -> 'prepa', 'null'::jsonb),
      v_thread, case when v_thread is null then null else t ->> 'subtitle' end
    )
    returning id into v_story;
    n_stories := n_stories + 1;

    if v_thread is not null then
      insert into public.thread_events (thread_id, date, title, text, story_id)
      values (v_thread, v_date, s ->> 'title', coalesce(t ->> 'subtitle', ''), v_story);
    end if;

    insert into public.sources (edition_id, story_id, rubric, position, outlet, title, url, lang, read_full, published_at)
    select v_edition, v_story, s ->> 'rubric', (src ->> 'position')::integer, src ->> 'outlet', src ->> 'title',
           src ->> 'url', src ->> 'lang', (src ->> 'readFull')::boolean, src ->> 'publishedAt'
    from jsonb_array_elements(coalesce(s -> 'sources', '[]'::jsonb)) as src;
    get diagnostics n = row_count;
    n_sources := n_sources + n;
  end loop;

  insert into public.sources (edition_id, story_id, rubric, position, outlet, title, url, lang, read_full, published_at)
  select v_edition, null, src ->> 'rubric', (src ->> 'position')::integer, src ->> 'outlet', src ->> 'title',
         src ->> 'url', src ->> 'lang', (src ->> 'readFull')::boolean, src ->> 'publishedAt'
  from jsonb_array_elements(coalesce(payload -> 'briefs', '[]'::jsonb)) as src;
  get diagnostics n = row_count;
  n_sources := n_sources + n;

  insert into public.vocab_items (edition_id, lang, position, term, pos, translation, example, source_url, selected, anki_status)
  select v_edition, v_lang, (v ->> 'position')::integer, v ->> 'term', v ->> 'pos', v ->> 'translation', v ->> 'example',
         v ->> 'sourceUrl',
         coalesce((v_vocab_state -> lower(btrim(v ->> 'term')) ->> 'selected')::boolean, false),
         coalesce(v_vocab_state -> lower(btrim(v ->> 'term')) ->> 'anki_status', 'none')
  from jsonb_array_elements(coalesce(payload -> 'vocab', '[]'::jsonb)) as v;
  get diagnostics n_vocab = row_count;

  -- Un Thread créé par une publication précédente de cette édition et resté sans événement disparaît.
  delete from public.threads th
  where th.id = any (v_old_threads)
    and not exists (select 1 from public.thread_events te where te.thread_id = th.id);
  get diagnostics n_removed = row_count;

  return jsonb_build_object(
    'editionId', v_edition::text,
    'stories', n_stories,
    'sources', n_sources,
    'vocab', n_vocab,
    'threadsCreated', v_created,
    'threadsRemoved', n_removed,
    'warnings', v_warnings
  );
end
$$;

-- Supabase accorde par défaut l'exécution des fonctions de `public` à anon et authenticated :
-- celles-ci sont réservées à la clé service.
do $$
declare
  f text;
begin
  foreach f in array array[
    'publish_edition(jsonb)'
  ]
  loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
    execute format('grant execute on function public.%s to service_role', f);
  end loop;
end
$$;
```

Fichier `pipeline/publish/supabase.ts` :

```ts
import { z } from 'zod';
import type { Edition, Lang } from '@daily-brief/schema';
import { messageOf } from '../collect/http';
import type { CallOptions, SupabaseClient } from '../supabase/client';
import type { DayFile } from './files';
import type { LocalFile, PublishIssue } from './inputs';
import { editionPayload } from './rows';

/** Réponse de la fonction SQL `publish_edition`. */
const PublishedSchema = z.object({
  editionId: z.string().min(1),
  stories: z.number().int().min(0),
  sources: z.number().int().min(0),
  vocab: z.number().int().min(0),
  threadsCreated: z.array(z.string()),
  threadsRemoved: z.number().int().min(0),
  warnings: z.array(z.string()),
});

export type EditionResult = { lang: Lang; published: boolean; stories: number; sources: number; vocab: number; threadsCreated: number };

/**
 * Dépose le PDF et les MP3 dans Supabase Storage (remplacement autorisé : relancer une date écrase
 * ses fichiers). Un envoi en échec donne un avertissement et l'édition sera publiée sans ce fichier.
 */
export async function uploadFiles(client: SupabaseClient, files: LocalFile[], opts?: CallOptions): Promise<{ stored: DayFile[]; issues: PublishIssue[] }> {
  const stored: DayFile[] = [];
  const issues: PublishIssue[] = [];
  for (const { bytes, lang, ...file } of files) {
    try {
      await client.upload(file.bucket, file.path, bytes, file.mimeType, opts);
      stored.push(file);
    } catch (e) {
      issues.push({ level: 'warning', ...(lang ? { lang } : {}), message: `${file.name} non déposé dans Supabase Storage : ${messageOf(e)}` });
    }
  }
  return { stored, issues };
}

export type PublishMeta = {
  /** Fichiers réellement présents dans Storage : seuls leurs chemins sont écrits dans `editions`. */
  stored: DayFile[];
  light: Partial<Record<Lang, boolean>>;
  generatedAt: string;
};

/**
 * Publie chaque édition par un appel à `publish_edition` : une transaction par édition, donc jamais
 * d'édition à moitié écrite. Une édition en échec n'empêche pas les autres.
 */
export async function publishEditions(client: SupabaseClient, editions: Edition[], meta: PublishMeta, opts?: CallOptions): Promise<{ results: EditionResult[]; issues: PublishIssue[] }> {
  const results: EditionResult[] = [];
  const issues: PublishIssue[] = [];
  const pdfPath = meta.stored.find((f) => f.bucket === 'pdf')?.path ?? null;
  for (const edition of editions) {
    const lang = edition.lang;
    const audioPath = meta.stored.find((f) => f.bucket === 'audio' && f.path === `${edition.date}/${lang}.mp3`)?.path ?? null;
    const payload = editionPayload(edition, { pdfPath, audioPath, light: meta.light[lang] ?? false, generatedAt: meta.generatedAt });
    try {
      const r = await client.rpc('publish_edition', { payload }, PublishedSchema, opts);
      results.push({ lang, published: true, stories: r.stories, sources: r.sources, vocab: r.vocab, threadsCreated: r.threadsCreated.length });
      for (const w of r.warnings) issues.push({ level: 'warning', lang, message: w });
    } catch (e) {
      results.push({ lang, published: false, stories: 0, sources: 0, vocab: 0, threadsCreated: 0 });
      issues.push({ level: 'error', lang, message: `édition non publiée : ${messageOf(e)}` });
    }
  }
  return { results, issues };
}
```

- [ ] **Étape 4 : vérifier le succès**

Commande : `npx vitest run pipeline/test/publish/supabase.test.ts`
Attendu : `Test Files  1 passed (1)` et `Tests  18 passed (18)`.

Commande : `npm test && npm run typecheck`
Attendu : `Test Files  61 passed (61)`, `Tests  571 passed (571)`, et `tsc` sans sortie.

- [ ] **Étape 5 : commit**

```bash
git add supabase/migrations/0003_publish.sql pipeline/publish/supabase.ts pipeline/test/publish/supabase.test.ts
git commit -m "feat(publish): publication atomique des éditions (publish_edition)"
```

---

### Tâche 8 : Apps Script, réception des fichiers dans Drive

**Fichiers :**
- Créer : `apps-script/Code.gs`
- Test : `pipeline/test/apps-script/fake-google.ts`, `pipeline/test/apps-script/code.test.ts`

Apps Script ne tourne pas ici. `Code.gs` est écrit en JavaScript compatible avec Apps Script (V8). Le test l'évalue tel quel dans un contexte `node:vm`, avec de faux DriveApp, PropertiesService, LockService, Utilities et ContentService en mémoire. Les fonctions pures sont donc testées sans copie, et `doPost` de bout en bout.

Comportement attendu :
- **Fonctions pures.**
  - `folderNames` donne `2026` et `11 - Novembre`, avec les douze mois en français.
  - `isRealDate` n'accepte qu'un AAAA-MM-JJ qui existe au calendrier.
  - `safeEqual` compare en temps constant ; `tokenMatches` refuse tout si `TOKEN` est absent ou fait moins de 32 caractères.
  - `validatePayload` contrôle la date, entre 1 et 4 fichiers, et pour chacun un nom de fichier du Daily Brief de cette date, le type qui va avec l'extension, un base64 valide et non vide, sans doublon.
- **`doPost`.**
  - **Jeton d'abord.** Il est contrôlé avant tout : sans le bon jeton, la réponse est `unauthorized` et rien n'est créé, même pour une requête invalide.
  - **Dépôt.** Le dossier `Daily Brief/AAAA/MM - Mois` est créé au besoin. L'id du dossier racine est mémorisé ; s'il est mis à la corbeille ou inconnu, le dossier est retrouvé par son nom, sinon recréé.
  - **Remplacement.** Un fichier de même nom va à la corbeille, puis le nouveau est créé.
  - **Concurrence et pannes.** Les dépôts passent un par un, sous verrou. Une erreur Drive donne `drive-error` sans détail, et le verrou est relâché.
  - **Réponse.** Elle est toujours du JSON et ne contient jamais le jeton.

- [ ] **Étape 1 : écrire les faux services Google et les tests**

Fichier `pipeline/test/apps-script/fake-google.ts` :

```ts
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { repoPath } from '../helpers';

export type FakeFile = { id: string; name: string; mimeType: string; bytes: Buffer; trashed: boolean };
export type FakeFolder = { id: string; name: string; trashed: boolean; folders: FakeFolder[]; files: FakeFile[] };

const iterator = <T>(items: T[]) => {
  let i = 0;
  return { hasNext: () => i < items.length, next: () => items[i++] };
};

/** Les fonctions et constantes de `apps-script/Code.gs`, telles qu'Apps Script les verrait. */
export type CodeGs = {
  doPost(e: unknown): { text: string; mime: string };
  handle(payload: unknown, props: unknown): { ok: boolean; error?: string; ids?: Record<string, string> };
  validatePayload(payload: unknown): { ok: boolean; error?: string };
  folderNames(date: string): { year: string; month: string };
  safeEqual(a: unknown, b: unknown): boolean;
  tokenMatches(expected: unknown, received: unknown): boolean;
  isRealDate(date: unknown): boolean;
  MONTHS: string[];
};

/**
 * Évalue `apps-script/Code.gs` dans un contexte Node isolé, avec de faux services Google en
 * mémoire : DriveApp (arborescence de dossiers), PropertiesService, LockService, Utilities et
 * ContentService. Aucun appel à Google.
 */
export function loadCodeGs(properties: Record<string, string> = {}) {
  let seq = 0;
  const nextId = (prefix: string) => `${prefix}-${++seq}`;
  const root: FakeFolder = { id: 'root', name: 'Mon Drive', trashed: false, folders: [], files: [] };
  const byId = new Map<string, FakeFolder>([[root.id, root]]);
  const state = { locked: false, lockAvailable: true, failCreateFile: false, creations: [] as string[] };

  const folderApi = (f: FakeFolder): Record<string, unknown> => ({
    getId: () => f.id,
    getName: () => f.name,
    isTrashed: () => f.trashed,
    getFoldersByName: (name: string) => iterator(f.folders.filter((c) => c.name === name).map(folderApi)),
    createFolder: (name: string) => {
      const child: FakeFolder = { id: nextId('folder'), name, trashed: false, folders: [], files: [] };
      f.folders.push(child);
      byId.set(child.id, child);
      state.creations.push(`dossier ${name}`);
      return folderApi(child);
    },
    getFilesByName: (name: string) =>
      iterator(
        f.files
          .filter((x) => x.name === name && !x.trashed)
          .map((x) => ({
            setTrashed: (v: boolean) => {
              x.trashed = v;
            },
          })),
      ),
    createFile: (blob: { name: string; mimeType: string; bytes: Buffer }) => {
      if (state.failCreateFile) throw new Error('Service Drive indisponible : jeton interne xyz');
      const file: FakeFile = { id: nextId('file'), name: blob.name, mimeType: blob.mimeType, bytes: blob.bytes, trashed: false };
      f.files.push(file);
      state.creations.push(`fichier ${blob.name}`);
      return { getId: () => file.id };
    },
  });

  const props = {
    getProperty: (k: string) => (k in properties ? properties[k] : null),
    setProperty: (k: string, v: string) => {
      properties[k] = v;
    },
  };

  const sandbox: Record<string, unknown> = {
    DriveApp: {
      getRootFolder: () => folderApi(root),
      getFolderById: (id: string) => {
        const f = byId.get(id);
        if (!f) throw new Error('dossier introuvable');
        return folderApi(f);
      },
    },
    PropertiesService: { getScriptProperties: () => props },
    LockService: {
      getScriptLock: () => ({
        tryLock: () => {
          if (!state.lockAvailable) return false;
          state.locked = true;
          return true;
        },
        releaseLock: () => {
          state.locked = false;
        },
      }),
    },
    Utilities: {
      base64Decode: (s: string) => Buffer.from(s, 'base64'),
      newBlob: (bytes: Buffer, mimeType: string, name: string) => ({ bytes, mimeType, name }),
    },
    ContentService: {
      MimeType: { JSON: 'application/json' },
      createTextOutput: (text: string) => {
        const out = { text, mime: 'text/plain', setMimeType: (m: string) => ((out.mime = m), out) };
        return out;
      },
    },
  };
  vm.runInNewContext(readFileSync(repoPath('apps-script/Code.gs'), 'utf8'), sandbox, { filename: 'Code.gs' });

  /** Arborescence lisible : « Daily Brief/2026/11 - Novembre/Daily Brief 2026-11-06.pdf ». */
  const tree = (f: FakeFolder = root, prefix = ''): string[] => [
    ...f.files.map((x) => `${prefix}${x.name}${x.trashed ? ' (corbeille)' : ''}`),
    ...f.folders.flatMap((c) => (c.trashed ? [`${prefix}${c.name}/ (corbeille)`] : tree(c, `${prefix}${c.name}/`))),
  ];
  const post = (body: unknown) => JSON.parse((sandbox as unknown as CodeGs).doPost({ postData: { contents: typeof body === 'string' ? body : JSON.stringify(body) } }).text);

  return { gs: sandbox as unknown as CodeGs, root, byId, properties, props, state, tree, post };
}
```

Fichier `pipeline/test/apps-script/code.test.ts` :

```ts
import { describe, expect, it } from 'vitest';
import { loadCodeGs } from './fake-google';

const TOKEN = 'jeton-de-test-0123456789-abcdefghij';
const PDF = { name: 'Daily Brief 2026-11-06.pdf', mimeType: 'application/pdf', base64: Buffer.from('%PDF-1.7 test').toString('base64') };
const MP3 = { name: 'Daily Brief 2026-11-06 FR.mp3', mimeType: 'audio/mpeg', base64: Buffer.from('ID3 test').toString('base64') };
const body = (extra: Record<string, unknown> = {}) => ({ token: TOKEN, date: '2026-11-06', files: [PDF], ...extra });

describe('Code.gs : fonctions pures', () => {
  const { gs } = loadCodeGs();

  it('folderNames : année, puis « MM - Mois » en français pour les douze mois', () => {
    expect(gs.folderNames('2026-11-06')).toEqual({ year: '2026', month: '11 - Novembre' });
    expect(Array.from({ length: 12 }, (_, i) => gs.folderNames(`2027-${String(i + 1).padStart(2, '0')}-15`).month)).toEqual([
      '01 - Janvier',
      '02 - Février',
      '03 - Mars',
      '04 - Avril',
      '05 - Mai',
      '06 - Juin',
      '07 - Juillet',
      '08 - Août',
      '09 - Septembre',
      '10 - Octobre',
      '11 - Novembre',
      '12 - Décembre',
    ]);
  });

  it('isRealDate : AAAA-MM-JJ existant seulement', () => {
    expect(['2026-11-06', '2028-02-29'].map(gs.isRealDate)).toEqual([true, true]);
    expect(['2026-02-30', '2026-13-01', '2026-1-1', '06/11/2026', '', null, 20261106, '2026-11-06T00:00:00Z'].map(gs.isRealDate)).toEqual(Array(8).fill(false));
  });

  it('safeEqual : égalité stricte de chaînes, quelle que soit la longueur', () => {
    expect(gs.safeEqual('abc', 'abc')).toBe(true);
    for (const [a, b] of [['abc', 'abd'], ['abc', 'ab'], ['ab', 'abc'], ['', 'a'], ['abc', 'abc\u0000'], ['abc', undefined], [null, null], [1, 1]]) expect(gs.safeEqual(a, b)).toBe(false);
    expect(gs.safeEqual('', '')).toBe(true);
  });

  it('tokenMatches : refuse tout si le jeton attendu est absent ou trop court', () => {
    expect(gs.tokenMatches(TOKEN, TOKEN)).toBe(true);
    expect(gs.tokenMatches(TOKEN, `${TOKEN}x`)).toBe(false);
    expect(gs.tokenMatches(TOKEN, undefined)).toBe(false);
    expect(gs.tokenMatches(null, null)).toBe(false);
    expect(gs.tokenMatches('', '')).toBe(false);
    expect(gs.tokenMatches('court', 'court')).toBe(false);
  });

  it('validatePayload : accepte le PDF et les trois MP3 du jour', () => {
    const files = [PDF, MP3, { ...MP3, name: 'Daily Brief 2026-11-06 EN.mp3' }, { ...MP3, name: 'Daily Brief 2026-11-06 ES.mp3' }];
    expect(gs.validatePayload({ date: '2026-11-06', files })).toEqual({ ok: true, date: '2026-11-06', files });
  });

  it.each([
    ['bad-request', null],
    ['bad-request', []],
    ['bad-date', { date: '2026-02-30', files: [PDF] }],
    ['bad-files', { date: '2026-11-06' }],
    ['bad-files', { date: '2026-11-06', files: [] }],
    ['bad-files', { date: '2026-11-06', files: [PDF, PDF, PDF, PDF, PDF] }],
    ['bad-file', { date: '2026-11-06', files: [{ name: PDF.name, mimeType: PDF.mimeType }] }],
    ['bad-file', { date: '2026-11-06', files: ['x'] }],
    ['bad-name', { date: '2026-11-06', files: [{ ...PDF, name: 'Daily Brief 2026-11-05.pdf' }] }],
    ['bad-name', { date: '2026-11-06', files: [{ ...PDF, name: '../Daily Brief 2026-11-06.pdf' }] }],
    ['bad-name', { date: '2026-11-06', files: [{ ...PDF, name: 'Daily Brief 2026-11-06.pdf.exe' }] }],
    ['bad-name', { date: '2026-11-06', files: [{ ...MP3, name: 'Daily Brief 2026-11-06 DE.mp3' }] }],
    ['bad-type', { date: '2026-11-06', files: [{ ...PDF, mimeType: 'text/html' }] }],
    ['bad-type', { date: '2026-11-06', files: [{ ...MP3, mimeType: 'application/pdf' }] }],
    ['bad-content', { date: '2026-11-06', files: [{ ...PDF, base64: '' }] }],
    ['bad-content', { date: '2026-11-06', files: [{ ...PDF, base64: '<script>' }] }],
    ['duplicate-name', { date: '2026-11-06', files: [PDF, PDF] }],
  ])('validatePayload : %s', (error, payload) => {
    expect(gs.validatePayload(payload)).toEqual({ ok: false, error });
  });
});

describe('Code.gs : doPost', () => {
  it('crée Daily Brief/AAAA/MM - Mois, dépose le fichier et renvoie son id', () => {
    const g = loadCodeGs({ TOKEN });
    const out = g.gs.doPost({ postData: { contents: JSON.stringify(body({ files: [PDF, MP3] })) } });
    expect(out.mime).toBe('application/json');
    const res = JSON.parse(out.text);
    expect(res).toEqual({ ok: true, ids: { [PDF.name]: 'file-4', [MP3.name]: 'file-5' } });
    expect(g.tree()).toEqual(['Daily Brief/2026/11 - Novembre/Daily Brief 2026-11-06.pdf', 'Daily Brief/2026/11 - Novembre/Daily Brief 2026-11-06 FR.mp3']);
    const file = g.root.folders[0].folders[0].folders[0].files[0];
    expect([file.mimeType, file.bytes.toString()]).toEqual(['application/pdf', '%PDF-1.7 test']);
    expect(g.state.locked).toBe(false);
  });

  it('mémorise le dossier racine et ne recrée aucun dossier au second dépôt', () => {
    const g = loadCodeGs({ TOKEN });
    g.post(body());
    expect(g.properties.ROOT_FOLDER_ID).toBe('folder-1');
    g.state.creations.length = 0;
    expect(g.post(body({ date: '2026-11-07', files: [{ ...PDF, name: 'Daily Brief 2026-11-07.pdf' }] })).ok).toBe(true);
    expect(g.state.creations).toEqual(['fichier Daily Brief 2026-11-07.pdf']);
    g.post(body({ date: '2026-12-01', files: [{ ...PDF, name: 'Daily Brief 2026-12-01.pdf' }] }));
    g.post(body({ date: '2027-01-01', files: [{ ...PDF, name: 'Daily Brief 2027-01-01.pdf' }] }));
    expect(g.tree()).toEqual([
      'Daily Brief/2026/11 - Novembre/Daily Brief 2026-11-06.pdf',
      'Daily Brief/2026/11 - Novembre/Daily Brief 2026-11-07.pdf',
      'Daily Brief/2026/12 - Décembre/Daily Brief 2026-12-01.pdf',
      'Daily Brief/2027/01 - Janvier/Daily Brief 2027-01-01.pdf',
    ]);
  });

  it('remplace un fichier de même nom : l’ancien va à la corbeille', () => {
    const g = loadCodeGs({ TOKEN });
    const first = g.post(body());
    const second = g.post(body({ files: [{ ...PDF, base64: Buffer.from('%PDF-1.7 v2').toString('base64') }] }));
    expect(second.ids[PDF.name]).not.toBe(first.ids[PDF.name]);
    expect(g.tree()).toEqual(['Daily Brief/2026/11 - Novembre/Daily Brief 2026-11-06.pdf (corbeille)', 'Daily Brief/2026/11 - Novembre/Daily Brief 2026-11-06.pdf']);
    const files = g.root.folders[0].folders[0].folders[0].files;
    expect(files.filter((f) => !f.trashed).map((f) => f.bytes.toString())).toEqual(['%PDF-1.7 v2']);
  });

  it('dossier racine mémorisé mis à la corbeille ou supprimé : retrouvé par son nom, sinon recréé', () => {
    const g = loadCodeGs({ TOKEN });
    g.post(body());
    g.root.folders[0].trashed = true;
    expect(g.post(body()).ok).toBe(true);
    expect(g.properties.ROOT_FOLDER_ID).toBe('folder-5');
    expect(g.tree()).toEqual(['Daily Brief/ (corbeille)', 'Daily Brief/2026/11 - Novembre/Daily Brief 2026-11-06.pdf']);
    // Id inconnu de Drive : le dossier existant de même nom est repris, pas dupliqué.
    g.properties.ROOT_FOLDER_ID = 'id-périmé';
    expect(g.post(body()).ok).toBe(true);
    expect(g.properties.ROOT_FOLDER_ID).toBe('folder-5');
    expect(g.root.folders.filter((f) => !f.trashed)).toHaveLength(1);
  });

  it('jeton faux, absent, ou propriété TOKEN non définie : unauthorized, rien n’est créé', () => {
    const g = loadCodeGs({ TOKEN });
    expect(g.post(body({ token: 'mauvais' }))).toEqual({ ok: false, error: 'unauthorized' });
    expect(g.post({ date: '2026-11-06', files: [PDF] })).toEqual({ ok: false, error: 'unauthorized' });
    expect(g.post('pas du json')).toEqual({ ok: false, error: 'unauthorized' });
    expect(g.gs.doPost({}).text).toBe('{"ok":false,"error":"unauthorized"}');
    expect(g.gs.doPost(undefined).text).toBe('{"ok":false,"error":"unauthorized"}');
    const unset = loadCodeGs({});
    expect(unset.post(body())).toEqual({ ok: false, error: 'unauthorized' });
    expect(unset.post(body({ token: undefined }))).toEqual({ ok: false, error: 'unauthorized' });
    expect(loadCodeGs({ TOKEN: 'court' }).post(body({ token: 'court' }))).toEqual({ ok: false, error: 'unauthorized' });
    expect([...g.tree(), ...unset.tree()]).toEqual([]);
  });

  it('le jeton est contrôlé avant la validation : une requête invalide sans jeton n’apprend rien', () => {
    const g = loadCodeGs({ TOKEN });
    expect(g.post({ token: 'mauvais', date: 'x' })).toEqual({ ok: false, error: 'unauthorized' });
    expect(g.post(body({ date: 'x' }))).toEqual({ ok: false, error: 'bad-date' });
    expect(g.post(body({ files: [{ ...PDF, name: 'virus.exe' }] }))).toEqual({ ok: false, error: 'bad-name' });
    expect(g.tree()).toEqual([]);
  });

  it('verrou indisponible : busy ; erreur Drive : drive-error sans détail, verrou relâché', () => {
    const g = loadCodeGs({ TOKEN });
    g.state.lockAvailable = false;
    expect(g.post(body())).toEqual({ ok: false, error: 'busy' });
    g.state.lockAvailable = true;
    g.state.failCreateFile = true;
    const out = g.gs.doPost({ postData: { contents: JSON.stringify(body()) } }).text;
    expect(out).toBe('{"ok":false,"error":"drive-error"}');
    expect(g.state.locked).toBe(false);
  });

  it('la réponse ne contient jamais le jeton', () => {
    const g = loadCodeGs({ TOKEN });
    for (const b of [body(), body({ token: 'x' }), body({ date: 'x' })]) expect(JSON.stringify(g.post(b))).not.toContain(TOKEN);
  });
});
```

- [ ] **Étape 2 : vérifier l'échec**

Commande : `npx vitest run pipeline/test/apps-script/code.test.ts`
Attendu : échec, « ENOENT: no such file or directory, open ».

- [ ] **Étape 3 : écrire `Code.gs`**

Fichier `apps-script/Code.gs` :

```js
/**
 * Daily Brief — réception des PDF et MP3 du jour, rangés dans Google Drive (spec §10).
 *
 * Application web Apps Script : « Exécuter en tant que : moi », « Accès : tout le monde ».
 * Propriété du script à définir : TOKEN (jeton partagé avec le pipeline, 32 caractères au moins).
 * Guide de déploiement : docs/setup-supabase.md, section « Apps Script ».
 *
 * Requête  : POST JSON { token, date: "AAAA-MM-JJ", files: [{ name, mimeType, base64 }] }
 * Réponse  : { ok: true, ids: { "<nom du fichier>": "<id Drive>" } }
 *         ou { ok: false, error: "<code>" } — toujours en HTTP 200 (Apps Script ne permet pas
 *            de choisir le statut), après une redirection 302 que le client suit.
 *
 * Les fonctions pures (validation, nom du dossier, comparaison du jeton) sont testées dans Node :
 * pipeline/test/apps-script/code.test.ts évalue ce fichier avec de faux services Google.
 */

var ROOT_NAME = 'Daily Brief';
var MONTHS = ['Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin', 'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre'];
var MIN_TOKEN_LENGTH = 32;
var MAX_FILES = 4;
/** 40 Mo de base64, soit 30 Mo de fichier : au-delà, la requête est refusée avant décodage. */
var MAX_BASE64_LENGTH = 40 * 1024 * 1024;
var FILE_NAME = /^Daily Brief (\d{4}-\d{2}-\d{2})(?: (?:FR|EN|ES))?\.(pdf|mp3)$/;
var MIME_BY_EXTENSION = { pdf: 'application/pdf', mp3: 'audio/mpeg' };

// ------------------------------------------------------------------------------------------
// Fonctions pures
// ------------------------------------------------------------------------------------------

/** Comparaison en temps constant : la durée ne dépend ni de la position du premier écart ni du contenu. */
function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  var diff = a.length ^ b.length;
  var n = Math.max(a.length, b.length);
  for (var i = 0; i < n; i++) diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return diff === 0;
}

/** Vrai si le jeton reçu est le jeton attendu. Un jeton attendu absent ou trop court refuse tout. */
function tokenMatches(expected, received) {
  if (typeof expected !== 'string' || expected.length < MIN_TOKEN_LENGTH) return false;
  return safeEqual(expected, received);
}

/** Vrai pour une date AAAA-MM-JJ qui existe au calendrier. */
function isRealDate(date) {
  if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  var d = new Date(date + 'T00:00:00Z');
  return !isNaN(d.getTime()) && d.toISOString().slice(0, 10) === date;
}

/** Dossiers d'une date : « 2026 » et « 11 - Novembre » (mois en français). */
function folderNames(date) {
  var month = Number(date.slice(5, 7));
  return { year: date.slice(0, 4), month: date.slice(5, 7) + ' - ' + MONTHS[month - 1] };
}

/**
 * Valide la requête : renvoie { ok: true, date, files } ou { ok: false, error }.
 * Chaque fichier doit porter le nom d'un fichier du Daily Brief de cette date, le type qui va
 * avec son extension et un contenu base64 non vide.
 */
function validatePayload(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return { ok: false, error: 'bad-request' };
  if (!isRealDate(payload.date)) return { ok: false, error: 'bad-date' };
  var files = payload.files;
  if (!Array.isArray(files) || files.length === 0 || files.length > MAX_FILES) return { ok: false, error: 'bad-files' };
  var seen = {};
  for (var i = 0; i < files.length; i++) {
    var f = files[i];
    if (!f || typeof f !== 'object' || typeof f.name !== 'string' || typeof f.mimeType !== 'string' || typeof f.base64 !== 'string') return { ok: false, error: 'bad-file' };
    var m = FILE_NAME.exec(f.name);
    if (!m || m[1] !== payload.date) return { ok: false, error: 'bad-name' };
    if (MIME_BY_EXTENSION[m[2]] !== f.mimeType) return { ok: false, error: 'bad-type' };
    if (f.base64.length === 0 || f.base64.length > MAX_BASE64_LENGTH || !/^[A-Za-z0-9+/]+={0,2}$/.test(f.base64)) return { ok: false, error: 'bad-content' };
    if (seen[f.name]) return { ok: false, error: 'duplicate-name' };
    seen[f.name] = true;
  }
  return { ok: true, date: payload.date, files: files };
}

/** Lit le corps JSON de la requête ; null s'il est absent ou illisible. */
function parseBody(e) {
  try {
    var text = e && e.postData && e.postData.contents;
    return typeof text === 'string' ? JSON.parse(text) : null;
  } catch (err) {
    return null;
  }
}

// ------------------------------------------------------------------------------------------
// Drive
// ------------------------------------------------------------------------------------------

/** Sous-dossier `name` de `parent`, créé s'il manque. */
function childFolder(parent, name) {
  var it = parent.getFoldersByName(name);
  while (it.hasNext()) {
    var folder = it.next();
    if (!folder.isTrashed()) return folder;
  }
  return parent.createFolder(name);
}

/**
 * Dossier racine « Daily Brief ». Son id est mémorisé dans la propriété ROOT_FOLDER_ID ; un dossier
 * supprimé ou mis à la corbeille est recherché par son nom à la racine de Mon Drive, puis recréé.
 */
function rootFolder(props) {
  var id = props.getProperty('ROOT_FOLDER_ID');
  if (id) {
    try {
      var known = DriveApp.getFolderById(id);
      if (!known.isTrashed()) return known;
    } catch (err) {
      // id périmé : on retrouve ou on recrée le dossier ci-dessous
    }
  }
  var root = childFolder(DriveApp.getRootFolder(), ROOT_NAME);
  props.setProperty('ROOT_FOLDER_ID', root.getId());
  return root;
}

/** Dossier « Daily Brief/AAAA/MM - Mois » de la date, créé au besoin. */
function monthFolder(props, date) {
  var names = folderNames(date);
  return childFolder(childFolder(rootFolder(props), names.year), names.month);
}

/** Dépose un fichier en remplaçant tout fichier de même nom (corbeille, puis recréation). */
function replaceFile(folder, file) {
  var blob = Utilities.newBlob(Utilities.base64Decode(file.base64), file.mimeType, file.name);
  var old = folder.getFilesByName(file.name);
  while (old.hasNext()) old.next().setTrashed(true);
  return folder.createFile(blob).getId();
}

/** Traite une requête déjà lue : contrôle du jeton, validation, dépôt. Ne lève jamais. */
function handle(payload, props) {
  if (!payload || !tokenMatches(props.getProperty('TOKEN'), payload.token)) return { ok: false, error: 'unauthorized' };
  var checked = validatePayload(payload);
  if (!checked.ok) return checked;
  // Un seul dépôt à la fois : deux requêtes simultanées ne créent pas deux dossiers du même nom.
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) return { ok: false, error: 'busy' };
  try {
    var folder = monthFolder(props, checked.date);
    var ids = {};
    for (var i = 0; i < checked.files.length; i++) ids[checked.files[i].name] = replaceFile(folder, checked.files[i]);
    return { ok: true, ids: ids };
  } catch (err) {
    return { ok: false, error: 'drive-error' };
  } finally {
    lock.releaseLock();
  }
}

/** Point d'entrée de l'application web. */
function doPost(e) {
  var result = handle(parseBody(e), PropertiesService.getScriptProperties());
  return ContentService.createTextOutput(JSON.stringify(result)).setMimeType(ContentService.MimeType.JSON);
}
```

- [ ] **Étape 4 : vérifier le succès**

Commande : `npx vitest run pipeline/test/apps-script/code.test.ts`
Attendu : `Test Files  1 passed (1)` et `Tests  30 passed (30)`.

Commande : `npm test && npm run typecheck`
Attendu : `Test Files  62 passed (62)`, `Tests  601 passed (601)`, et `tsc` sans sortie.

- [ ] **Étape 5 : commit**

```bash
git add apps-script/Code.gs pipeline/test/apps-script/fake-google.ts pipeline/test/apps-script/code.test.ts
git commit -m "feat(apps-script): réception des fichiers du jour dans Drive"
```

---

### Tâche 9 : client Drive, redirection 302 suivie à la main

**Fichiers :**
- Créer : `pipeline/publish/drive.ts`
- Test : `pipeline/test/publish/apps-script-server.ts`, `pipeline/test/publish/drive.test.ts`

Le faux Apps Script est un vrai serveur HTTP sur `127.0.0.1`, sur un port libre. `POST /macros/s/test/exec` exécute le vrai `Code.gs` (faux Drive de la tâche 8), puis répond 302 vers `/macros/echo?user_content_key=…`, que le client doit lire par GET, comme une application web Apps Script. Des modes simulent les pannes : réponse directe, page HTML, connexion Google, boucle de redirections, 500, serveur muet, réponse sans id ou d'une autre forme.

Comportement attendu :
- **Configuration.** `driveConfig` exige une URL `https://script.google.com/…` sans identifiants, et un jeton d'au moins 32 caractères.
- **Envoi.** Un fichier par requête : POST avec le jeton, puis GET de la redirection, sans corps ni jeton. La réponse est validée par zod et doit contenir l'id du fichier envoyé. Une réponse 200 directe est acceptée.
- **Redirections.** Chaque saut doit rester sur un hôte d'Apps Script en https. Une redirection vers la connexion Google est refusée sans être suivie (erreur fatale : application non publique). On abandonne après 3 sauts.
- **Refus d'Apps Script.** Un jeton refusé (`unauthorized`) est une erreur fatale qui coupe Drive. Un refus de validation n'est pas fatal.
- **Pannes.** Page HTML, 500, réponse sans id ou inattendue : erreur sans fragment de la réponse. Un délai dépassé coupe Drive, comme trois échecs de suite. Le signal de l'appelant est honoré.
- **Avant l'envoi.** Un fichier vide, ou de plus de 30 Mo, est refusé sans requête.
- **Messages.** Ni le jeton ni l'URL de l'application n'y paraissent jamais.

- [ ] **Étape 1 : écrire le faux serveur et les tests**

Fichier `pipeline/test/publish/apps-script-server.ts` :

```ts
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { loadCodeGs } from '../apps-script/fake-google';

export const DRIVE_TOKEN = 'jeton-drive-de-test-0123456789-abcdef';

export type ServerMode =
  | 'ok'
  /** Répond 200 directement, sans redirection. */
  | 'direct'
  /** Page HTML d'erreur d'Apps Script (HTTP 200). */
  | 'html'
  /** Redirection vers la connexion Google : application non publique. */
  | 'login'
  /** Redirections sans fin. */
  | 'loop'
  | 'http-500'
  /** Ne répond jamais. */
  | 'hang'
  /** Répond `{ ok: true, ids: {} }` : l'id du fichier manque. */
  | 'no-id'
  /** Réponse JSON d'une autre forme. */
  | 'odd';

export type Hit = { method: string; path: string; body: string };

/**
 * Faux Apps Script sur 127.0.0.1 : `POST /macros/s/test/exec` exécute le vrai `Code.gs` (faux
 * Drive en mémoire) puis répond 302 vers `/macros/echo?user_content_key=…`, que le client doit lire
 * par GET — le comportement d'une application web Apps Script. Aucun appel hors de la machine.
 */
export async function startAppsScript(token: string = DRIVE_TOKEN) {
  const google = loadCodeGs({ TOKEN: token });
  const hits: Hit[] = [];
  const pending = new Map<string, string>();
  const state = { mode: 'ok' as ServerMode, seq: 0 };
  const hanging = new Set<import('node:http').ServerResponse>();

  const server: Server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      const body = Buffer.concat(chunks).toString('utf8');
      const path = req.url ?? '';
      hits.push({ method: req.method ?? '', path, body });
      const send = (status: number, text: string, headers: Record<string, string> = {}) => {
        res.writeHead(status, { 'content-type': 'application/json', ...headers });
        res.end(text);
      };
      if (state.mode === 'hang') {
        hanging.add(res);
        return;
      }
      if (state.mode === 'http-500') return send(500, 'erreur interne');
      if (state.mode === 'loop') return send(302, '', { location: `/macros/echo?user_content_key=k${++state.seq}` });
      if (req.method === 'POST' && path === '/macros/s/test/exec') {
        if (state.mode === 'login') return send(302, '', { location: 'https://accounts.google.com/ServiceLogin?continue=x' });
        if (state.mode === 'html') return send(200, '<!DOCTYPE html><html><body>TypeError: jeton interne</body></html>', { 'content-type': 'text/html' });
        const out = state.mode === 'no-id' ? '{"ok":true,"ids":{}}' : state.mode === 'odd' ? '{"status":"fine"}' : google.gs.doPost({ postData: { contents: body } }).text;
        if (state.mode === 'direct') return send(200, out);
        const key = `k${++state.seq}`;
        pending.set(key, out);
        return send(302, '', { location: `/macros/echo?user_content_key=${key}` });
      }
      const key = /^\/macros\/echo\?user_content_key=(k\d+)$/.exec(path)?.[1];
      if (req.method === 'GET' && key && pending.has(key)) return send(200, pending.get(key)!);
      return send(404, 'introuvable');
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const host = `127.0.0.1:${(server.address() as AddressInfo).port}`;
  return {
    google,
    hits,
    state,
    host,
    url: `http://${host}/macros/s/test/exec`,
    close: async () => {
      for (const r of hanging) r.destroy();
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
    },
  };
}
```

Fichier `pipeline/test/publish/drive.test.ts` :

```ts
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { HttpFetch } from '../../collect/http';
import { createDriveClient, driveConfig, DriveError, MAX_DRIVE_BYTES, MISSING_DRIVE, type DriveClient } from '../../publish/drive';
import { mp3File, pdfFile } from '../../publish/files';
import { DRIVE_TOKEN, startAppsScript } from './apps-script-server';
import { DAY, MP3_BYTES, PDF_BYTES } from './day';

const realFetch = fetch as unknown as HttpFetch;
let server: Awaited<ReturnType<typeof startAppsScript>>;
let drive: DriveClient;
const client = (over: { token?: string; timeoutMs?: number; signal?: AbortSignal } = {}) =>
  createDriveClient({ url: server.url, token: over.token ?? DRIVE_TOKEN }, realFetch, { hosts: [server.host], timeoutMs: over.timeoutMs ?? 5_000, signal: over.signal });
const failure = async (p: Promise<unknown>) => {
  const e = await p.catch((x: unknown) => x);
  expect(e).toBeInstanceOf(DriveError);
  return e as DriveError;
};

beforeEach(async () => {
  server = await startAppsScript();
  drive = client();
});
afterEach(async () => {
  await server.close();
});

describe('driveConfig', () => {
  const URL_OK = 'https://script.google.com/macros/s/AKfycbx/exec';
  it('accepte une application web Apps Script et un jeton de 32 caractères au moins', () => {
    expect(driveConfig({ APPS_SCRIPT_URL: ` ${URL_OK} `, APPS_SCRIPT_TOKEN: ` ${DRIVE_TOKEN} ` })).toEqual({ ok: true, config: { url: URL_OK, token: DRIVE_TOKEN } });
  });

  it('signale une variable absente ou blanche', () => {
    expect(driveConfig({})).toEqual({ ok: false, error: MISSING_DRIVE });
    expect(driveConfig({ APPS_SCRIPT_URL: URL_OK, APPS_SCRIPT_TOKEN: '  ' })).toEqual({ ok: false, error: MISSING_DRIVE });
  });

  it('refuse une URL hors d’Apps Script, en http, ou avec des identifiants ; refuse un jeton court', () => {
    const bad = 'APPS_SCRIPT_URL invalide : application web Apps Script attendue (https://script.google.com/macros/s/…/exec)';
    for (const url of ['https://exemple.fr/macros/s/x/exec', 'http://script.google.com/macros/s/x/exec', 'https://u:p@script.google.com/macros/s/x/exec', 'https://script.google.com.exemple.fr/x']) {
      expect(driveConfig({ APPS_SCRIPT_URL: url, APPS_SCRIPT_TOKEN: DRIVE_TOKEN })).toEqual({ ok: false, error: bad });
    }
    expect(driveConfig({ APPS_SCRIPT_URL: 'pas une url', APPS_SCRIPT_TOKEN: DRIVE_TOKEN }).ok).toBe(false);
    expect(driveConfig({ APPS_SCRIPT_URL: URL_OK, APPS_SCRIPT_TOKEN: 'court' })).toEqual({ ok: false, error: 'APPS_SCRIPT_TOKEN trop court : 32 caractères au moins' });
  });
});

describe('client Drive contre un faux Apps Script local (302)', () => {
  it('POST, puis GET de la redirection : le fichier arrive dans Daily Brief/AAAA/MM - Mois', async () => {
    const id = await drive.send(DAY, pdfFile(DAY), PDF_BYTES);
    expect(id).toBe('file-4');
    expect(server.google.tree()).toEqual(['Daily Brief/2026/11 - Novembre/Daily Brief 2026-11-06.pdf']);
    expect(server.google.root.folders[0].folders[0].folders[0].files[0].bytes).toEqual(PDF_BYTES);
    expect(server.hits.map((h) => [h.method, h.path])).toEqual([
      ['POST', '/macros/s/test/exec'],
      ['GET', '/macros/echo?user_content_key=k1'],
    ]);
    expect(JSON.parse(server.hits[0].body)).toEqual({ token: DRIVE_TOKEN, date: DAY, files: [{ name: 'Daily Brief 2026-11-06.pdf', mimeType: 'application/pdf', base64: PDF_BYTES.toString('base64') }] });
    // Le jeton ne suit pas la redirection.
    expect(server.hits[1].body).toBe('');
  });

  it('un fichier par requête ; renvoyer le même nom le remplace', async () => {
    await drive.send(DAY, pdfFile(DAY), PDF_BYTES);
    await drive.send(DAY, mp3File(DAY, 'fr'), MP3_BYTES);
    await drive.send(DAY, pdfFile(DAY), Buffer.concat([PDF_BYTES, Buffer.from('v2')]));
    expect(server.hits.filter((h) => h.method === 'POST').map((h) => JSON.parse(h.body).files.length)).toEqual([1, 1, 1]);
    expect(server.google.tree()).toEqual([
      'Daily Brief/2026/11 - Novembre/Daily Brief 2026-11-06.pdf (corbeille)',
      'Daily Brief/2026/11 - Novembre/Daily Brief 2026-11-06 FR.mp3',
      'Daily Brief/2026/11 - Novembre/Daily Brief 2026-11-06.pdf',
    ]);
  });

  it('accepte une réponse 200 sans redirection', async () => {
    server.state.mode = 'direct';
    expect(await drive.send(DAY, pdfFile(DAY), PDF_BYTES)).toBe('file-4');
    expect(server.hits).toHaveLength(1);
  });

  it('jeton refusé : erreur fatale, Drive coupé, plus aucun envoi', async () => {
    drive = client({ token: 'mauvais-jeton-de-test-0123456789-abcdef' });
    const e = await failure(drive.send(DAY, pdfFile(DAY), PDF_BYTES));
    expect(e.message).toBe('Drive Daily Brief 2026-11-06.pdf : refus d’Apps Script (unauthorized)');
    expect(e.fatal).toBe(true);
    const again = await failure(drive.send(DAY, mp3File(DAY, 'fr'), MP3_BYTES));
    expect(again.message).toBe('Drive coupé (jeton refusé)');
    expect(server.hits.filter((h) => h.method === 'POST')).toHaveLength(1);
    expect(server.google.tree()).toEqual([]);
  });

  it('refus de validation côté script : erreur non fatale, avec le code', async () => {
    const e = await failure(drive.send('2026-11-07', pdfFile(DAY), PDF_BYTES));
    expect(e.message).toBe('Drive Daily Brief 2026-11-06.pdf : refus d’Apps Script (bad-name)');
    expect(e.fatal).toBe(false);
    expect(drive.breaker.open).toBe(false);
  });

  it('redirection vers la connexion Google : refusée sans la suivre (application non publique)', async () => {
    server.state.mode = 'login';
    const e = await failure(drive.send(DAY, pdfFile(DAY), PDF_BYTES));
    expect(e.message).toBe('Drive Daily Brief 2026-11-06.pdf : redirection hors d’Apps Script (accounts.google.com) : l’application web doit être déployée avec l’accès « Tout le monde »');
    expect(e.fatal).toBe(true);
    expect(server.hits).toHaveLength(1);
    expect(drive.breaker.reason).toBe('application web non publique');
  });

  it('redirections sans fin : abandon après trois sauts', async () => {
    server.state.mode = 'loop';
    const e = await failure(drive.send(DAY, pdfFile(DAY), PDF_BYTES));
    expect(e.message).toBe('Drive Daily Brief 2026-11-06.pdf : trop de redirections');
    expect(server.hits).toHaveLength(4);
  });

  it.each([
    ['html', 'réponse non JSON (page d’erreur d’Apps Script ?)'],
    ['http-500', 'HTTP 500'],
    ['no-id', 'réponse sans l’id du fichier envoyé'],
    ['odd', 'réponse inattendue'],
  ] as const)('mode %s : erreur sans fragment de la réponse', async (mode, message) => {
    server.state.mode = mode;
    const e = await failure(drive.send(DAY, pdfFile(DAY), PDF_BYTES));
    expect(e.message).toBe(`Drive Daily Brief 2026-11-06.pdf : ${message}`);
    expect(e.fatal).toBe(false);
  });

  it('serveur muet : interrompu au délai, et le délai coupe Drive', async () => {
    server.state.mode = 'hang';
    drive = client({ timeoutMs: 100 });
    const e = await failure(drive.send(DAY, pdfFile(DAY), PDF_BYTES));
    expect(e.message).toBe('Drive Daily Brief 2026-11-06.pdf : délai dépassé');
    expect(drive.breaker.reason).toBe('délai dépassé');
    server.state.mode = 'ok';
    await failure(drive.send(DAY, pdfFile(DAY), PDF_BYTES));
    expect(server.hits).toHaveLength(1);
  });

  it('honore le signal de l’appelant', async () => {
    server.state.mode = 'hang';
    const c = new AbortController();
    const p = failure(client({ signal: c.signal }).send(DAY, pdfFile(DAY), PDF_BYTES));
    setTimeout(() => c.abort(), 50);
    expect((await p).message).toMatch(/^Drive Daily Brief 2026-11-06\.pdf : /);
  });

  it('trois échecs de suite coupent Drive', async () => {
    server.state.mode = 'http-500';
    for (let i = 0; i < 3; i++) await failure(drive.send(DAY, pdfFile(DAY), PDF_BYTES));
    server.state.mode = 'ok';
    const e = await failure(drive.send(DAY, pdfFile(DAY), PDF_BYTES));
    expect(e.message).toBe('Drive coupé (source coupée après 3 échecs consécutifs)');
    expect(server.hits).toHaveLength(3);
  });

  it('fichier vide ou trop lourd : refusé sans requête', async () => {
    expect((await failure(drive.send(DAY, pdfFile(DAY), new Uint8Array()))).message).toBe('Daily Brief 2026-11-06.pdf : fichier vide');
    const big = { byteLength: MAX_DRIVE_BYTES + 1 } as Uint8Array;
    expect((await failure(drive.send(DAY, pdfFile(DAY), big))).message).toBe(`Daily Brief 2026-11-06.pdf : trop lourd pour Apps Script (${MAX_DRIVE_BYTES + 1} octets, ${MAX_DRIVE_BYTES} au plus)`);
    expect(server.hits).toEqual([]);
  });

  it('ni le jeton ni l’URL de l’application ne paraissent dans une erreur', async () => {
    const leaky: HttpFetch = async () => {
      throw new Error(`connexion à ${server.url} refusée (jeton ${DRIVE_TOKEN})`);
    };
    const e = await failure(createDriveClient({ url: server.url, token: DRIVE_TOKEN }, leaky, { hosts: [server.host] }).send(DAY, pdfFile(DAY), PDF_BYTES));
    expect(e.message).toBe('Drive Daily Brief 2026-11-06.pdf : connexion à *** refusée (jeton ***)');
    for (const mode of ['html', 'http-500', 'login', 'loop'] as const) {
      server.state.mode = mode;
      const m = (await failure(client().send(DAY, pdfFile(DAY), PDF_BYTES))).message;
      expect(m).not.toContain(DRIVE_TOKEN);
      expect(m).not.toContain(server.url);
      expect(m).not.toContain('user_content_key');
    }
  });
});
```

- [ ] **Étape 2 : vérifier l'échec**

Commande : `npx vitest run pipeline/test/publish/drive.test.ts`
Attendu : échec, « Cannot find module '../../publish/drive' ».

- [ ] **Étape 3 : écrire le client**

Fichier `pipeline/publish/drive.ts` :

```ts
import { z } from 'zod';
import { Breaker } from '../collect/breaker';
import { BodyError, deadline, HttpError, isTimeout, messageOf, readCapped, type HttpFetch, type HttpResponse } from '../collect/http';
import { stripSecrets } from '../lib/redact';
import type { DayFile } from './files';

export type DriveConfig = { url: string; token: string };

export const MISSING_DRIVE = 'APPS_SCRIPT_URL ou APPS_SCRIPT_TOKEN absente';
/** Le jeton est comparé par Code.gs, qui refuse tout jeton de moins de 32 caractères. */
export const MIN_TOKEN_LENGTH = 32;
/** Hôtes d'Apps Script : l'application web, puis l'hôte vers lequel elle redirige la réponse. */
export const APPS_SCRIPT_HOSTS = ['script.google.com', 'script.googleusercontent.com'];
/** Délai d'un dépôt (octets envoyés, exécution du script, lecture de la réponse). */
export const DRIVE_TIMEOUT_MS = 180_000;
/** Taille maximale d'un fichier envoyé : 30 Mo, soit 40 Mo en base64 (limite contrôlée aussi par Code.gs). */
export const MAX_DRIVE_BYTES = 30 * 1024 * 1024;
const MAX_REDIRECTS = 3;
const MAX_RESPONSE_BYTES = 64_000;

/**
 * Configuration du dépôt Drive tirée de l'environnement. L'URL doit être celle d'une application
 * web Apps Script (`https://script.google.com/macros/s/<id>/exec`) : le jeton n'est envoyé qu'à Google.
 */
export function driveConfig(env: Record<string, string | undefined>, hosts: string[] = APPS_SCRIPT_HOSTS): { ok: true; config: DriveConfig } | { ok: false; error: string } {
  const url = env.APPS_SCRIPT_URL?.trim();
  const token = env.APPS_SCRIPT_TOKEN?.trim();
  if (!url || !token) return { ok: false, error: MISSING_DRIVE };
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { ok: false, error: 'APPS_SCRIPT_URL invalide : URL attendue (https://script.google.com/macros/s/…/exec)' };
  }
  if (!allowed(parsed, hosts) || parsed.username || parsed.password) return { ok: false, error: 'APPS_SCRIPT_URL invalide : application web Apps Script attendue (https://script.google.com/macros/s/…/exec)' };
  if (token.length < MIN_TOKEN_LENGTH) return { ok: false, error: `APPS_SCRIPT_TOKEN trop court : ${MIN_TOKEN_LENGTH} caractères au moins` };
  return { ok: true, config: { url: parsed.href, token } };
}

/** https vers un hôte permis ; http n'est accepté que vers la machine locale (tests). */
function allowed(u: URL, hosts: string[]): boolean {
  if (!hosts.includes(u.host)) return false;
  return u.protocol === 'https:' || (u.protocol === 'http:' && (u.hostname === '127.0.0.1' || u.hostname === 'localhost'));
}

const ResponseSchema = z.union([z.object({ ok: z.literal(true), ids: z.record(z.string(), z.string().min(1)) }), z.object({ ok: z.literal(false), error: z.string() })]);

/** Erreur du dépôt Drive. `fatal` : inutile de réessayer pendant ce passage (jeton refusé). */
export class DriveError extends Error {
  constructor(
    message: string,
    readonly fatal = false,
  ) {
    super(message);
    this.name = 'DriveError';
  }
}

export type DriveClient = {
  /** Dépose un fichier dans « Daily Brief/AAAA/MM - Mois » ; renvoie son id Drive. */
  send(date: string, file: DayFile, bytes: Uint8Array, opts?: { signal?: AbortSignal }): Promise<string>;
  readonly breaker: Breaker;
};

export type DriveOptions = { timeoutMs?: number; signal?: AbortSignal; /** Hôtes permis pour l'URL et ses redirections (tests : serveur local). */ hosts?: string[] };

/**
 * Client de l'application web Apps Script (spec §10). Un fichier par requête : chaque envoi reste
 * loin des limites d'Apps Script (6 minutes par exécution) et un échec n'emporte pas les autres.
 * Le POST reçoit une redirection 302 vers script.googleusercontent.com, suivie à la main par un GET :
 * chaque saut est contrôlé (hôte Google en https) et le jeton n'est jamais renvoyé après le POST.
 * Aucun message d'erreur ne contient l'URL de l'application ni le jeton.
 */
export function createDriveClient(config: DriveConfig, fetch: HttpFetch, options: DriveOptions = {}): DriveClient {
  const breaker = new Breaker();
  const hosts = options.hosts ?? APPS_SCRIPT_HOSTS;
  const clean = (m: string) => stripSecrets(m, [config.token, config.url]);

  async function exchange(body: string, signal: AbortSignal): Promise<unknown> {
    let res: HttpResponse = await fetch(config.url, { method: 'POST', headers: { 'content-type': 'application/json' }, body, signal, redirect: 'manual' });
    for (let hop = 0; res.status >= 300 && res.status < 400; hop++) {
      await res.body?.cancel().catch(() => {});
      if (hop >= MAX_REDIRECTS) throw new DriveError('trop de redirections');
      let next: URL;
      try {
        next = new URL(res.headers.get('location') ?? '', config.url);
      } catch {
        throw new DriveError('redirection sans adresse');
      }
      // Une redirection vers la connexion Google signifie que l'application n'est pas publique.
      if (!allowed(next, hosts)) throw new DriveError(`redirection hors d’Apps Script (${next.host}) : l’application web doit être déployée avec l’accès « Tout le monde »`, true);
      res = await fetch(next.href, { method: 'GET', signal, redirect: 'manual' });
    }
    if (!res.ok) {
      await res.body?.cancel().catch(() => {});
      throw new HttpError(res.status, '');
    }
    const text = new TextDecoder().decode(await readCapped(res, MAX_RESPONSE_BYTES));
    try {
      return JSON.parse(text);
    } catch {
      throw new DriveError('réponse non JSON (page d’erreur d’Apps Script ?)');
    }
  }

  return {
    breaker,
    async send(date, file, bytes, opts) {
      if (breaker.open) throw new DriveError(`Drive coupé (${breaker.reason})`, true);
      if (bytes.byteLength === 0) throw new DriveError(`${file.name} : fichier vide`);
      if (bytes.byteLength > MAX_DRIVE_BYTES) throw new DriveError(`${file.name} : trop lourd pour Apps Script (${bytes.byteLength} octets, ${MAX_DRIVE_BYTES} au plus)`);
      const parents = [options.signal, opts?.signal].filter((s): s is AbortSignal => !!s);
      const signal = deadline(options.timeoutMs ?? DRIVE_TIMEOUT_MS, parents.length ? AbortSignal.any(parents) : undefined);
      const body = JSON.stringify({ token: config.token, date, files: [{ name: file.name, mimeType: file.mimeType, base64: Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString('base64') }] });
      try {
        const parsed = ResponseSchema.safeParse(await exchange(body, signal));
        if (!parsed.success) throw new DriveError('réponse inattendue');
        if (!parsed.data.ok) throw new DriveError(`refus d’Apps Script (${parsed.data.error.slice(0, 40)})`, parsed.data.error === 'unauthorized');
        const id = parsed.data.ids[file.name];
        if (!id) throw new DriveError('réponse sans l’id du fichier envoyé');
        breaker.success();
        return id;
      } catch (e) {
        if (e instanceof DriveError && e.fatal) breaker.reason = e.message.startsWith('refus') ? 'jeton refusé' : 'application web non publique';
        else breaker.trip(e);
        if (e instanceof DriveError) throw new DriveError(clean(`Drive ${file.name} : ${e.message}`), e.fatal);
        const what = e instanceof HttpError ? `HTTP ${e.status}` : isTimeout(e) ? 'délai dépassé' : e instanceof BodyError ? e.message : messageOf(e);
        throw new DriveError(clean(`Drive ${file.name} : ${what}`));
      }
    },
  };
}
```

- [ ] **Étape 4 : vérifier le succès**

Commande : `npx vitest run pipeline/test/publish/drive.test.ts`
Attendu : `Test Files  1 passed (1)` et `Tests  19 passed (19)`.

Commande : `npm test && npm run typecheck`
Attendu : `Test Files  63 passed (63)`, `Tests  620 passed (620)`, et `tsc` sans sortie.

- [ ] **Étape 5 : commit**

```bash
git add pipeline/publish/drive.ts pipeline/test/publish/apps-script-server.ts pipeline/test/publish/drive.test.ts
git commit -m "feat(publish): client Drive avec suivi manuel de la redirection 302"
```

---

### Tâche 10 : dépôts Drive en attente et purge des MP3

**Fichiers :**
- Créer : `supabase/migrations/0004_files.sql`, `pipeline/publish/retry-pending.ts`, `pipeline/publish/audio-purge.ts`
- Test : `pipeline/test/publish/retry-pending.test.ts`

Comportement attendu :
- **Fonctions SQL.**
  - `drive_pending_put` met en attente avec 1 tentative, puis une de plus à chaque nouvel échec, et tronque l'erreur à 500 caractères.
  - `drive_pending_list` renvoie les lignes sous le plafond de tentatives, les plus anciennes d'abord, et compte les abandonnées.
  - `drive_pending_resolve` supprime une ligne ; `drive_pending_fail` ajoute une tentative et ne garde que les fichiers restants.
  - Toutes sont réservées à la clé service.
- **Relance (`retryPending`).**
  - **Principe.** Chaque fichier est relu dans Storage, revérifié puis déposé dans Drive ; une ligne entièrement déposée est soldée. La date du jour n'est pas touchée.
  - **Plafonds.** Au plus 5 lignes par passage ; après 5 tentatives, la ligne est abandonnée et signalée.
  - **Fichier perdu.** Un fichier purgé de Storage est abandonné avec un avertissement.
  - **Ligne altérée.** Fichier d'une autre date, chemin étranger ou contenu qui n'est pas un PDF : rien n'est jamais envoyé.
  - **Coupures.** Un jeton refusé arrête tout, et les autres lignes ne perdent pas de tentative. Supabase illisible ne coûte qu'un avertissement.
- **Purge (`purgeExpiredAudio`).** Elle supprime du bucket les MP3 des éditions de plus de 30 jours, puis vide `audio_path`. Un second passage n'appelle plus Storage. Une suppression en échec laisse `audio_path` intact (rattrapé au passage suivant). Seul un chemin `AAAA-MM-JJ/<langue>.mp3` peut être supprimé.

- [ ] **Étape 1 : écrire les tests**

Fichier `pipeline/test/publish/retry-pending.test.ts` :

```ts
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { HttpFetch } from '../../collect/http';
import { purgeExpiredAudio } from '../../publish/audio-purge';
import { createDriveClient, type DriveClient } from '../../publish/drive';
import { mp3File, pdfFile, type DayFile } from '../../publish/files';
import { MAX_ATTEMPTS, queuePending, resolvePending, retryPending } from '../../publish/retry-pending';
import { createSupabaseClient, type SupabaseClient } from '../../supabase/client';
import { FAKE_KEY, FAKE_URL, fakeSupabase, type FakeSupabase } from '../supabase/fake-supabase';
import { ALLOWED_EMAIL, createTestDb, resetData, rows, rpc, type TestDb } from '../supabase/pg';
import { DRIVE_TOKEN, startAppsScript } from './apps-script-server';
import { MP3_BYTES, PDF_BYTES } from './day';

const TODAY = '2026-11-08';
let db: TestDb;
let fake: FakeSupabase;
let client: SupabaseClient;
let server: Awaited<ReturnType<typeof startAppsScript>>;
let drive: DriveClient;

beforeAll(async () => {
  db = await createTestDb();
}, 60_000);
afterAll(async () => {
  await db.close();
});
beforeEach(async () => {
  await resetData(db);
  fake = fakeSupabase(db);
  client = createSupabaseClient({ url: FAKE_URL, serviceKey: FAKE_KEY }, fake.fetch);
  server = await startAppsScript();
  drive = createDriveClient({ url: server.url, token: DRIVE_TOKEN }, fetch as unknown as HttpFetch, { hosts: [server.host], timeoutMs: 5_000 });
});
afterEach(async () => {
  await server.close();
});

const pending = () => rows<{ date: string; files: DayFile[]; attempts: number; last_error: string | null }>(db, 'select date::text as date, files, attempts, last_error from public.drive_pending order by date');
/** Met un fichier dans le faux Storage et renvoie sa description. */
function stored(file: DayFile, bytes: Buffer = file.bucket === 'pdf' ? PDF_BYTES : MP3_BYTES): DayFile {
  fake.files.set(`${file.bucket}/${file.path}`, { bytes, contentType: file.mimeType });
  return file;
}

describe('fonctions SQL drive_pending_*', () => {
  it('put : première mise en attente à 1 tentative, puis une de plus à chaque nouvel échec', async () => {
    await queuePending(client, '2026-11-06', [pdfFile('2026-11-06')], 'Drive : HTTP 500');
    expect(await pending()).toEqual([{ date: '2026-11-06', files: [pdfFile('2026-11-06')], attempts: 1, last_error: 'Drive : HTTP 500' }]);
    await queuePending(client, '2026-11-06', [pdfFile('2026-11-06'), mp3File('2026-11-06', 'fr')], 'x'.repeat(900));
    const [row] = await pending();
    expect([row.attempts, row.files.length, row.last_error!.length]).toEqual([2, 2, 500]);
  });

  it('list : les plus anciens d’abord, sous le plafond de tentatives ; compte les abandonnés', async () => {
    for (const [date, attempts] of [['2026-11-03', 5], ['2026-11-05', 1], ['2026-11-04', 4], ['2026-11-02', 9]] as const) {
      await db.query(`insert into public.drive_pending (date, files, attempts) values ($1, '[]', $2)`, [date, attempts]);
    }
    expect(await rpc(db, 'drive_pending_list', { p_max_attempts: 5, p_limit: 10 })).toEqual({
      rows: [
        { date: '2026-11-04', files: [], attempts: 4 },
        { date: '2026-11-05', files: [], attempts: 1 },
      ],
      abandoned: 2,
    });
    expect(((await rpc(db, 'drive_pending_list', { p_max_attempts: 5, p_limit: 1 })) as { rows: unknown[] }).rows).toHaveLength(1);
  });

  it('resolve supprime la ligne ; sans ligne, rien ne se passe', async () => {
    await queuePending(client, '2026-11-06', [pdfFile('2026-11-06')], 'x');
    await resolvePending(client, '2026-11-06');
    await resolvePending(client, '2026-11-06');
    expect(await pending()).toEqual([]);
  });

  it('réservées à la clé service', async () => {
    for (const role of ['anon', { email: ALLOWED_EMAIL }] as const) {
      await expect(rpc(db, 'drive_pending_list', {}, role)).rejects.toThrow(/permission denied/);
      await expect(rpc(db, 'drive_pending_resolve', { p_date: '2026-11-06' }, role)).rejects.toThrow(/permission denied/);
      await expect(rpc(db, 'audio_expired', { p_date: '2026-11-06' }, role)).rejects.toThrow(/permission denied/);
    }
  });
});

describe('retryPending', () => {
  it('relit les fichiers dans Storage, les dépose dans Drive et solde la ligne', async () => {
    await queuePending(client, '2026-11-06', [stored(pdfFile('2026-11-06')), stored(mp3File('2026-11-06', 'fr'))], 'Drive : HTTP 500');
    const r = await retryPending(client, drive, TODAY);
    expect(r).toEqual({ resolved: ['2026-11-06'], failed: [], abandoned: 0, issues: [] });
    expect(await pending()).toEqual([]);
    expect(server.google.tree()).toEqual(['Daily Brief/2026/11 - Novembre/Daily Brief 2026-11-06.pdf', 'Daily Brief/2026/11 - Novembre/Daily Brief 2026-11-06 FR.mp3']);
    expect(server.google.root.folders[0].folders[0].folders[0].files[0].bytes).toEqual(PDF_BYTES);
  });

  it('ne touche pas au dépôt du jour, que le passage en cours envoie lui-même', async () => {
    await queuePending(client, TODAY, [stored(pdfFile(TODAY))], 'x');
    const r = await retryPending(client, drive, TODAY);
    expect(r).toEqual({ resolved: [], failed: [], abandoned: 0, issues: [] });
    expect((await pending())[0].attempts).toBe(1);
    expect(server.hits).toEqual([]);
  });

  it('nouvel échec : une tentative de plus, seuls les fichiers restants sont gardés', async () => {
    await queuePending(client, '2026-11-06', [stored(pdfFile('2026-11-06')), stored(mp3File('2026-11-06', 'fr'))], 'x');
    // Le PDF passe, puis Apps Script tombe en panne pour le MP3.
    const flaky = createDriveClient({ url: server.url, token: DRIVE_TOKEN }, async (url, init) => {
      if (init?.body?.includes('FR.mp3')) server.state.mode = 'http-500';
      return (fetch as unknown as HttpFetch)(url, init);
    }, { hosts: [server.host], timeoutMs: 5_000 });
    const r = await retryPending(client, flaky, TODAY);
    expect(r.resolved).toEqual([]);
    expect(r.failed).toEqual(['2026-11-06']);
    expect(r.issues).toEqual([{ level: 'warning', message: 'dépôt Drive du 2026-11-06 toujours en attente (tentative 2 sur 5) : Drive Daily Brief 2026-11-06 FR.mp3 : HTTP 500' }]);
    expect(await pending()).toEqual([{ date: '2026-11-06', files: [mp3File('2026-11-06', 'fr')], attempts: 2, last_error: 'Drive Daily Brief 2026-11-06 FR.mp3 : HTTP 500' }]);
    expect(server.google.tree()).toEqual(['Daily Brief/2026/11 - Novembre/Daily Brief 2026-11-06.pdf']);
  });

  it('plafond de tentatives : au bout de 5 échecs le dépôt est abandonné et signalé', async () => {
    await queuePending(client, '2026-11-06', [stored(pdfFile('2026-11-06'))], 'x');
    server.state.mode = 'http-500';
    for (let i = 0; i < 6; i++) {
      // Un client neuf à chaque passage, comme chaque matin : le disjoncteur ne se reporte pas.
      const d = createDriveClient({ url: server.url, token: DRIVE_TOKEN }, fetch as unknown as HttpFetch, { hosts: [server.host], timeoutMs: 5_000 });
      await retryPending(client, d, TODAY);
    }
    expect((await pending())[0].attempts).toBe(MAX_ATTEMPTS);
    expect(server.hits).toHaveLength(MAX_ATTEMPTS - 1);
    const last = await retryPending(client, drive, TODAY);
    expect(last).toEqual({ resolved: [], failed: [], abandoned: 1, issues: [{ level: 'warning', message: '1 dépôt(s) Drive abandonné(s) après 5 tentatives (table drive_pending)' }] });
  });

  it('fichier purgé de Storage : abandonné avec un avertissement, la ligne est soldée', async () => {
    await queuePending(client, '2026-10-01', [stored(pdfFile('2026-10-01')), mp3File('2026-10-01', 'es')], 'x');
    const r = await retryPending(client, drive, TODAY);
    expect(r.resolved).toEqual(['2026-10-01']);
    expect(r.issues).toEqual([{ level: 'warning', message: 'Daily Brief 2026-10-01 ES.mp3 n’existe plus dans Supabase Storage : dépôt Drive abandonné' }]);
    expect(server.google.tree()).toEqual(['Daily Brief/2026/10 - Octobre/Daily Brief 2026-10-01.pdf']);
    expect(await pending()).toEqual([]);
  });

  it('ligne altérée : fichier d’une autre date, chemin étranger ou contenu qui n’est pas un PDF — jamais envoyé', async () => {
    stored(pdfFile('2026-11-06'), Buffer.from('<html>pas un pdf</html>'));
    fake.files.set('pdf/secret/autre.pdf', { bytes: PDF_BYTES, contentType: 'application/pdf' });
    const files = [pdfFile('2026-11-06'), { ...pdfFile('2026-11-06'), path: 'secret/autre.pdf' }, pdfFile('2026-11-05'), { name: 42 }, 'x'];
    await db.query(`insert into public.drive_pending (date, files, attempts) values ('2026-11-06', $1, 1), ('2026-11-05', '{"pas":"une liste"}', 1)`, [JSON.stringify(files)]);
    const r = await retryPending(client, drive, TODAY);
    expect(r.resolved).toEqual(['2026-11-05', '2026-11-06']);
    expect(r.issues.map((i) => i.message)).toEqual([
      'Daily Brief 2026-11-06.pdf relu dans Supabase Storage n’a pas le bon format : dépôt Drive abandonné',
      'dépôt en attente du 2026-11-06 : fichier incohérent ignoré',
      'dépôt en attente du 2026-11-06 : fichier incohérent ignoré',
      'dépôt en attente du 2026-11-06 : fichier incohérent ignoré',
      'dépôt en attente du 2026-11-06 : fichier incohérent ignoré',
    ]);
    expect(server.hits).toEqual([]);
    expect(fake.calls.filter((c) => c.method === 'GET').map((c) => c.path)).toEqual(['/storage/v1/object/pdf/2026-11-06/daily-brief-2026-11-06.pdf']);
  });

  it('jeton Drive refusé : arrêt immédiat, les autres dépôts ne perdent pas de tentative', async () => {
    for (const date of ['2026-11-04', '2026-11-05', '2026-11-06']) await queuePending(client, date, [stored(pdfFile(date)), stored(mp3File(date, 'fr'))], 'x');
    const refused = createDriveClient({ url: server.url, token: 'mauvais-jeton-de-test-0123456789-abcdef' }, fetch as unknown as HttpFetch, { hosts: [server.host], timeoutMs: 5_000 });
    const r = await retryPending(client, refused, TODAY);
    expect(r.failed).toEqual(['2026-11-04']);
    expect((await pending()).map((p) => [p.date, p.attempts, p.files.length])).toEqual([
      ['2026-11-04', 2, 2],
      ['2026-11-05', 1, 2],
      ['2026-11-06', 1, 2],
    ]);
    expect(server.hits.filter((h) => h.method === 'POST')).toHaveLength(1);
  });

  it('au plus 5 dépôts retentés par passage', async () => {
    for (let d = 1; d <= 7; d++) await queuePending(client, `2026-10-0${d}`, [stored(pdfFile(`2026-10-0${d}`))], 'x');
    const r = await retryPending(client, drive, TODAY);
    expect(r.resolved).toEqual(['2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04', '2026-10-05']);
    expect((await pending()).map((p) => p.date)).toEqual(['2026-10-06', '2026-10-07']);
  });

  it('Supabase illisible : un avertissement, aucun envoi', async () => {
    fake.intercept = () => ({ status: 500, json: {} });
    const r = await retryPending(client, drive, TODAY);
    expect(r).toEqual({ resolved: [], failed: [], abandoned: 0, issues: [{ level: 'warning', message: 'dépôts Drive en attente illisibles : Supabase drive_pending_list : HTTP 500' }] });
  });
});

describe('purgeExpiredAudio', () => {
  const edition = (date: string, lang: string, audio: string | null) =>
    db.query(`insert into public.editions (date, lang, region, headline, morning_brief, generated_at, audio_path) values ($1, $2, 'r', 'h', '[]', now(), $3)`, [date, lang, audio]);
  const audioPaths = async () => (await rows<{ d: string; audio_path: string | null }>(db, `select date::text as d, audio_path from public.editions order by date, lang`)).map((r) => [r.d, r.audio_path]);

  it('supprime les MP3 de plus de 30 jours du bucket, puis vide audio_path', async () => {
    await edition('2026-10-08', 'fr', '2026-10-08/fr.mp3'); // 31 jours avant le 8 novembre
    await edition('2026-10-08', 'en', '2026-10-08/en.mp3');
    await edition('2026-10-09', 'fr', '2026-10-09/fr.mp3'); // 30 jours : gardé
    await edition('2026-11-08', 'fr', '2026-11-08/fr.mp3');
    await edition('2026-09-01', 'fr', null);
    for (const p of ['2026-10-08/fr.mp3', '2026-10-08/en.mp3', '2026-10-09/fr.mp3', '2026-11-08/fr.mp3']) fake.files.set(`audio/${p}`, { bytes: MP3_BYTES, contentType: 'audio/mpeg' });
    expect(await purgeExpiredAudio(client, TODAY)).toEqual({ removed: 2, issues: [] });
    expect([...fake.files.keys()]).toEqual(['audio/2026-10-09/fr.mp3', 'audio/2026-11-08/fr.mp3']);
    expect(await audioPaths()).toEqual([
      ['2026-09-01', null],
      ['2026-10-08', null],
      ['2026-10-08', null],
      ['2026-10-09', '2026-10-09/fr.mp3'],
      ['2026-11-08', '2026-11-08/fr.mp3'],
    ]);
    // Second passage : plus rien à faire, aucun appel à Storage.
    const before = fake.calls.length;
    expect(await purgeExpiredAudio(client, TODAY)).toEqual({ removed: 0, issues: [] });
    expect(fake.calls.slice(before).map((c) => c.path)).toEqual(['/rest/v1/rpc/audio_expired']);
  });

  it('suppression en échec : avertissement, audio_path intact (rattrapé au passage suivant)', async () => {
    await edition('2026-10-01', 'fr', '2026-10-01/fr.mp3');
    fake.intercept = (c) => (c.method === 'DELETE' ? { status: 500, json: {} } : undefined);
    const r = await purgeExpiredAudio(client, TODAY);
    expect(r).toEqual({ removed: 0, issues: [{ level: 'warning', message: 'purge des MP3 de plus de 30 jours impossible : Supabase Storage (suppression dans audio) : HTTP 500' }] });
    expect(await audioPaths()).toEqual([['2026-10-01', '2026-10-01/fr.mp3']]);
  });

  it('ne supprime jamais un chemin qui n’a pas la forme AAAA-MM-JJ/<langue>.mp3', async () => {
    await edition('2026-10-01', 'fr', '../pdf/2026-10-01/daily-brief-2026-10-01.pdf');
    await edition('2026-10-02', 'fr', '2026-10-02/fr.mp3');
    const r = await purgeExpiredAudio(client, TODAY);
    expect(r).toEqual({ removed: 1, issues: [{ level: 'warning', message: 'purge audio : 1 chemin(s) inattendu(s) ignoré(s)' }] });
    expect(fake.calls.find((c) => c.method === 'DELETE')!.body).toBe('{"prefixes":["2026-10-02/fr.mp3"]}');
  });
});
```

- [ ] **Étape 2 : vérifier l'échec**

Commande : `npx vitest run pipeline/test/publish/retry-pending.test.ts`
Attendu : échec, « Cannot find module '../../publish/audio-purge' ».

- [ ] **Étape 3 : écrire les fonctions SQL et les modules**

Fichier `supabase/migrations/0004_files.sql` :

```sql
-- Daily Brief — dépôts Drive en attente (spec §10, §12) et purge des MP3 (spec §6.2).
-- Exécutables par la clé service seulement.

-- Met en attente (ou remet) le dépôt Drive d'une date : une tentative de plus.
create or replace function public.drive_pending_put(p_date date, p_files jsonb, p_error text) returns jsonb
language sql security invoker set search_path = ''
as $$
  insert into public.drive_pending as d (date, files, attempts, last_error)
  values (p_date, p_files, 1, p_error)
  on conflict (date) do update set
    files = excluded.files, attempts = d.attempts + 1, last_error = excluded.last_error, updated_at = now()
  returning jsonb_build_object('attempts', d.attempts);
$$;

-- Dépôts en attente à retenter (moins de p_max_attempts tentatives), les plus anciens d'abord,
-- et nombre de dépôts abandonnés.
create or replace function public.drive_pending_list(p_max_attempts integer default 5, p_limit integer default 5) returns jsonb
language sql stable security invoker set search_path = ''
as $$
  select jsonb_build_object(
    'rows', coalesce((
      select jsonb_agg(jsonb_build_object('date', x.date::text, 'files', x.files, 'attempts', x.attempts) order by x.date)
      from (select d.date, d.files, d.attempts from public.drive_pending d where d.attempts < p_max_attempts order by d.date limit p_limit) x
    ), '[]'::jsonb),
    'abandoned', (select count(*) from public.drive_pending d where d.attempts >= p_max_attempts)
  );
$$;

-- Le dépôt de p_date a abouti : la ligne en attente disparaît.
create or replace function public.drive_pending_resolve(p_date date) returns jsonb
language sql security invoker set search_path = ''
as $$
  with gone as (delete from public.drive_pending d where d.date = p_date returning 1)
  select jsonb_build_object('deleted', (select count(*) from gone));
$$;

-- Nouvel échec du dépôt de p_date : une tentative de plus, et seuls les fichiers restants sont gardés.
create or replace function public.drive_pending_fail(p_date date, p_error text, p_files jsonb) returns jsonb
language sql security invoker set search_path = ''
as $$
  with upd as (
    update public.drive_pending d
    set attempts = d.attempts + 1, last_error = p_error, files = coalesce(p_files, d.files), updated_at = now()
    where d.date = p_date
    returning d.attempts
  )
  select jsonb_build_object('attempts', (select attempts from upd));
$$;

-- Chemins des MP3 d'éditions de plus de p_days jours avant p_date (purge à 30 jours, spec §6.2).
create or replace function public.audio_expired(p_date date, p_days integer default 30) returns jsonb
language sql stable security invoker set search_path = ''
as $$
  select coalesce(jsonb_agg(e.audio_path order by e.audio_path), '[]'::jsonb)
  from public.editions e
  where e.audio_path is not null and e.date < p_date - p_days;
$$;

-- Les MP3 de ces chemins ont été supprimés du bucket : les éditions n'ont plus de lecteur.
create or replace function public.audio_clear(p_paths jsonb) returns jsonb
language sql security invoker set search_path = ''
as $$
  with upd as (
    update public.editions e set audio_path = null
    where e.audio_path in (select jsonb_array_elements_text(coalesce(p_paths, '[]'::jsonb)))
    returning 1
  )
  select jsonb_build_object('cleared', (select count(*) from upd));
$$;

-- Supabase accorde par défaut l'exécution des fonctions de `public` à anon et authenticated :
-- celles-ci sont réservées à la clé service.
do $$
declare
  f text;
begin
  foreach f in array array[
    'drive_pending_put(date, jsonb, text)',
    'drive_pending_list(integer, integer)',
    'drive_pending_resolve(date)',
    'drive_pending_fail(date, text, jsonb)',
    'audio_expired(date, integer)',
    'audio_clear(jsonb)'
  ]
  loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
    execute format('grant execute on function public.%s to service_role', f);
  end loop;
end
$$;
```

Fichier `pipeline/publish/retry-pending.ts` :

```ts
import { z } from 'zod';
import { IsoDateSchema } from '@daily-brief/schema';
import { messageOf } from '../collect/http';
import type { SupabaseClient } from '../supabase/client';
import type { DriveClient } from './drive';
import { isDayFile, looksLike, type DayFile } from './files';
import type { PublishIssue } from './inputs';

/** Après ce nombre de tentatives, un dépôt en attente n'est plus retenté (il reste visible dans `drive_pending`). */
export const MAX_ATTEMPTS = 5;
/** Dépôts en attente retentés par passage, les plus anciens d'abord : le passage reste borné dans le temps. */
export const RETRY_LIMIT = 5;

const FileSchema = z.object({ name: z.string(), mimeType: z.enum(['application/pdf', 'audio/mpeg']), bucket: z.enum(['pdf', 'audio']), path: z.string() });
const ListSchema = z.object({
  rows: z.array(z.object({ date: IsoDateSchema, files: z.unknown(), attempts: z.number().int().min(0) })),
  abandoned: z.number().int().min(0),
});
const Ack = z.object({}).loose();

/** Met en attente le dépôt Drive de `date` : ces fichiers seront relus dans Storage au passage suivant. */
export async function queuePending(client: SupabaseClient, date: string, files: DayFile[], error: string): Promise<void> {
  await client.rpc('drive_pending_put', { p_date: date, p_files: files, p_error: error.slice(0, 500) }, Ack);
}

/** Le dépôt de `date` a abouti : sa ligne en attente, s'il y en a une, disparaît. */
export async function resolvePending(client: SupabaseClient, date: string): Promise<void> {
  await client.rpc('drive_pending_resolve', { p_date: date }, Ack);
}

export type RetryResult = {
  /** Dates dont tous les fichiers sont maintenant dans Drive. */
  resolved: string[];
  /** Dates encore en attente après ce passage. */
  failed: string[];
  /** Dépôts abandonnés (au moins `MAX_ATTEMPTS` tentatives). */
  abandoned: number;
  issues: PublishIssue[];
};

/**
 * Retente les dépôts Drive en attente (spec §10, §12), sauf celui de `today`, que le passage en
 * cours envoie lui-même. Chaque fichier est relu dans Supabase Storage et revérifié (nom, date,
 * type, premiers octets) avant l'envoi. Un fichier qui n'existe plus dans Storage (MP3 purgé après
 * 30 jours) est abandonné avec un avertissement. Si Drive ou Supabase est coupé, on s'arrête là :
 * les dépôts non essayés ne perdent pas de tentative.
 */
export async function retryPending(client: SupabaseClient, drive: DriveClient, today: string): Promise<RetryResult> {
  const out: RetryResult = { resolved: [], failed: [], abandoned: 0, issues: [] };
  const warn = (message: string) => out.issues.push({ level: 'warning', message });
  let list: z.infer<typeof ListSchema>;
  try {
    list = await client.rpc('drive_pending_list', { p_max_attempts: MAX_ATTEMPTS, p_limit: RETRY_LIMIT + 1 }, ListSchema);
  } catch (e) {
    warn(`dépôts Drive en attente illisibles : ${messageOf(e)}`);
    return out;
  }
  out.abandoned = list.abandoned;
  if (list.abandoned > 0) warn(`${list.abandoned} dépôt(s) Drive abandonné(s) après ${MAX_ATTEMPTS} tentatives (table drive_pending)`);

  for (const row of list.rows.filter((r) => r.date !== today).slice(0, RETRY_LIMIT)) {
    if (drive.breaker.open || client.breaker.open) break;
    const parsed = z.array(z.unknown()).safeParse(row.files);
    const remaining: DayFile[] = [];
    let lastError = '';
    for (const raw of parsed.success ? parsed.data : []) {
      const f = FileSchema.safeParse(raw);
      if (!f.success || !isDayFile(f.data, row.date)) {
        warn(`dépôt en attente du ${row.date} : fichier incohérent ignoré`);
        continue;
      }
      const file = f.data;
      if (drive.breaker.open || client.breaker.open) {
        // Coupure en cours de ligne : le fichier reste en attente, sans être essayé.
        lastError ||= drive.breaker.open ? `Drive coupé (${drive.breaker.reason})` : `Supabase coupé (${client.breaker.reason})`;
        remaining.push(file);
        continue;
      }
      try {
        const bytes = await client.download(file.bucket, file.path);
        if (bytes === null) {
          warn(`${file.name} n’existe plus dans Supabase Storage : dépôt Drive abandonné`);
          continue;
        }
        if (!looksLike(file, bytes)) {
          warn(`${file.name} relu dans Supabase Storage n’a pas le bon format : dépôt Drive abandonné`);
          continue;
        }
        await drive.send(row.date, file, bytes);
      } catch (e) {
        lastError = messageOf(e);
        remaining.push(file);
      }
    }
    try {
      if (remaining.length === 0) {
        await resolvePending(client, row.date);
        out.resolved.push(row.date);
      } else {
        await client.rpc('drive_pending_fail', { p_date: row.date, p_error: lastError.slice(0, 500), p_files: remaining }, Ack);
        out.failed.push(row.date);
        warn(`dépôt Drive du ${row.date} toujours en attente (tentative ${row.attempts + 1} sur ${MAX_ATTEMPTS}) : ${lastError}`);
      }
    } catch (e) {
      out.failed.push(row.date);
      warn(`dépôt en attente du ${row.date} : mise à jour impossible : ${messageOf(e)}`);
    }
  }
  return out;
}
```

Fichier `pipeline/publish/audio-purge.ts` :

```ts
import { z } from 'zod';
import { messageOf } from '../collect/http';
import type { SupabaseClient } from '../supabase/client';
import type { PublishIssue } from './inputs';

/** Les MP3 sont gardés 30 jours (spec §6.2). */
export const AUDIO_RETENTION_DAYS = 30;

/** Seul un chemin écrit par la publication (`AAAA-MM-JJ/<langue>.mp3`) peut être supprimé. */
const AUDIO_PATH = /^\d{4}-\d{2}-\d{2}\/(fr|en|es)\.mp3$/;
const Paths = z.array(z.string());
const Ack = z.object({}).loose();

/**
 * Supprime du bucket `audio` les MP3 des éditions de plus de 30 jours, par l'API Storage (une
 * suppression en SQL laisserait le fichier orphelin), puis vide `editions.audio_path`. Dans cet
 * ordre : un échec après la suppression est rattrapé au passage suivant, la suppression d'un
 * fichier déjà absent étant sans effet. Tout échec n'est qu'un avertissement.
 */
export async function purgeExpiredAudio(client: SupabaseClient, date: string): Promise<{ removed: number; issues: PublishIssue[] }> {
  try {
    const expired = await client.rpc('audio_expired', { p_date: date, p_days: AUDIO_RETENTION_DAYS }, Paths);
    const paths = expired.filter((p) => AUDIO_PATH.test(p));
    const issues: PublishIssue[] = paths.length < expired.length ? [{ level: 'warning', message: `purge audio : ${expired.length - paths.length} chemin(s) inattendu(s) ignoré(s)` }] : [];
    if (paths.length === 0) return { removed: 0, issues };
    await client.remove('audio', paths);
    await client.rpc('audio_clear', { p_paths: paths }, Ack);
    return { removed: paths.length, issues };
  } catch (e) {
    return { removed: 0, issues: [{ level: 'warning', message: `purge des MP3 de plus de ${AUDIO_RETENTION_DAYS} jours impossible : ${messageOf(e)}` }] };
  }
}
```

- [ ] **Étape 4 : vérifier le succès**

Commande : `npx vitest run pipeline/test/publish/retry-pending.test.ts`
Attendu : `Test Files  1 passed (1)` et `Tests  16 passed (16)`.

Commande : `npm test && npm run typecheck`
Attendu : `Test Files  64 passed (64)`, `Tests  636 passed (636)`, et `tsc` sans sortie.

- [ ] **Étape 5 : commit**

```bash
git add supabase/migrations/0004_files.sql pipeline/publish/retry-pending.ts pipeline/publish/audio-purge.ts pipeline/test/publish/retry-pending.test.ts
git commit -m "feat(publish): dépôts Drive en attente et purge des MP3 à 30 jours"
```

---

### Tâche 11 : bilan des étapes pour `runs`

**Fichiers :**
- Créer : `pipeline/publish/run-summary.ts`
- Test : `pipeline/test/publish/reports.ts`, `pipeline/test/publish/run-summary.test.ts`

Comportement attendu :
- **Bilan.** `summarizeReports(dayDir, date)` résume `context-report.json`, `collect-report.json`, `verify-report.json` et `render-report.json` : statut (`ok`, `degraded`, `failed`), fin (`generatedAt`), compteurs et au plus 5 erreurs de 300 caractères.
- **Collecte.** Le bilan garde `perLang` et en tire `light` par langue.
- **Rapport manquant.** Il donne `missing` sans avertissement. Un rapport illisible, d'une forme inattendue ou d'une autre date donne `unreadable` avec un avertissement ; jamais d'exception.
- **Statuts.** Un code 2 donne `failed` ; `verify` code 1 donne `degraded`. Un rendu réussi mais avec une erreur donne `degraded`, et un rendu sans PDF, `failed`.

- [ ] **Étape 1 : écrire les rapports d'exemple et les tests**

Fichier `pipeline/test/publish/reports.ts` :

```ts
import { DAY } from './day';

/** Rapports des étapes précédentes, à la forme écrite par `brief:context`, `brief:collect` et `brief:verify`. */
export function stepReports(date: string = DAY): Record<string, string> {
  const context = {
    date,
    generatedAt: `${date}T04:13:05.000Z`,
    exitCode: 0,
    store: 'supabase',
    staleDays: 21,
    closedThreads: ['t-1'],
    openThreads: 5,
    yesterdayTopics: 9,
    issues: [{ level: 'warning', message: 'Thread t-9 : événement daté du 2026-12-25, à plus de 7 jours dans le futur' }],
  };
  const collect = {
    date,
    generatedAt: `${date}T04:18:40.000Z`,
    exitCode: 0,
    degraded: true,
    primary: 'thenewsapi',
    articles: 212,
    groups: 131,
    perLang: { fr: { articles: 90, fullTexts: 31, light: false }, en: { articles: 70, fullTexts: 22, light: false }, es: { articles: 52, fullTexts: 9, light: true } },
    sources: {},
    issues: [
      { level: 'error', source: 'webz', message: 'webz : HTTP 429 (https://api.webz.io/newsApiLite?token=***) — source coupée' },
      { level: 'warning', source: 'rss', message: 'democrata.es : HTTP 403' },
    ],
  };
  const verify = {
    date,
    generatedAt: `${date}T04:31:00.000Z`,
    exitCode: 1,
    editions: [
      { lang: 'fr', written: true },
      { lang: 'en', written: true },
      { lang: 'es', written: true },
    ],
    issues: [
      { rule: 'R5', level: 'fixed', lang: 'en', storyId: 'en-8', message: 'citation retirée' },
      { rule: 'R3', level: 'warning', lang: 'fr', message: 'un seul média' },
    ],
  };
  return {
    'context-report.json': JSON.stringify(context, null, 2),
    'collect-report.json': JSON.stringify(collect, null, 2),
    'verify-report.json': JSON.stringify(verify, null, 2),
  };
}
```

Fichier `pipeline/test/publish/run-summary.test.ts` :

```ts
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { capErrors, summarizeReports } from '../../publish/run-summary';
import { DAY, makeDay, RENDERED_AT } from './day';
import { stepReports } from './reports';

describe('summarizeReports', () => {
  it('résume les quatre rapports : statut, fin, compteurs, erreurs', () => {
    const { dayDir } = makeDay({ extra: stepReports() });
    const r = summarizeReports(dayDir, DAY);
    expect(r.issues).toEqual([]);
    expect(r.steps).toEqual({
      context: { status: 'ok', finishedAt: '2026-11-06T04:13:05.000Z', durationMs: null, counters: { openThreads: 5, yesterdayTopics: 9, closedThreads: 1, warnings: 1 }, errors: [] },
      collect: {
        status: 'degraded',
        finishedAt: '2026-11-06T04:18:40.000Z',
        durationMs: null,
        counters: { articles: 212, groups: 131, warnings: 1 },
        errors: ['webz : HTTP 429 (https://api.webz.io/newsApiLite?token=***) — source coupée'],
        perLang: { fr: { articles: 90, fullTexts: 31, light: false }, en: { articles: 70, fullTexts: 22, light: false }, es: { articles: 52, fullTexts: 9, light: true } },
      },
      verify: { status: 'degraded', finishedAt: '2026-11-06T04:31:00.000Z', durationMs: null, counters: { editions: 3, fixed: 1, warnings: 1, errors: 0 }, errors: [] },
      render: { status: 'ok', finishedAt: RENDERED_AT, durationMs: null, counters: { finals: 3, pdfEditions: 3, pdf: 1, warnings: 0 }, errors: [] },
    });
    expect(r.light).toEqual({ fr: false, en: false, es: true });
  });

  it('rapport absent : « missing », sans avertissement ; aucune édition n’est dite allégée', () => {
    const { dayDir } = makeDay();
    const r = summarizeReports(dayDir, DAY);
    const missing = { status: 'missing', finishedAt: null, durationMs: null, counters: {}, errors: [] };
    expect([r.steps.context, r.steps.collect, r.steps.verify]).toEqual([missing, missing, missing]);
    expect(r.steps.render.status).toBe('ok');
    expect(r.light).toEqual({});
    expect(r.issues).toEqual([]);
  });

  it('rapport illisible, d’une forme inattendue ou d’une autre date : « unreadable » et avertissement', () => {
    const { dayDir } = makeDay({ extra: { ...stepReports('2026-11-05'), 'context-report.json': '{ tronqué', 'verify-report.json': '{"date":"2026-11-06"}' } });
    const r = summarizeReports(dayDir, DAY);
    expect([r.steps.context.status, r.steps.collect.status, r.steps.verify.status]).toEqual(['unreadable', 'unreadable', 'unreadable']);
    expect(r.light).toEqual({});
    expect(r.issues).toEqual([
      { level: 'warning', message: 'context-report.json illisible : étape notée « unreadable » dans runs' },
      { level: 'warning', message: 'collect-report.json est celui du 2026-11-05 : étape notée « unreadable » dans runs' },
      { level: 'warning', message: 'verify-report.json illisible : étape notée « unreadable » dans runs' },
    ]);
  });

  it('codes de sortie 2 : étapes en échec ; rendu sans PDF : échec', () => {
    const reports = stepReports();
    const fail = (name: string) => JSON.stringify({ ...JSON.parse(reports[name]), exitCode: 2 });
    const { dayDir } = makeDay({ pdf: null, extra: { 'context-report.json': fail('context-report.json'), 'collect-report.json': fail('collect-report.json'), 'verify-report.json': fail('verify-report.json') } });
    const s = summarizeReports(dayDir, DAY).steps;
    expect([s.context.status, s.collect.status, s.verify.status, s.render.status]).toEqual(['failed', 'failed', 'failed', 'failed']);
    expect(s.render.counters).toEqual({ finals: 3, pdfEditions: 0, pdf: 0, warnings: 0 });
  });

  it('rendu réussi mais avec une édition en erreur : « degraded »', () => {
    const { dayDir } = makeDay();
    const report = { date: DAY, generatedAt: RENDERED_AT, exitCode: 0, pdf: 'Daily Brief 2026-11-06.pdf', langs: ['fr'], finals: ['fr'], issues: [{ level: 'error', lang: 'en', message: 'en.verified.json invalide' }] };
    writeFileSync(join(dayDir, 'render-report.json'), JSON.stringify(report));
    expect(summarizeReports(dayDir, DAY).steps.render).toMatchObject({ status: 'degraded', errors: ['en.verified.json invalide'] });
  });

  it('capErrors : au plus 5 messages de 300 caractères', () => {
    const out = capErrors(Array.from({ length: 8 }, (_, i) => `${i} ${'x'.repeat(400)}`));
    expect(out).toHaveLength(5);
    expect(out.every((m) => m.length === 300 && m.endsWith('…'))).toBe(true);
    expect(capErrors(['court'])).toEqual(['court']);
  });
});
```

- [ ] **Étape 2 : vérifier l'échec**

Commande : `npx vitest run pipeline/test/publish/run-summary.test.ts`
Attendu : échec, « Cannot find module '../../publish/run-summary' ».

- [ ] **Étape 3 : écrire le module**

Fichier `pipeline/publish/run-summary.ts` :

```ts
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import { IsoDateSchema, LANGS, type Lang } from '@daily-brief/schema';
import type { PublishIssue } from './inputs';

export type StepStatus = 'ok' | 'degraded' | 'failed' | 'missing' | 'unreadable';

/** Bilan d'une étape, rangé dans `runs.steps.<étape>` et affiché par la page Santé. */
export type StepSummary = {
  status: StepStatus;
  /** Fin de l'étape (`generatedAt` de son rapport). */
  finishedAt: string | null;
  /** Durée en ms ; null quand le rapport de l'étape ne la mesure pas. */
  durationMs: number | null;
  counters: Record<string, number>;
  errors: string[];
  /** Collecte seulement : articles, textes lus et édition allégée par langue. */
  perLang?: Partial<Record<Lang, { articles: number; fullTexts: number; light: boolean }>>;
};

export const MAX_ERRORS = 5;
export const MAX_ERROR_CHARS = 300;

/** Au plus 5 messages de 300 caractères : `runs` reste léger. */
export const capErrors = (messages: string[]): string[] => messages.slice(0, MAX_ERRORS).map((m) => (m.length > MAX_ERROR_CHARS ? `${m.slice(0, MAX_ERROR_CHARS - 1)}…` : m));

const Issues = z.array(z.object({ level: z.string(), message: z.string() }));
const Base = { date: IsoDateSchema, generatedAt: z.iso.datetime({ offset: true }), exitCode: z.number().int(), issues: Issues };
const ContextReport = z.object({ ...Base, openThreads: z.number().int(), yesterdayTopics: z.number().int(), closedThreads: z.array(z.string()) });
const LangStats = z.object({ articles: z.number().int(), fullTexts: z.number().int(), light: z.boolean() });
const CollectReport = z.object({ ...Base, degraded: z.boolean(), articles: z.number().int(), groups: z.number().int(), perLang: z.object({ fr: LangStats, en: LangStats, es: LangStats }).partial() });
const VerifyReport = z.object({ ...Base, editions: z.array(z.object({ lang: z.string(), written: z.boolean() })) });
const RenderReport = z.object({ ...Base, pdf: z.string().nullable(), langs: z.array(z.string()), finals: z.array(z.string()) });

const errorsOf = (issues: z.infer<typeof Issues>) => capErrors(issues.filter((i) => i.level === 'error').map((i) => i.message));
const countOf = (issues: z.infer<typeof Issues>, level: string) => issues.filter((i) => i.level === level).length;

export type ReportsSummary = {
  steps: Record<'context' | 'collect' | 'verify' | 'render', StepSummary>;
  /** Éditions allégées d'après la collecte (`perLang.<lang>.light`). */
  light: Partial<Record<Lang, boolean>>;
  issues: PublishIssue[];
};

/**
 * Résume les rapports des étapes précédentes (`context-report.json`, `collect-report.json`,
 * `verify-report.json`, `render-report.json`) pour la ligne `runs` du jour. Un rapport absent donne
 * `missing`, un rapport illisible ou d'une autre date `unreadable` avec un avertissement : jamais
 * d'exception. Ces rapports ne mesurent pas leur durée : `durationMs` vaut null.
 */
export function summarizeReports(dayDir: string, date: string): ReportsSummary {
  const issues: PublishIssue[] = [];
  const light: Partial<Record<Lang, boolean>> = {};

  function step<T extends { date: string; generatedAt: string }>(file: string, schema: z.ZodType<T>, build: (r: T) => Omit<StepSummary, 'finishedAt' | 'durationMs'>): StepSummary {
    const empty = (status: StepStatus): StepSummary => ({ status, finishedAt: null, durationMs: null, counters: {}, errors: [] });
    const path = join(dayDir, file);
    if (!existsSync(path)) return empty('missing');
    let report: T;
    try {
      report = schema.parse(JSON.parse(readFileSync(path, 'utf8')));
    } catch {
      issues.push({ level: 'warning', message: `${file} illisible : étape notée « unreadable » dans runs` });
      return empty('unreadable');
    }
    if (report.date !== date) {
      issues.push({ level: 'warning', message: `${file} est celui du ${report.date} : étape notée « unreadable » dans runs` });
      return empty('unreadable');
    }
    return { ...build(report), finishedAt: report.generatedAt, durationMs: null };
  }

  const steps = {
    context: step('context-report.json', ContextReport, (r) => ({
      status: r.exitCode === 0 ? 'ok' : 'failed',
      counters: { openThreads: r.openThreads, yesterdayTopics: r.yesterdayTopics, closedThreads: r.closedThreads.length, warnings: countOf(r.issues, 'warning') },
      errors: errorsOf(r.issues),
    })),
    collect: step('collect-report.json', CollectReport, (r) => {
      for (const lang of LANGS) if (r.perLang[lang]) light[lang] = r.perLang[lang].light;
      return {
        status: r.exitCode !== 0 ? 'failed' : r.degraded ? 'degraded' : 'ok',
        counters: { articles: r.articles, groups: r.groups, warnings: countOf(r.issues, 'warning') },
        errors: errorsOf(r.issues),
        perLang: r.perLang,
      };
    }),
    verify: step('verify-report.json', VerifyReport, (r) => ({
      status: r.exitCode === 0 ? 'ok' : r.exitCode === 1 ? 'degraded' : 'failed',
      counters: { editions: r.editions.filter((e) => e.written).length, fixed: countOf(r.issues, 'fixed'), warnings: countOf(r.issues, 'warning'), errors: countOf(r.issues, 'error') },
      errors: errorsOf(r.issues),
    })),
    render: step('render-report.json', RenderReport, (r) => ({
      status: r.exitCode === 0 ? (countOf(r.issues, 'error') ? 'degraded' : 'ok') : 'failed',
      counters: { finals: r.finals.length, pdfEditions: r.langs.length, pdf: r.pdf ? 1 : 0, warnings: countOf(r.issues, 'warning') },
      errors: errorsOf(r.issues),
    })),
  };
  return { steps, light, issues };
}
```

- [ ] **Étape 4 : vérifier le succès**

Commande : `npx vitest run pipeline/test/publish/run-summary.test.ts`
Attendu : `Test Files  1 passed (1)` et `Tests  6 passed (6)`.

Commande : `npm test && npm run typecheck`
Attendu : `Test Files  65 passed (65)`, `Tests  642 passed (642)`, et `tsc` sans sortie.

- [ ] **Étape 5 : commit**

```bash
git add pipeline/publish/run-summary.ts pipeline/test/publish/reports.ts pipeline/test/publish/run-summary.test.ts
git commit -m "feat(publish): bilan des étapes pour la table runs"
```

---

### Tâche 12 : orchestration de `brief:publish`

**Fichiers :**
- Créer : `pipeline/publish/run-publish.ts`
- Test : `pipeline/test/publish/run-publish.test.ts`

Comportement attendu :
- **Ordre.** Dépôts en attente, Storage, éditions, Drive, purge, `runs`, puis `publish-report.json` (atomique, l'ancien supprimé d'abord). Chaque étape est indépendante, et rien ne lève.
- **Passage complet.** Trois éditions, trois fichiers dans Storage puis dans Drive, statut `ok`, code 0. La ligne `runs` porte le bilan des sept clés (`context`, `collect`, `verify`, `render`, `publish`, `drive`, `closedThreads`), et l'édition ES devient `light` d'après la collecte.
- **Relance.** Mêmes lignes, un seul fichier actif dans Drive (l'ancien à la corbeille), une seule ligne `runs`, et les fermetures notées par `brief:context` sont gardées.
- **Drive en panne.** Éditions publiées, fichiers en attente, code 0, statut `degraded`. Le lendemain, la relance passe d'abord, depuis Storage, avec les mêmes octets, puis le dépôt du jour. Relancer la même date solde aussi la ligne.
- **Sans Supabase.** Code 2, aucun appel ; le PDF part quand même dans Drive. Sans Drive : avertissement et statut `ok`. URL Apps Script hors de Google : erreur, et le jeton n'est envoyé nulle part.
- **Pannes de Supabase.** Une clé refusée donne le code 2 après un seul appel. Supabase muet est interrompu à l'échéance globale.
- **Édition invalide.** Les autres sont publiées, le statut est `degraded`, et l'erreur va dans `runs` avec sa langue.
- **Rien à publier.** Sans `render-report.json`, code 2 et rien n'est envoyé.
- **PDF.** S'il est refusé par Storage, les éditions sont publiées sans PDF. S'il manque à Storage et que Drive est en panne, il n'est ni déposé ni mis en attente, et c'est une erreur.
- **Divers.** Purge après une publication réussie ; date invalide : code 2, aucun fichier.
- **Secrets.** Aucun secret dans le rapport, `runs` ou `drive_pending`, même quand les erreurs les citent.

- [ ] **Étape 1 : écrire les tests**

Fichier `pipeline/test/publish/run-publish.test.ts` :

```ts
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { HttpFetch } from '../../collect/http';
import { mp3File, pdfFile } from '../../publish/files';
import { runPublish, type RunPublishOptions } from '../../publish/run-publish';
import { FAKE_KEY, FAKE_URL, fakeSupabase, type FakeSupabase } from '../supabase/fake-supabase';
import { createTestDb, resetData, rows, type TestDb } from '../supabase/pg';
import { DRIVE_TOKEN, startAppsScript } from './apps-script-server';
import { DAY, makeDay, MP3_BYTES, PDF_BYTES, type DayOptions } from './day';
import { stepReports } from './reports';

const NOW = new Date('2026-11-06T04:45:00.000Z');
let db: TestDb;
let fake: FakeSupabase;
let server: Awaited<ReturnType<typeof startAppsScript>>;

beforeAll(async () => {
  db = await createTestDb();
}, 60_000);
afterAll(async () => {
  await db.close();
});
beforeEach(async () => {
  await resetData(db);
  fake = fakeSupabase(db);
  server = await startAppsScript();
});
afterEach(async () => {
  await server.close();
});

const env = () => ({ SUPABASE_URL: FAKE_URL, SUPABASE_SERVICE_ROLE_KEY: FAKE_KEY, APPS_SCRIPT_URL: server.url, APPS_SCRIPT_TOKEN: DRIVE_TOKEN });
/** Lance la publication sur un dossier du jour neuf (ou sur `outDir`), avec une horloge fixe. */
async function publish(day: DayOptions = {}, over: Partial<RunPublishOptions> = {}) {
  const made = over.outDir ? { outDir: over.outDir, dayDir: join(over.outDir, over.date ?? day.date ?? DAY) } : makeDay(day);
  let t = 0;
  const r = await runPublish({
    outDir: made.outDir,
    date: day.date ?? DAY,
    env: env(),
    supabaseFetch: fake.fetch,
    driveFetch: fetch as unknown as HttpFetch,
    driveHosts: [server.host],
    driveTimeoutMs: 5_000,
    now: NOW,
    clock: () => (t += 250),
    ...over,
  });
  return { ...r, ...made };
}
const count = async (table: string) => (await rows<{ n: number }>(db, `select count(*)::int as n from public.${table}`))[0].n;
const runsRow = async () => (await rows<{ date: string; status: string; steps: Record<string, any>; notes: string }>(db, 'select date::text as date, status, steps, notes from public.runs order by date'))[0];
const TREE = ['Daily Brief/2026/11 - Novembre/Daily Brief 2026-11-06.pdf'];

describe('runPublish', () => {
  it('passage complet : éditions, Storage, Drive, runs et rapport', async () => {
    const r = await publish({ audio: ['fr', 'en'], extra: stepReports() });
    expect(r.exitCode).toBe(0);
    expect(r.reportWritten).toBe(true);
    expect(r.report).toEqual({
      date: DAY,
      generatedAt: '2026-11-06T04:45:00.000Z',
      exitCode: 0,
      status: 'ok',
      editions: [
        { lang: 'fr', published: true, stories: 7, sources: 26, vocab: 0, threadsCreated: 4 },
        { lang: 'en', published: true, stories: 1, sources: 11, vocab: 6, threadsCreated: 1 },
        { lang: 'es', published: true, stories: 2, sources: 13, vocab: 6, threadsCreated: 1 },
      ],
      files: [
        { name: 'Daily Brief 2026-11-06.pdf', bucket: 'pdf', path: '2026-11-06/daily-brief-2026-11-06.pdf', stored: true },
        { name: 'Daily Brief 2026-11-06 FR.mp3', bucket: 'audio', path: '2026-11-06/fr.mp3', stored: true },
        { name: 'Daily Brief 2026-11-06 EN.mp3', bucket: 'audio', path: '2026-11-06/en.mp3', stored: true },
      ],
      drive: { status: 'sent', sent: ['Daily Brief 2026-11-06.pdf', 'Daily Brief 2026-11-06 FR.mp3', 'Daily Brief 2026-11-06 EN.mp3'], pending: [], retried: { resolved: [], failed: [], abandoned: 0 } },
      audioPurged: 0,
      runSaved: true,
      durationMs: 500,
      issues: [],
    });
    expect(JSON.parse(readFileSync(join(r.dayDir, 'publish-report.json'), 'utf8'))).toEqual(r.report);
    expect(existsSync(join(r.dayDir, 'publish-report.json.tmp'))).toBe(false);
    expect(await rows(db, 'select lang, status, pdf_path, audio_path from public.editions order by lang')).toEqual([
      { lang: 'en', status: 'published', pdf_path: '2026-11-06/daily-brief-2026-11-06.pdf', audio_path: '2026-11-06/en.mp3' },
      { lang: 'es', status: 'light', pdf_path: '2026-11-06/daily-brief-2026-11-06.pdf', audio_path: null },
      { lang: 'fr', status: 'published', pdf_path: '2026-11-06/daily-brief-2026-11-06.pdf', audio_path: '2026-11-06/fr.mp3' },
    ]);
    expect([...fake.files.keys()].sort()).toEqual(['audio/2026-11-06/en.mp3', 'audio/2026-11-06/fr.mp3', 'pdf/2026-11-06/daily-brief-2026-11-06.pdf']);
    expect(server.google.tree()).toEqual([...TREE, 'Daily Brief/2026/11 - Novembre/Daily Brief 2026-11-06 FR.mp3', 'Daily Brief/2026/11 - Novembre/Daily Brief 2026-11-06 EN.mp3']);
    expect(await count('drive_pending')).toBe(0);
  });

  it('écrit la ligne runs : statut, bilan de chaque étape, édition allégée recopiée de la collecte', async () => {
    await publish({ extra: stepReports() });
    const run = await runsRow();
    expect([run.date, run.status, run.notes]).toEqual([DAY, 'ok', '3 édition(s) publiée(s) : FR, EN, ES ; Drive : sent']);
    expect(Object.keys(run.steps).sort()).toEqual(['closedThreads', 'collect', 'context', 'drive', 'publish', 'render', 'verify']);
    expect(run.steps.collect.perLang.es).toEqual({ articles: 52, fullTexts: 9, light: true });
    expect(run.steps.collect.status).toBe('degraded');
    expect(run.steps.verify.counters).toEqual({ editions: 3, fixed: 1, warnings: 1, errors: 0 });
    expect(run.steps.publish).toEqual({
      status: 'ok',
      finishedAt: '2026-11-06T04:45:00.000Z',
      durationMs: 250,
      counters: { editions: 3, stories: 10, sources: 50, vocab: 12, threadsCreated: 6, files: 1, audioPurged: 0 },
      errors: [],
    });
    expect(run.steps.drive).toEqual({ status: 'sent', counters: { sent: 1, pending: 0, retriedResolved: 0, retriedFailed: 0, abandoned: 0 }, errors: [] });
  });

  it('relancer la date remplace tout proprement : mêmes lignes, un seul fichier dans Drive, une seule ligne runs', async () => {
    const first = await publish();
    const before = [await count('editions'), await count('stories'), await count('sources'), await count('vocab_items'), await count('threads'), await count('thread_events'), await count('runs')];
    const second = await publish({}, { outDir: first.outDir });
    expect(second.report.editions.map((e) => e.threadsCreated)).toEqual([0, 0, 0]);
    expect([await count('editions'), await count('stories'), await count('sources'), await count('vocab_items'), await count('threads'), await count('thread_events'), await count('runs')]).toEqual(before);
    expect(server.google.tree()).toEqual(['Daily Brief/2026/11 - Novembre/Daily Brief 2026-11-06.pdf (corbeille)', ...TREE]);
    expect(fake.files.size).toBe(1);
  });

  it('garde les fermetures de Threads notées par brief:context dans runs', async () => {
    await db.query(`insert into public.runs (date, status, steps) values ($1, 'running', '{"closedThreads":["t-1","t-2"]}')`, [DAY]);
    await publish();
    const run = await runsRow();
    expect(run.status).toBe('ok');
    expect(run.steps.closedThreads).toEqual(['t-1', 't-2']);
  });

  it('supprime d’abord l’ancien rapport', async () => {
    const { outDir, dayDir } = makeDay();
    writeFileSync(join(dayDir, 'publish-report.json'), '{"exitCode":0,"périmé":true}');
    const r = await publish({}, { outDir, env: {} });
    expect(r.exitCode).toBe(2);
    expect(JSON.parse(readFileSync(join(dayDir, 'publish-report.json'), 'utf8')).périmé).toBeUndefined();
  });

  it('Drive en panne : éditions publiées, fichiers mis en attente, code 0 et statut dégradé', async () => {
    server.state.mode = 'http-500';
    const r = await publish({ audio: ['fr'] });
    expect(r.exitCode).toBe(0);
    expect(r.report.status).toBe('degraded');
    expect(r.report.drive).toEqual({ status: 'pending', sent: [], pending: ['Daily Brief 2026-11-06.pdf', 'Daily Brief 2026-11-06 FR.mp3'], retried: { resolved: [], failed: [], abandoned: 0 } });
    expect(r.report.issues).toEqual([{ level: 'warning', message: 'Drive : 2 fichier(s) non déposé(s) (Drive Daily Brief 2026-11-06.pdf : HTTP 500) — mis en attente, retentés au prochain passage' }]);
    expect(await rows(db, 'select date::text as date, files, attempts, last_error from public.drive_pending')).toEqual([
      { date: DAY, files: [pdfFile(DAY), mp3File(DAY, 'fr')], attempts: 1, last_error: 'Drive Daily Brief 2026-11-06 FR.mp3 : HTTP 500' },
    ]);
    expect(await count('editions')).toBe(3);
    const run = await runsRow();
    expect([run.status, run.steps.drive.status, run.steps.drive.errors.length]).toEqual(['degraded', 'pending', 2]);
  });

  it('le lendemain, le dépôt en attente est retenté d’abord, puis soldé', async () => {
    server.state.mode = 'http-500';
    await publish({ audio: ['fr'] });
    server.state.mode = 'ok';
    const next = await publish({ date: '2026-11-07' }, { now: new Date('2026-11-07T04:45:00Z') });
    expect(next.report.drive).toEqual({ status: 'sent', sent: ['Daily Brief 2026-11-07.pdf'], pending: [], retried: { resolved: [DAY], failed: [], abandoned: 0 } });
    expect(next.report.status).toBe('ok');
    expect(await count('drive_pending')).toBe(0);
    expect(server.google.tree()).toEqual([...TREE, 'Daily Brief/2026/11 - Novembre/Daily Brief 2026-11-06 FR.mp3', 'Daily Brief/2026/11 - Novembre/Daily Brief 2026-11-07.pdf']);
    // Les fichiers retentés viennent de Storage : mêmes octets que ceux publiés la veille.
    const files = server.google.root.folders[0].folders[0].folders[0].files;
    expect([files[0].bytes, files[1].bytes]).toEqual([PDF_BYTES, MP3_BYTES]);
    // L'ordre : la relance précède l'envoi du jour.
    expect(server.hits.filter((h) => h.method === 'POST').slice(-3).map((h) => JSON.parse(h.body).date)).toEqual([DAY, DAY, '2026-11-07']);
  });

  it('relancer une date dont le dépôt était en attente le solde sans passer par la relance', async () => {
    server.state.mode = 'http-500';
    const first = await publish();
    server.state.mode = 'ok';
    const second = await publish({}, { outDir: first.outDir });
    expect(second.report.drive).toMatchObject({ status: 'sent', retried: { resolved: [], failed: [] } });
    expect(await count('drive_pending')).toBe(0);
  });

  it('sans configuration Supabase : code 2, rapport écrit, aucun appel à Supabase', async () => {
    const r = await publish({}, { env: { APPS_SCRIPT_URL: server.url, APPS_SCRIPT_TOKEN: DRIVE_TOKEN } });
    expect(r.exitCode).toBe(2);
    expect(r.report.status).toBe('failed');
    expect(r.report.issues.filter((i) => i.level === 'error').map((i) => i.message)).toEqual([
      'SUPABASE_URL ou SUPABASE_SERVICE_ROLE_KEY absente : rien n’est publié dans Supabase',
      'aucune édition publiée',
    ]);
    expect(r.report.editions.map((e) => e.published)).toEqual([false, false, false]);
    expect(fake.calls).toEqual([]);
    // Le PDF part quand même dans Drive : l'archive ne dépend pas de Supabase.
    expect(r.report.drive.status).toBe('sent');
    expect(server.google.tree()).toEqual(TREE);
    expect(existsSync(join(r.dayDir, 'publish-report.json'))).toBe(true);
  });

  it('sans configuration Drive : avertissement, publication complète, rien en attente', async () => {
    const r = await publish({}, { env: { SUPABASE_URL: FAKE_URL, SUPABASE_SERVICE_ROLE_KEY: FAKE_KEY } });
    expect(r.exitCode).toBe(0);
    expect(r.report.status).toBe('ok');
    expect(r.report.drive.status).toBe('skipped');
    expect(r.report.issues).toEqual([{ level: 'warning', message: 'APPS_SCRIPT_URL ou APPS_SCRIPT_TOKEN absente : dépôt Drive ignoré' }]);
    expect(await count('drive_pending')).toBe(0);
    expect(server.hits).toEqual([]);
  });

  it('URL Apps Script hors de Google : erreur, le jeton n’est envoyé nulle part', async () => {
    const r = await publish({}, { env: { ...env(), APPS_SCRIPT_URL: 'https://exemple.fr/macros/s/x/exec' }, driveHosts: undefined });
    expect(r.exitCode).toBe(0);
    expect(r.report.status).toBe('degraded');
    expect(r.report.issues).toEqual([{ level: 'error', message: 'APPS_SCRIPT_URL invalide : application web Apps Script attendue (https://script.google.com/macros/s/…/exec) : dépôt Drive ignoré' }]);
    expect(server.hits).toEqual([]);
  });

  it('clé Supabase refusée : code 2, Supabase coupé après le premier appel, rien en base', async () => {
    const r = await publish({}, { env: { ...env(), SUPABASE_SERVICE_ROLE_KEY: 'mauvaise-clé-de-service-000000' } });
    expect(r.exitCode).toBe(2);
    expect(r.report.runSaved).toBe(false);
    expect(fake.calls).toHaveLength(1);
    expect(await count('editions')).toBe(0);
    expect(r.report.issues.map((i) => i.message)).toContain('aucune édition publiée');
  });

  it('Supabase muet : interrompu au délai, code 2, jamais bloqué', async () => {
    fake.intercept = () => ({ hang: true });
    const started = Date.now();
    const r = await publish({}, { deadlineMs: 300 });
    expect(Date.now() - started).toBeLessThan(5_000);
    expect(r.exitCode).toBe(2);
    expect(r.reportWritten).toBe(true);
  });

  it('une édition invalide n’empêche pas les autres ; statut dégradé', async () => {
    const { outDir, dayDir } = makeDay();
    writeFileSync(join(dayDir, 'en.final.json'), '{ tronqué');
    const r = await publish({}, { outDir });
    expect(r.exitCode).toBe(0);
    expect(r.report.status).toBe('degraded');
    expect(r.report.editions.map((e) => [e.lang, e.published])).toEqual([
      ['fr', true],
      ['es', true],
    ]);
    expect(r.report.issues).toHaveLength(1);
    expect(r.report.issues[0]).toMatchObject({ level: 'error', lang: 'en' });
    expect((await runsRow()).steps.publish.errors[0]).toMatch(/^EN : en\.final\.json illisible/);
  });

  it('sans render-report.json : code 2, rien n’est envoyé, la ligne runs dit « failed »', async () => {
    const { outDir, dayDir } = makeDay();
    writeFileSync(join(dayDir, 'render-report.json'), '');
    const r = await publish({}, { outDir });
    expect(r.exitCode).toBe(2);
    expect(r.report.issues.map((i) => i.message)).toEqual(['render-report.json illisible : Unexpected end of JSON input', 'render-report.json illisible : étape notée « unreadable » dans runs', 'aucune édition publiée']);
    expect(fake.files.size).toBe(0);
    expect(server.hits).toEqual([]);
    expect((await runsRow()).status).toBe('failed');
  });

  it('PDF refusé par Storage : éditions publiées sans PDF, Drive servi, statut dégradé', async () => {
    fake.intercept = (c) => (c.path.startsWith('/storage/v1/object/pdf/') ? { status: 500, json: {} } : undefined);
    const r = await publish();
    expect(r.exitCode).toBe(0);
    expect(r.report.status).toBe('degraded');
    expect(r.report.files).toEqual([{ name: 'Daily Brief 2026-11-06.pdf', bucket: 'pdf', path: '2026-11-06/daily-brief-2026-11-06.pdf', stored: false }]);
    expect(await rows(db, 'select distinct pdf_path from public.editions')).toEqual([{ pdf_path: null }]);
    expect(r.report.drive.status).toBe('sent');
  });

  it('PDF absent de Storage et Drive en panne : ni déposé ni en attente, c’est une erreur', async () => {
    fake.intercept = (c) => (c.path.startsWith('/storage/v1/object/pdf/') ? { status: 500, json: {} } : undefined);
    server.state.mode = 'http-500';
    const r = await publish();
    expect(r.exitCode).toBe(0);
    expect(r.report.drive).toMatchObject({ status: 'failed', sent: [], pending: [] });
    expect(r.report.issues.at(-1)).toEqual({ level: 'error', message: 'Drive : Daily Brief 2026-11-06.pdf ni déposé(s) ni mis en attente (absent(s) de Supabase Storage)' });
    expect(await count('drive_pending')).toBe(0);
  });

  it('purge les MP3 de plus de 30 jours après une publication réussie', async () => {
    await db.query(`insert into public.editions (date, lang, region, headline, morning_brief, generated_at, audio_path) values ('2026-10-01', 'fr', 'r', 'h', '[]', now(), '2026-10-01/fr.mp3')`);
    fake.files.set('audio/2026-10-01/fr.mp3', { bytes: MP3_BYTES, contentType: 'audio/mpeg' });
    const r = await publish();
    expect(r.report.audioPurged).toBe(1);
    expect(fake.files.has('audio/2026-10-01/fr.mp3')).toBe(false);
  });

  it('date invalide : code 2, aucun fichier écrit', async () => {
    const { outDir } = makeDay();
    const r = await publish({}, { outDir, date: '2026-02-30' });
    expect(r).toMatchObject({ exitCode: 2, reportWritten: false });
    expect(r.report.issues).toEqual([{ level: 'error', message: 'date incorrecte : « 2026-02-30 »' }]);
    expect(existsSync(join(outDir, '2026-02-30'))).toBe(false);
  });

  it('aucun secret dans le rapport, dans runs ni dans drive_pending', async () => {
    // Des erreurs qui citent la clé, le jeton et l'URL de l'application.
    const leakyDrive: HttpFetch = async () => {
      throw new Error(`échec vers ${server.url} avec ${DRIVE_TOKEN}`);
    };
    fake.intercept = (c) => (c.path.endsWith('/audio_expired') ? { status: 400, json: { message: `clé ${FAKE_KEY} citée` } } : undefined);
    const r = await publish({}, { driveFetch: leakyDrive });
    expect(r.exitCode).toBe(0);
    const everything = readFileSync(join(r.dayDir, 'publish-report.json'), 'utf8') + JSON.stringify(await rows(db, 'select * from public.runs')) + JSON.stringify(await rows(db, 'select * from public.drive_pending'));
    for (const secret of [FAKE_KEY, DRIVE_TOKEN, server.url]) expect(everything).not.toContain(secret);
    expect(everything).toContain('échec vers *** avec ***');
    expect(everything).toContain('clé *** citée');
  });
});
```

- [ ] **Étape 2 : vérifier l'échec**

Commande : `npx vitest run pipeline/test/publish/run-publish.test.ts`
Attendu : échec, « Cannot find module '../../publish/run-publish' ».

- [ ] **Étape 3 : écrire l'orchestration**

Fichier `pipeline/publish/run-publish.ts` :

```ts
import { mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import { IsoDateSchema, type Lang } from '@daily-brief/schema';
import { messageOf, type HttpFetch } from '../collect/http';
import { writeAtomic } from '../lib/fs';
import { redactText, stripSecrets } from '../lib/redact';
import { createSupabaseClient, type SupabaseClient, type SupabaseFetch } from '../supabase/client';
import { supabaseConfig } from '../supabase/config';
import { purgeExpiredAudio } from './audio-purge';
import { createDriveClient, driveConfig, MISSING_DRIVE, type DriveClient } from './drive';
import type { DayFile } from './files';
import { loadPublishInputs, type LocalFile, type PublishIssue } from './inputs';
import { queuePending, resolvePending, retryPending } from './retry-pending';
import { capErrors, summarizeReports, type StepSummary } from './run-summary';
import { publishEditions, uploadFiles, type EditionResult } from './supabase';

export type RunPublishOptions = {
  outDir: string;
  date: string;
  /** SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, APPS_SCRIPT_URL, APPS_SCRIPT_TOKEN. */
  env: Record<string, string | undefined>;
  supabaseFetch: SupabaseFetch;
  driveFetch: HttpFetch;
  /** Hôtes permis pour Apps Script (tests : serveur local). */
  driveHosts?: string[];
  /** Délai d'un dépôt Drive (3 min par défaut). */
  driveTimeoutMs?: number;
  /** Échéance globale, en ms (15 min par défaut) : au-delà, tout appel restant est interrompu. */
  deadlineMs?: number;
  now?: Date;
  /** Horloge des durées (ms), remplaçable dans les tests. */
  clock?: () => number;
};

export type DriveStatus = 'sent' | 'pending' | 'failed' | 'skipped';

export type PublishReport = {
  date: string;
  generatedAt: string;
  exitCode: 0 | 2;
  /** `ok` : tout est publié et déposé ; `degraded` : publié, avec un manque ; `failed` : rien de publié. */
  status: 'ok' | 'degraded' | 'failed';
  editions: EditionResult[];
  /** Fichiers du jour et leur sort dans Supabase Storage. */
  files: { name: string; bucket: string; path: string; stored: boolean }[];
  drive: { status: DriveStatus; sent: string[]; pending: string[]; retried: { resolved: string[]; failed: string[]; abandoned: number } };
  audioPurged: number;
  /** Vrai si la ligne `runs` du jour a été écrite. */
  runSaved: boolean;
  durationMs: number;
  issues: PublishIssue[];
};

export type RunPublishResult = { exitCode: 0 | 2; report: PublishReport; /** Faux si publish-report.json n'a pas pu être écrit. */ reportWritten: boolean };

const Ack = z.object({}).loose();

/**
 * `brief:publish` : publie ce que `brief:render` a produit pour `date`.
 *   1. retente les dépôts Drive en attente ;
 *   2. dépose le PDF et les MP3 dans Supabase Storage ;
 *   3. publie chaque édition (une transaction par édition) ;
 *   4. dépose les fichiers dans Drive — en cas d'échec, ils sont mis en attente (`drive_pending`) ;
 *   5. purge les MP3 de plus de 30 jours ;
 *   6. écrit la ligne `runs` du jour, puis `publish-report.json`.
 * Chaque étape est indépendante : un échec devient un problème du rapport, jamais une exception.
 * L'ancien rapport est supprimé d'abord ; le nouveau est toujours écrit, sans aucun secret.
 * Code 0 si au moins une édition est publiée dans Supabase (Drive peut rester en attente), 2 sinon.
 */
export async function runPublish(opts: RunPublishOptions): Promise<RunPublishResult> {
  const now = opts.now ?? new Date();
  const clock = opts.clock ?? Date.now;
  const started = clock();
  const secrets = [opts.env.SUPABASE_SERVICE_ROLE_KEY?.trim(), opts.env.APPS_SCRIPT_TOKEN?.trim(), opts.env.APPS_SCRIPT_URL?.trim()];
  const clean = (m: string) => redactText(m, secrets);
  const report: PublishReport = {
    date: opts.date,
    generatedAt: now.toISOString(),
    exitCode: 2,
    status: 'failed',
    editions: [],
    files: [],
    drive: { status: 'skipped', sent: [], pending: [], retried: { resolved: [], failed: [], abandoned: 0 } },
    audioPurged: 0,
    runSaved: false,
    durationMs: 0,
    issues: [],
  };
  const issue = (level: PublishIssue['level'], message: string, lang?: Lang) => report.issues.push({ level, ...(lang ? { lang } : {}), message: clean(message) });
  const add = (list: PublishIssue[]) => list.forEach((i) => issue(i.level, i.message, i.lang));

  if (!IsoDateSchema.safeParse(opts.date).success) {
    issue('error', `date incorrecte : « ${opts.date} »`);
    return { exitCode: 2, report, reportWritten: false };
  }
  const dayDir = join(opts.outDir, opts.date);
  const reportPath = join(dayDir, 'publish-report.json');
  try {
    mkdirSync(dayDir, { recursive: true });
    rmSync(reportPath, { force: true });
  } catch (e) {
    issue('error', `dossier de sortie inutilisable : ${messageOf(e)}`);
    return { exitCode: 2, report, reportWritten: false };
  }

  const published = () => report.editions.filter((e) => e.published);
  const finish = (): RunPublishResult => {
    report.exitCode = published().length > 0 ? 0 : 2;
    report.durationMs = clock() - started;
    let reportWritten = true;
    try {
      writeAtomic(reportPath, stripSecrets(JSON.stringify(report, null, 2), secrets) + '\n');
    } catch {
      reportWritten = false;
    }
    return { exitCode: report.exitCode, report, reportWritten };
  };

  const global = AbortSignal.timeout(opts.deadlineMs ?? 15 * 60_000);
  let client: SupabaseClient | null = null;
  let summary: ReturnType<typeof summarizeReports> | null = null;
  const driveErrors: string[] = [];
  try {
    const inputs = loadPublishInputs(dayDir, opts.date);
    add(inputs.issues);
    summary = summarizeReports(dayDir, opts.date);
    add(summary.issues);
    const local: LocalFile[] = [...(inputs.pdf ? [inputs.pdf] : []), ...inputs.audio];

    const sb = supabaseConfig(opts.env);
    if (sb.ok) client = createSupabaseClient(sb.config, opts.supabaseFetch, { signal: global });
    else issue('error', `${sb.error} : rien n’est publié dans Supabase`);

    let drive: DriveClient | null = null;
    const dr = driveConfig(opts.env, opts.driveHosts);
    if (dr.ok) drive = createDriveClient(dr.config, opts.driveFetch, { signal: global, hosts: opts.driveHosts, timeoutMs: opts.driveTimeoutMs });
    else issue(dr.error === MISSING_DRIVE ? 'warning' : 'error', `${dr.error} : dépôt Drive ignoré`);

    // 1. Dépôts Drive en attente des jours précédents.
    if (client && drive) {
      const retried = await retryPending(client, drive, opts.date);
      report.drive.retried = { resolved: retried.resolved, failed: retried.failed, abandoned: retried.abandoned };
      add(retried.issues);
    }

    // 2. Fichiers dans Supabase Storage, avant les éditions : `publish_edition` écrit leurs chemins.
    let stored: DayFile[] = [];
    if (client && inputs.editions.length > 0) {
      const up = await uploadFiles(client, local);
      stored = up.stored;
      add(up.issues);
    }
    report.files = local.map((f) => ({ name: f.name, bucket: f.bucket, path: f.path, stored: stored.some((s) => s.path === f.path && s.bucket === f.bucket) }));

    // 3. Éditions.
    if (client && inputs.editions.length > 0) {
      const pub = await publishEditions(client, inputs.editions, { stored, light: summary.light, generatedAt: inputs.renderedAt ?? now.toISOString() });
      report.editions = pub.results;
      add(pub.issues);
    } else {
      report.editions = inputs.editions.map((e) => ({ lang: e.lang, published: false, stories: 0, sources: 0, vocab: 0, threadsCreated: 0 }));
    }
    if (published().length === 0) issue('error', 'aucune édition publiée');

    // 4. Drive : un fichier par requête ; ce qui échoue est mis en attente s'il est dans Storage.
    if (drive && local.length > 0) {
      const failed: LocalFile[] = [];
      for (const { bytes, lang: _lang, ...file } of local) {
        try {
          await drive.send(opts.date, file, bytes);
          report.drive.sent.push(file.name);
        } catch (e) {
          driveErrors.push(messageOf(e));
          failed.push({ ...file, bytes });
        }
      }
      if (failed.length === 0) {
        report.drive.status = 'sent';
        if (client) await resolvePending(client, opts.date).catch((e) => issue('warning', `dépôt en attente du ${opts.date} non soldé : ${messageOf(e)}`));
      } else {
        const queueable = failed.filter((f) => stored.some((s) => s.path === f.path && s.bucket === f.bucket)).map(({ bytes: _bytes, lang: _lang, ...f }) => f);
        let queued = false;
        if (client && queueable.length > 0) {
          try {
            await queuePending(client, opts.date, queueable, driveErrors.at(-1) ?? '');
            queued = true;
            report.drive.pending = queueable.map((f) => f.name);
          } catch (e) {
            issue('error', `dépôt Drive non mis en attente : ${messageOf(e)}`);
          }
        }
        report.drive.status = queued ? 'pending' : 'failed';
        const lost = failed.filter((f) => !report.drive.pending.includes(f.name)).map((f) => f.name);
        issue('warning', `Drive : ${failed.length} fichier(s) non déposé(s) (${driveErrors[0]})${queued ? ' — mis en attente, retentés au prochain passage' : ''}`);
        if (lost.length > 0) issue('error', `Drive : ${lost.join(', ')} ni déposé(s) ni mis en attente (absent(s) de Supabase Storage)`);
      }
    }

    // 5. Purge des MP3 de plus de 30 jours (seulement quand la publication du jour a abouti).
    if (client && published().length > 0) {
      const purge = await purgeExpiredAudio(client, opts.date);
      report.audioPurged = purge.removed;
      add(purge.issues);
    }
  } catch (e) {
    // Quoi qu'il arrive, le rapport est écrit : la routine ne doit jamais lire un état périmé.
    issue('error', `erreur inattendue : ${messageOf(e)}`);
  }

  const pdfMissing = !report.files.some((f) => f.bucket === 'pdf' && f.stored);
  report.status = published().length === 0 ? 'failed' : report.issues.some((i) => i.level === 'error') || pdfMissing || report.drive.status === 'pending' || report.drive.status === 'failed' ? 'degraded' : 'ok';

  // 6. Ligne `runs` du jour : bilan de chaque étape, pour la page Santé.
  if (client && summary) {
    const sum = (key: 'stories' | 'sources' | 'vocab' | 'threadsCreated') => report.editions.reduce((n, e) => n + e[key], 0);
    const publishStep: StepSummary = {
      status: report.status,
      finishedAt: now.toISOString(),
      durationMs: clock() - started,
      counters: { editions: published().length, stories: sum('stories'), sources: sum('sources'), vocab: sum('vocab'), threadsCreated: sum('threadsCreated'), files: report.files.filter((f) => f.stored).length, audioPurged: report.audioPurged },
      errors: capErrors(report.issues.filter((i) => i.level === 'error').map((i) => (i.lang ? `${i.lang.toUpperCase()} : ${i.message}` : i.message))),
    };
    const steps = {
      ...summary.steps,
      publish: publishStep,
      drive: {
        status: report.drive.status,
        counters: { sent: report.drive.sent.length, pending: report.drive.pending.length, retriedResolved: report.drive.retried.resolved.length, retriedFailed: report.drive.retried.failed.length, abandoned: report.drive.retried.abandoned },
        errors: capErrors(driveErrors.map(clean)),
      },
    };
    const notes = `${published().length} édition(s) publiée(s) : ${published().map((e) => e.lang.toUpperCase()).join(', ') || 'aucune'} ; Drive : ${report.drive.status}`;
    try {
      await client.rpc('save_run', { p_date: opts.date, p_status: report.status, p_steps: JSON.parse(stripSecrets(JSON.stringify(steps), secrets)), p_notes: notes }, Ack);
      report.runSaved = true;
    } catch (e) {
      issue('warning', `ligne runs non écrite : ${messageOf(e)}`);
    }
  }
  return finish();
}
```

- [ ] **Étape 4 : vérifier le succès**

Commande : `npx vitest run pipeline/test/publish/run-publish.test.ts`
Attendu : `Test Files  1 passed (1)` et `Tests  20 passed (20)`.

Commande : `npm test && npm run typecheck`
Attendu : `Test Files  66 passed (66)`, `Tests  662 passed (662)`, et `tsc` sans sortie.

- [ ] **Étape 5 : commit**

```bash
git add pipeline/publish/run-publish.ts pipeline/test/publish/run-publish.test.ts
git commit -m "feat(publish): orchestration de brief:publish et ligne runs"
```

---

### Tâche 13 : commande `npm run brief:publish`

**Fichiers :**
- Créer : `pipeline/publish/cli.ts`
- Modifier : `package.json` (script), `pipeline/test/run-cli.ts` (variables Apps Script retirées des CLI testés)
- Test : `pipeline/test/publish/cli.test.ts`

Comportement attendu :
- **Variables.** Le CLI charge `.env` par `loadEnv`, qui retire d'abord les variables blanches, et une variable du processus l'emporte sur `.env`.
- **Sortie.** Il affiche les problèmes, l'état de chaque édition et celui de Drive, puis sort avec le code du rapport.
- **Sans configuration.** Code 2 et rapport écrit. Supabase injoignable : code 2, aucun secret affiché ni écrit. Une erreur de haut niveau, comme une option inconnue, ne cite aucun secret.
- **Script npm.** `npm run brief:publish` pointe sur ce CLI.

- [ ] **Étape 1 : écrire les tests et protéger les CLI testés**

Fichier `pipeline/test/publish/cli.test.ts` :

```ts
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { runCli } from '../run-cli';
import { DAY, makeDay } from './day';

const SERVICE_KEY = 'clé-de-service-de-test-0123456789';
const DRIVE_TOKEN = 'jeton-drive-de-test-0123456789-abcdef';
/** Port 9 (discard) de la machine locale : connexion refusée, aucun appel hors de la machine. */
const UNREACHABLE = 'http://127.0.0.1:9';

/** Lance le CLI sur un dossier du jour préparé (`--out` absolu : le CLI tourne dans un dossier vide). */
function publishCli(env: Record<string, string> = {}, files?: Record<string, string>) {
  const { outDir, dayDir } = makeDay();
  const r = runCli('pipeline/publish/cli.ts', ['--date', DAY, '--out', outDir], env, { files });
  return { ...r, dayDir };
}

describe('CLI brief:publish', () => {
  it('sans configuration : code 2, rapport écrit, messages lisibles', () => {
    const r = publishCli();
    expect(r.status).toBe(2);
    expect(r.stdout).toBe(
      'brief:publish 2026-11-06\n' +
        '[error] SUPABASE_URL ou SUPABASE_SERVICE_ROLE_KEY absente : rien n’est publié dans Supabase\n' +
        '[warning] APPS_SCRIPT_URL ou APPS_SCRIPT_TOKEN absente : dépôt Drive ignoré\n' +
        '[error] aucune édition publiée\n' +
        'FR : non publiée\n' +
        'EN : non publiée\n' +
        'ES : non publiée\n' +
        'Drive : skipped\n' +
        'Erreur : aucune édition publiée.\n',
    );
    const report = JSON.parse(readFileSync(join(r.dayDir, 'publish-report.json'), 'utf8'));
    expect([report.exitCode, report.status, report.runSaved]).toEqual([2, 'failed', false]);
  }, 30_000);

  it('Supabase injoignable : code 2, et aucun secret n’est affiché ni écrit', () => {
    const r = publishCli({ SUPABASE_URL: UNREACHABLE, SUPABASE_SERVICE_ROLE_KEY: `  ${SERVICE_KEY}  `, APPS_SCRIPT_URL: 'https://exemple.fr/exec', APPS_SCRIPT_TOKEN: DRIVE_TOKEN });
    expect(r.status).toBe(2);
    expect(r.stdout).toContain('[error] APPS_SCRIPT_URL invalide : application web Apps Script attendue');
    expect(r.stdout).toContain('[error] FR édition non publiée : Supabase publish_edition : ');
    expect(r.stdout).toContain('Erreur : aucune édition publiée.');
    const everything = r.stdout + r.stderr + readFileSync(join(r.dayDir, 'publish-report.json'), 'utf8');
    for (const secret of [SERVICE_KEY, DRIVE_TOKEN]) expect(everything).not.toContain(secret);
  }, 30_000);

  it('lit les variables dans .env, sans écraser celles du processus ; une variable blanche compte pour absente', () => {
    const dotenv = `SUPABASE_URL=${UNREACHABLE}\nSUPABASE_SERVICE_ROLE_KEY=${SERVICE_KEY}\n`;
    const fromFile = publishCli({ SUPABASE_URL: '   ' }, { '.env': dotenv });
    expect(fromFile.stdout).toContain('Supabase publish_edition : ');
    expect(fromFile.stdout).not.toContain('SUPABASE_URL ou SUPABASE_SERVICE_ROLE_KEY absente');
    const processWins = publishCli({ SUPABASE_URL: 'http://projet.supabase.co' }, { '.env': dotenv });
    expect(processWins.stdout).toContain('[error] SUPABASE_URL invalide : https obligatoire (http seulement pour localhost) : rien n’est publié dans Supabase');
  }, 60_000);

  it('date invalide : code 2', () => {
    const r = runCli('pipeline/publish/cli.ts', ['--date', '2026-02-30']);
    expect(r.status).toBe(2);
    expect(r.stdout).toContain('[error] date incorrecte : « 2026-02-30 »');
    expect(existsSync(join(r.cwd, 'out'))).toBe(false);
  }, 30_000);

  it('un message d’erreur de haut niveau ne cite aucun secret', () => {
    const r = runCli('pipeline/publish/cli.ts', [`--${SERVICE_KEY}`], { SUPABASE_URL: UNREACHABLE, SUPABASE_SERVICE_ROLE_KEY: SERVICE_KEY, APPS_SCRIPT_TOKEN: DRIVE_TOKEN });
    expect(r.status).toBe(2);
    expect(r.stderr).toContain('brief:publish :');
    expect(r.stderr).not.toContain(SERVICE_KEY);
  }, 30_000);

  it('le script npm brief:publish pointe sur ce CLI', () => {
    const pkg = JSON.parse(readFileSync(new URL('../../../package.json', import.meta.url), 'utf8'));
    expect(pkg.scripts['brief:publish']).toBe('tsx pipeline/publish/cli.ts');
  });
});
```

Dans `pipeline/test/run-cli.ts`, remplacer :

```ts
/** Variables jamais transmises aux CLI testés : aucun test ne doit atteindre une vraie API. */
const SECRET_VARS = ['THENEWSAPI_KEY', 'EXA_API_KEY', 'WEBZ_TOKEN', 'PEXELS_API_KEY', 'SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY'];

```

par :

```ts
/** Variables jamais transmises aux CLI testés : aucun test ne doit atteindre une vraie API. */
const SECRET_VARS = ['THENEWSAPI_KEY', 'EXA_API_KEY', 'WEBZ_TOKEN', 'PEXELS_API_KEY', 'SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'APPS_SCRIPT_URL', 'APPS_SCRIPT_TOKEN'];

```

- [ ] **Étape 2 : vérifier l'échec**

Commande : `npx vitest run pipeline/test/publish/cli.test.ts`
Attendu : échec, « Tests  6 failed (6) ».

- [ ] **Étape 3 : écrire le CLI et le script npm**

Fichier `pipeline/publish/cli.ts` :

```ts
import { parseArgs } from 'node:util';
import type { HttpFetch } from '../collect/http';
import { parisToday } from '../lib/date';
import { loadEnv } from '../lib/env';
import { redactText } from '../lib/redact';
import type { SupabaseFetch } from '../supabase/client';
import { runPublish } from './run-publish';

const SECRET_ENV = ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'APPS_SCRIPT_URL', 'APPS_SCRIPT_TOKEN'];

try {
  loadEnv(SECRET_ENV);
  const { values } = parseArgs({ options: { date: { type: 'string' }, out: { type: 'string', default: 'out' } } });
  const date = values.date ?? parisToday();
  const env = Object.fromEntries(SECRET_ENV.map((n) => [n, process.env[n]]));
  const { exitCode, report, reportWritten } = await runPublish({ outDir: values.out!, date, env, supabaseFetch: fetch as SupabaseFetch, driveFetch: fetch as HttpFetch });
  console.log(`brief:publish ${date}`);
  for (const i of report.issues) console.log(`[${i.level}]${i.lang ? ' ' + i.lang.toUpperCase() : ''} ${i.message}`);
  for (const e of report.editions) console.log(`${e.lang.toUpperCase()} : ${e.published ? `publiée (${e.stories} sujets, ${e.sources} sources, ${e.vocab} mots)` : 'non publiée'}`);
  console.log(`Drive : ${report.drive.status}${report.drive.pending.length ? ` (${report.drive.pending.length} fichier(s) en attente)` : ''}`);
  if (!reportWritten) console.error('brief:publish : publish-report.json n’a pas pu être écrit.');
  console.log(exitCode === 0 ? `Publication ${report.status === 'ok' ? 'complète' : 'dégradée'} : ${report.editions.filter((e) => e.published).length} édition(s) dans Supabase.` : 'Erreur : aucune édition publiée.');
  process.exit(exitCode);
} catch (e) {
  console.error(`brief:publish : ${redactText(e instanceof Error ? e.message : String(e), [process.env.SUPABASE_SERVICE_ROLE_KEY, process.env.APPS_SCRIPT_TOKEN, process.env.APPS_SCRIPT_URL].map((s) => s?.trim()))}`);
  process.exit(2);
}
```

Dans `package.json`, remplacer :

```json
    "brief:render": "tsx pipeline/render/cli.ts",
```

par :

```json
    "brief:render": "tsx pipeline/render/cli.ts",
    "brief:publish": "tsx pipeline/publish/cli.ts",
```

- [ ] **Étape 4 : vérifier le succès**

Commande : `npx vitest run pipeline/test/publish/cli.test.ts`
Attendu : `Test Files  1 passed (1)` et `Tests  6 passed (6)`.

Commande : `npm test && npm run typecheck`
Attendu : `Test Files  67 passed (67)`, `Tests  668 passed (668)`, et `tsc` sans sortie.

- [ ] **Étape 5 : commit**

```bash
git add pipeline/publish/cli.ts package.json pipeline/test/run-cli.ts pipeline/test/publish/cli.test.ts
git commit -m "feat(publish): commande npm run brief:publish"
```

---

### Tâche 14 : documentation, mise en place et consignes

**Fichiers :**
- Créer : `docs/setup-supabase.md`
- Modifier : `README.md`, `docs/superpowers/plans/2026-11-06-phase-1-roadmap.md` (consignes issues du lot 4)

- [ ] **Étape 1 : écrire le guide de mise en place**

Le guide suit le §14 de la spec : projet en `eu-west-3`, migrations dans l'ordre, email autorisé, réglages d'authentification, secrets dans Vault, déploiement d'Apps Script, premier essai, et la liste des contrôles à faire sur le vrai projet.

Fichier `docs/setup-supabase.md` :

````markdown
# Mise en place de Supabase et du dépôt Drive

Ce guide met en service la base du Daily Brief (spec §6.2, §6.3, §10 et §14). Il se suit une seule fois, en 20 minutes environ. Rien ici n'est fait par les tests : ils tournent sur un Postgres embarqué et n'appellent jamais un vrai projet.

Deux règles valent pour tout le guide :

- **Aucun secret dans une conversation, un prompt, un commit ou un ticket.** Les secrets se saisissent dans le tableau de bord Supabase (Vault) et dans les propriétés du script Apps Script, nulle part ailleurs.
- **Le fichier `.env` reste local** (il est dans `.gitignore`). La routine le recrée à chaque passage à partir de Vault.

## 1. Créer le projet

1. Dans Supabase, créer un projet nommé `daily-brief`, région **West EU (Paris)**, identifiant `eu-west-3`. Claude peut le créer par le connecteur Supabase, après ta confirmation ; sinon, crée-le dans le tableau de bord.
2. Noter l'URL du projet : `https://<référence>.supabase.co`. Ce n'est pas un secret.

Le plan gratuit suffit. Un projet gratuit se met en pause après une semaine sans activité : la publication quotidienne l'évite.

## 2. Appliquer les migrations

Les migrations sont dans `supabase/migrations/` et s'appliquent **dans l'ordre de leur nom** :

| Fichier | Contenu |
|---|---|
| `0001_init.sql` | Tables du §6.2, buckets privés `audio` et `pdf`, RLS, email autorisé |
| `0002_context_runs.sql` | Fonctions de `brief:context` (fermeture R12, Threads ouverts, sujets de la veille) et bilan `runs` |
| `0003_publish.sql` | Fonction `publish_edition` (publication d'une édition en une transaction) |
| `0004_files.sql` | Dépôts Drive en attente et purge des MP3 |

Deux façons de faire :

- **Par le connecteur Supabase** : demander à Claude d'appliquer chaque fichier, un par un, avec l'outil de migration du connecteur.
- **À la main** : dans le tableau de bord, ouvrir *SQL Editor*, coller le contenu de `0001_init.sql`, exécuter, puis recommencer avec les trois autres.

Chaque fichier est rejouable : l'exécuter deux fois ne casse rien et ne remet pas l'email autorisé à sa valeur par défaut.

Les migrations n'ont besoin d'aucune extension. En particulier, **elles n'utilisent pas pg_cron** : la purge des MP3 de plus de 30 jours est faite par `brief:publish` avec l'API Storage, parce que supprimer une ligne de `storage.objects` en SQL laisserait le fichier orphelin dans le bucket.

### Vérifier

Dans *SQL Editor* :

```sql
select count(*) from information_schema.tables
where table_schema = 'public'
  and table_name in ('editions','stories','sources','threads','thread_events','vocab_items','runs','drive_pending');
-- attendu : 8

select id, public from storage.buckets where id in ('audio', 'pdf');
-- attendu : deux lignes, public = false

select public.context_open_threads();
-- attendu : []
```

Puis, dans *Advisors* (Security), vérifier qu'aucune table de `public` n'est signalée sans RLS.

## 3. Régler l'email autorisé

Une seule adresse peut lire le brief. Elle est rangée dans la table `private.app_settings`, que l'API n'expose pas. La valeur par défaut est `nanigeek@gmail.com`. Pour la changer, dans *SQL Editor* :

```sql
update private.app_settings set value = 'autre.adresse@exemple.fr' where key = 'allowed_email';
```

Le changement prend effet aussitôt, sans redéploiement. La comparaison ignore la casse et les espaces. L'application (lot 6) aura aussi une variable `ALLOWED_EMAIL` pour son écran de connexion ; **les deux doivent porter la même adresse**, et c'est celle de la base qui protège les données.

### Réglages d'authentification

Dans *Authentication* :

1. *Sign In / Providers* → *Email* : activé, avec **Confirm email** activé. La lecture repose sur l'email du jeton : il doit être vérifié.
2. Se connecter une première fois à l'application avec l'adresse autorisée (lot 6), puis **désactiver « Allow new users to sign up »**. Personne d'autre ne peut alors créer de compte.
3. Ne pas activer de fournisseur qui laisserait un tiers choisir librement son adresse sans la prouver.

## 4. Ranger les secrets dans Vault

Dans le tableau de bord : *Project Settings* → *Vault* → *Add new secret*. Le **nom** de chaque secret est exactement celui du tableau ; la valeur se colle dans le champ prévu.

| Nom | Valeur | Utilisé par |
|---|---|---|
| `SUPABASE_SERVICE_ROLE_KEY` | Clé de service du projet (*Project Settings* → *API Keys* : clé `service_role`, ou clé secrète `sb_secret_…`) | `brief:context`, `brief:publish` |
| `APPS_SCRIPT_URL` | URL de l'application web Apps Script (§5 ci-dessous), qui finit par `/exec` | `brief:publish` |
| `APPS_SCRIPT_TOKEN` | Le jeton choisi au §5 | `brief:publish` |
| `THENEWSAPI_KEY`, `EXA_API_KEY`, `WEBZ_TOKEN` | Clés de collecte | `brief:collect` |
| `PEXELS_API_KEY` | Clé Pexels | `brief:render` |
| `GOOGLE_TTS_API_KEY` | Clé Text-to-Speech | lot 5 |

La clé de service contourne la RLS : elle ne doit jamais se retrouver dans l'application web, dans Vercel ni dans le dépôt. L'application n'utilise que la clé publique (`anon` ou `sb_publishable_…`).

`SUPABASE_URL` n'est pas un secret : la routine l'écrit dans `.env` avec l'URL du projet. La procédure qui lit Vault (`vault.decrypted_secrets`) et écrit `.env` sans rien afficher arrive au lot 7.

Pour un essai à la main, depuis la racine du dépôt, créer `.env` :

```bash
SUPABASE_URL=https://<référence>.supabase.co
SUPABASE_SERVICE_ROLE_KEY=<clé de service>
APPS_SCRIPT_URL=https://script.google.com/macros/s/<identifiant>/exec
APPS_SCRIPT_TOKEN=<jeton>
```

## 5. Déployer Apps Script (dépôt dans Drive)

`apps-script/Code.gs` reçoit le PDF et les MP3 et les range dans `Daily Brief/AAAA/MM - Mois` (par exemple `Daily Brief/2026/11 - Novembre`).

1. Ouvrir <https://script.google.com> avec le compte Google dont le Drive recevra les fichiers, puis *Nouveau projet*. Le nommer `Daily Brief — dépôt Drive`.
2. Remplacer tout le contenu de `Code.gs` par celui de `apps-script/Code.gs` du dépôt. Enregistrer.
3. Choisir un jeton : une chaîne aléatoire d'**au moins 32 caractères** (le script refuse tout jeton plus court). Par exemple, dans un terminal : `openssl rand -hex 32`. Ne pas le copier ailleurs que dans les deux endroits ci-dessous.
4. *Paramètres du projet* (roue dentée) → *Propriétés du script* → *Ajouter une propriété du script* : nom `TOKEN`, valeur le jeton. Enregistrer.
5. *Déployer* → *Nouveau déploiement* → type **Application web**, avec :
   - *Exécuter en tant que* : **Moi** ;
   - *Qui a accès* : **Tout le monde**.
6. Autoriser le script quand Google le demande : il a besoin d'accéder à Drive. L'avertissement « application non validée » est normal pour un script personnel (*Paramètres avancés* → *Accéder au projet*).
7. Copier l'**URL de l'application web** (elle finit par `/exec`) dans Vault sous `APPS_SCRIPT_URL`, et le jeton sous `APPS_SCRIPT_TOKEN`.

« Tout le monde » signifie que l'URL répond sans connexion Google ; c'est le jeton qui protège le dépôt. Le script ne fait rien sans le bon jeton, n'accepte que des fichiers nommés `Daily Brief AAAA-MM-JJ.pdf` ou `Daily Brief AAAA-MM-JJ FR|EN|ES.mp3`, et ne renvoie jamais le jeton.

**Après toute modification de `Code.gs`**, il faut republier : *Déployer* → *Gérer les déploiements* → crayon → *Version : Nouvelle version* → *Déployer*. L'URL ne change pas. Un *nouveau* déploiement, lui, changerait l'URL.

Le script mémorise l'identifiant du dossier `Daily Brief` dans la propriété `ROOT_FOLDER_ID`. Si le dossier est déplacé, il reste suivi ; s'il est mis à la corbeille, le script en retrouve un du même nom à la racine de Mon Drive, sinon il le recrée.

## 6. Premier essai

Avec `.env` rempli (§4), sur une date déjà rendue par `brief:render` :

```bash
npm run brief:context -- --date AAAA-MM-JJ
npm run brief:publish -- --date AAAA-MM-JJ
```

Attendu : `brief:context` sort avec le code 0 et le store `supabase` ; `brief:publish` affiche `Publication complète : 3 édition(s) dans Supabase.` et `Drive : sent`. Le détail est dans `out/AAAA-MM-JJ/publish-report.json`.

Relancer `brief:publish` sur la même date ne crée aucun doublon : mêmes lignes en base, et dans Drive l'ancien fichier part à la corbeille.

## 7. À contrôler sur le vrai projet

Ces points ne peuvent pas être vérifiés hors ligne. Ils sont à cocher au premier essai.

- [ ] **Clé de service.** `brief:context` répond avec le code 0. Si la clé est une clé secrète `sb_secret_…` et que l'appel reçoit un 401, utiliser la clé `service_role` historique (JWT) : le pipeline envoie la même clé dans les en-têtes `apikey` et `Authorization`.
- [ ] **RLS avec un vrai jeton.** Connecté à l'application avec l'adresse autorisée, le brief s'affiche ; avec une autre adresse, tout est vide. Sans connexion, l'API REST répond par une erreur de droits.
- [ ] **Cases à cocher.** Cocher un mot et suivre un Thread dans l'application fonctionne ; toute autre écriture est refusée.
- [ ] **Buckets.** Le dépôt du PDF et d'un MP3 réussit ; les colonnes `file_size_limit` et `allowed_mime_types` des buckets sont bien celles de la migration.
- [ ] **Fichier absent.** Le code HTTP que Storage renvoie pour un fichier absent (400 ou 404) est bien traité comme « absent » par la relance des dépôts en attente.
- [ ] **Purge.** Après 31 jours, les MP3 anciens disparaissent du bucket `audio` et `editions.audio_path` est vide pour ces dates.
- [ ] **Apps Script.** Le POST reçoit bien une redirection 302 vers `script.googleusercontent.com`, et un PDF réel de quelques Mo passe en moins de 3 minutes.
- [ ] **Fuseau.** `select (now() at time zone 'Europe/Paris')::date;` renvoie la date de Paris.
- [ ] **Version de Postgres.** Les tests tournent sur Postgres 18 (PGlite) ; le projet hébergé peut être en version 15 ou 17. Les migrations n'utilisent que du SQL courant, mais c'est leur application réelle qui fait foi.
````

- [ ] **Étape 2 : compléter le README**

Dans `README.md`, remplacer :

```markdown
npm run schema:emit    # régénère packages/schema/edition.schema.json
npm run brief:context -- --date AAAA-MM-JJ [--out out]
npm run brief:collect -- --date AAAA-MM-JJ [--out out]
```

par :

```markdown
npm run schema:emit    # régénère packages/schema/edition.schema.json
npm run brief:context -- --date AAAA-MM-JJ [--out out] [--allow-empty]
npm run brief:collect -- --date AAAA-MM-JJ [--out out]
```

Dans `README.md`, remplacer :

```markdown
npm run brief:render -- --date AAAA-MM-JJ [--out out]
npm run maps:preview   # aperçu des cartes de la fixture (out/maps-preview.html)
```

par :

```markdown
npm run brief:render -- --date AAAA-MM-JJ [--out out]
npm run brief:publish -- --date AAAA-MM-JJ [--out out]
npm run maps:preview   # aperçu des cartes de la fixture (out/maps-preview.html)
```

Dans `README.md`, remplacer :

```markdown

`brief:context` ferme les Threads sans événement depuis 21 jours (R12), puis écrit `out/<date>/context.json` (Threads ouverts et sujets de la veille) et `context-report.json`. Tant que le store Supabase n'existe pas (lot 4), il écrit un contexte vide avec un avertissement. Une erreur ou un délai dépassé du store donne le code 2, sans `context.json`.

```

par :

```markdown

`brief:context` ferme les Threads sans événement depuis 21 jours (R12), puis écrit `out/<date>/context.json` (Threads ouverts et sujets de la veille) et `context-report.json`. Il lit Supabase avec `SUPABASE_URL` et `SUPABASE_SERVICE_ROLE_KEY` (environnement ou `.env`). Sans ces variables, il sort avec le code 2 ; l'option `--allow-empty`, réservée au développement local, écrit alors un contexte vide avec un avertissement. Une URL invalide, une erreur ou un délai dépassé du store donne le code 2, sans `context.json`. Les Threads fermés sont notés dans la table `runs` (`steps.closedThreads`), pour qu'une relance ne les perde pas.

```

Dans `README.md`, remplacer :

```markdown

`context.json`, `raw.json` et `newsletters/` sont facultatifs. Sans textes sources, toutes les citations et tous les chiffres sont retirés.
```

par :

```markdown

`brief:publish` publie ce que `brief:render` a produit, dans cet ordre :

1. il retente les dépôts Drive en attente des jours précédents (au plus 5 par passage, 5 tentatives par dépôt) ;
2. il dépose le PDF et les MP3 présents dans Supabase Storage (buckets privés `pdf` et `audio`) ;
3. il publie chaque édition listée dans `finals` de `render-report.json`, par un appel à la fonction SQL `publish_edition` : une transaction par édition, donc jamais d'édition à moitié écrite ;
4. il dépose les fichiers dans Google Drive par l'application web Apps Script (`apps-script/Code.gs`), un fichier par requête ; en cas d'échec, les fichiers vont dans la table `drive_pending` ;
5. il supprime les MP3 de plus de 30 jours ;
6. il écrit la ligne `runs` du jour (bilan de chaque étape, d'après les rapports `context`, `collect`, `verify` et `render`), puis `publish-report.json`.

Relancer une date remplace proprement ses données : mêmes éditions, sujets, sources et fichiers, sans doublon. Les mots cochés (`vocab_items.selected`, `anki_status`) et les Threads suivis (`threads.followed`) sont conservés. Variables : `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `APPS_SCRIPT_URL` et `APPS_SCRIPT_TOKEN` (environnement ou `.env`) ; aucune n'apparaît dans un message ni dans un rapport. Sans les variables Apps Script, le dépôt Drive est ignoré avec un avertissement. Codes de sortie de `brief:publish` :

- **0** : au moins une édition est publiée dans Supabase. Le champ `status` de `publish-report.json` vaut `ok`, ou `degraded` s'il manque quelque chose (une édition, le PDF, ou Drive en attente).
- **2** : aucune édition publiée (configuration Supabase absente ou refusée, rien à publier, date incorrecte). Le PDF est quand même envoyé à Drive quand c'est possible.

La base est décrite par `supabase/migrations/` : tables et RLS (`0001_init.sql`), puis les fonctions appelées par le pipeline. Les tests appliquent ces migrations à un Postgres embarqué (PGlite), avec les rôles `anon`, `authenticated` et `service_role` simulés par `pipeline/test/supabase/prelude.sql` : aucun test n'appelle Supabase, Google ni le réseau. Mise en place du projet réel : `docs/setup-supabase.md`.

`context.json`, `raw.json` et `newsletters/` sont facultatifs. Sans textes sources, toutes les citations et tous les chiffres sont retirés.
```

- [ ] **Étape 3 : ajouter les consignes issues du lot 4 à la feuille de route**

Dans `docs/superpowers/plans/2026-11-06-phase-1-roadmap.md`, remplacer :

```markdown
  - **Groupes de titres.** Au-delà de 25 membres, le regroupement par titre ne rattache plus d'article au groupe : les suivants forment des groupes d'un seul article. Le prompt de rédaction doit savoir qu'un même événement peut alors apparaître sous plusieurs `groupId`.
```

par :

```markdown
  - **Groupes de titres.** Au-delà de 25 membres, le regroupement par titre ne rattache plus d'article au groupe : les suivants forment des groupes d'un seul article. Le prompt de rédaction doit savoir qu'un même événement peut alors apparaître sous plusieurs `groupId`.

### Consignes issues du lot 4

- **Lot 5 (audio)** : écrire chaque MP3 dans `out/<date>/` sous le nom `Daily Brief AAAA-MM-JJ FR.mp3` (et `EN`, `ES`), **avant** `brief:publish`. La publication les dépose dans le bucket `audio` au chemin `AAAA-MM-JJ/<langue>.mp3` et remplit `editions.audio_path` ; sans MP3, l'édition est publiée sans lecteur. Un MP3 doit commencer par une étiquette ID3 ou une trame MP3 et peser moins de 15 Mo, sinon il est écarté avec un avertissement. Supprimer d'abord les anciens MP3 du dossier du jour : la publication prend tout MP3 présent pour une édition publiable.
- **Lot 6 (appli)** :
  - **Lecture.** Tout passe par la clé publique et la session de l'utilisateur ; la RLS ne laisse lire que l'adresse de `private.app_settings` (`allowed_email`). `ALLOWED_EMAIL` côté Vercel doit porter la même adresse.
  - **Écriture.** L'utilisateur ne peut modifier que `vocab_items.selected`, `vocab_items.anki_status` et `threads.followed` : un `update` qui nomme une autre colonne est refusé. Le bouton « Ajouter N mots à Anki » passe `anki_status` à `queued`.
  - **Forme des données.** Les rubriques d'une édition et leur ordre sont dans `editions.sections` (`[{ key, title }]`). Les sujets se trient par `stories.position` ; les brèves sont les `sources` dont `story_id` est nul, par `rubric` puis `position`. `morning_brief[].storyId` désigne `stories.key`. Le sous-titre du Thread d'un sujet est `stories.thread_subtitle`.
  - **Fichiers.** `editions.pdf_path` et `editions.audio_path` sont des chemins dans les buckets privés `pdf` et `audio` : créer une URL signée avec la session de l'utilisateur. Un `audio_path` nul signifie « pas de lecteur » (audio en échec, ou MP3 purgé après 30 jours).
  - **Bandeaux.** `editions.status = 'light'` marque l'édition allégée. La page Santé lit `runs` : `status` (`running`, `ok`, `degraded`, `failed`) et `steps.<étape>` (`status`, `finishedAt`, `durationMs`, `counters`, `errors`), plus `steps.closedThreads`. Une ligne restée à `running` signifie que la publication n'a pas eu lieu.
  - **Types.** Générer les types TypeScript de la base depuis le projet réel une fois les migrations appliquées.
- **Lot 7 (routine)** :
  - **Mise en place.** Suivre `docs/setup-supabase.md` (projet, migrations, email autorisé, Vault, Apps Script), puis cocher sa section 7 au premier passage réel.
  - **Variables.** `.env` doit contenir `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `APPS_SCRIPT_URL` et `APPS_SCRIPT_TOKEN`. Sans les deux premières, `brief:context` et `brief:publish` sortent avec le code 2 (`--allow-empty` de `brief:context` est réservé au développement local).
  - **Codes de sortie.** `brief:publish` code 0 : lire `status` dans `publish-report.json` ; `degraded` se signale dans la notification (« Drive en attente », édition manquante). Code 2 : notifier « Brief incomplet : publication impossible ».
  - **Registre d'usage TheNewsAPI.** Il n'est pas persisté dans Supabase par ce lot : il reste dans `out/thenewsapi-usage.json`. À faire ici seulement si la routine relance la collecte dans un conteneur neuf le même jour.
  - **Routine et connecteur.** Le pipeline n'utilise pas le connecteur Supabase : il appelle l'API REST du projet avec la clé de service. Le connecteur ne sert qu'à lire Vault.
```

- [ ] **Étape 4 : vérification finale**

Commande : `npm test && npm run typecheck`
Attendu : `Test Files  67 passed (67)`, `Tests  668 passed (668)` (463 des lots 1 à 3, plus 205 du lot 4), et `tsc` sans sortie.

Seuls les CLI écrivent dans la console :

Commande : `grep -ln "console\." pipeline/publish/*.ts pipeline/supabase/*.ts pipeline/context/*.ts`
Attendu :

```text
pipeline/publish/cli.ts
pipeline/context/cli.ts
```

- [ ] **Étape 5 : commit**

```bash
git add docs/setup-supabase.md README.md docs/superpowers/plans/2026-11-06-phase-1-roadmap.md
git commit -m "docs: mise en place Supabase et Apps Script, commandes et consignes du lot 4"
```

---

## Couverture du lot (auto-revue)

| Exigence | Tâche |
|---|---|
| §6.2 tables editions, stories, sources, threads, thread_events, vocab_items, runs, drive_pending ; unique `(date, lang)` ; clés étrangères en cascade ; index | 1 |
| §6.2 buckets privés `audio` et `pdf` ; purge des MP3 à 30 jours, sans dépendre de pg_cron | 1, 10, 12 |
| §6.2 RLS : lecture par l'email autorisé seulement, écriture par la clé service, sauf `vocab_items.selected` / `anki_status` et `threads.followed` (droits de colonne) | 1 |
| §6.3 clés lues dans l'environnement ou `.env`, jamais affichées ; guide Vault | 2, 4, 13, 14 |
| §10 `Code.gs` : jeton (temps constant), `Daily Brief/AAAA/MM - Mois` en français, id racine mémorisé, remplacement (corbeille puis recréation), `{ ok, ids }` | 8 |
| §10 client Drive : base64, 302 suivi à la main, réponse validée, `drive_pending`, `retry-pending.ts` | 9, 10, 12 |
| §12 Drive en échec → `drive_pending` ; upsert `(date, lang)` et remplacement des fichiers à la relance ; chaque étape dans `runs` | 7, 10, 12 |
| §12 édition allégée (`light`) recopiée de la collecte dans `runs` et `editions.status` | 11, 12 |
| §14 mise en place : projet Paris, migrations, email, Vault, Apps Script (« exécuter en tant que moi », accès « tout le monde », propriété `TOKEN`) | 14 |
| Lot 3 : `ContextStore` Supabase, fermeture atomique notée dans `runs`, `updated_at` ISO, `AbortSignal`, `anomalies()`, `thread_events.date` en `date`, code 2 sans clés, `--allow-empty` | 1, 3, 4 |
| Lot 2 : la publication s'appuie sur `finals` de `render-report.json` ; fichiers contrôlés contre leur nom et leur date | 6 |
| Publication atomique d'une édition (`publish_edition`) ; relance idempotente ; mots cochés et Threads suivis conservés | 7 |
| Threads : id présent = existant ; absent = nouveau Thread avec un slug | 5, 7 |
| `brief:publish` : ordre des étapes, codes 0 / 2, statut `degraded`, rapport toujours écrit et atomique | 12, 13 |
| Secrets masqués (clé de service, jeton et URL Apps Script), testés | 2, 9, 12, 13 |
| Optionnel : registre TheNewsAPI dans Supabase | non retenu (décision 11), reporté au lot 7 |
| Hors lot : appli (lot 6), audio (lot 5), lecture de Vault par la routine (lot 7) | — |

## Ce qui n'a pas pu être vérifié hors ligne

Ces points sont repris, à cocher, dans la section 7 de `docs/setup-supabase.md`.

- **PostgREST.** Le faux Supabase appelle les fonctions SQL comme le ferait PostgREST (arguments nommés, transaction par appel, rôle `service_role`). Il ne vérifie pas :
  - la résolution réelle de `POST /rest/v1/rpc/<fn>` (arguments `p_*`, fonctions sans argument) ;
  - les codes d'erreur exacts (le faux renvoie 400 avec le code Postgres) ;
  - que PostgREST ouvre une transaction en écriture pour `publish_edition`, `close_stale_threads` et `save_run`, et en lecture seule pour les fonctions `stable`.
- **Clés de Supabase.** La clé `service_role` historique (JWT) et la nouvelle clé secrète `sb_secret_…` ne se comportent peut-être pas pareil quand elles sont envoyées à la fois dans `apikey` et `Authorization: Bearer`.
- **API Storage.** Plusieurs comportements restent à confirmer :
  - le code renvoyé pour un objet absent (400 ou 404, les deux sont traités comme absents) ;
  - le corps de `DELETE /storage/v1/object/<bucket>` (`{ prefixes }`) ;
  - le remplacement par `x-upsert: true` ;
  - les limites `file_size_limit` et `allowed_mime_types` posées en SQL sur `storage.buckets`.
- **RLS avec un vrai jeton.** Il faut confirmer que le jeton d'une session Supabase Auth porte bien `email` dans `auth.jwt()`, ce que simule le prélude. La politique sur `storage.objects` et les URL signées ne sont vérifiées qu'avec le schéma `storage` réduit du prélude.
- **Version de Postgres.** PGlite est un Postgres 18, alors que le projet hébergé peut être en 15 ou 17. Les migrations n'utilisent que du SQL courant (`hashtextextended`, `jsonb_*`, `gen_random_uuid`, CTE avec `UPDATE`), mais c'est leur application au vrai projet qui fait foi.
- **Droits par défaut de Supabase.** Le prélude les imite (tout accordé à `anon` et `authenticated`) ; la migration les retire, mais l'*Advisor* de sécurité du vrai projet doit le confirmer.
- **Apps Script.** Rien n'a tourné sur Google. Plusieurs points restent à confirmer :
  - la redirection 302 réelle vers `script.googleusercontent.com` et la lecture par GET ;
  - la taille maximale d'une requête entrante (non documentée) avec un vrai PDF ;
  - la durée d'un dépôt (6 minutes au plus par exécution) ;
  - le comportement de `LockService` ;
  - le message de Google pour une application non publique.
- **Fuseau.** `close_stale_threads` convertit `updated_at` en date de Paris avec `at time zone 'Europe/Paris'`, ce qui suppose les données de fuseau du serveur.
- **Pause du projet gratuit.** La publication quotidienne est supposée suffire à garder le projet actif (spec §15).
