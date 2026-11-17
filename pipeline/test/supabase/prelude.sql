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
