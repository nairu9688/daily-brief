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
