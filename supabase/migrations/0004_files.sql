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
-- p_attempts_at_least, s'il est donné, abandonne le dépôt (plus jamais retenté, mais toujours visible).
create or replace function public.drive_pending_fail(p_date date, p_error text, p_files jsonb, p_attempts_at_least integer default null) returns jsonb
language sql security invoker set search_path = ''
as $$
  with upd as (
    update public.drive_pending d
    set attempts = greatest(d.attempts + 1, coalesce(p_attempts_at_least, 0)), last_error = p_error, files = coalesce(p_files, d.files), updated_at = now()
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
    'drive_pending_fail(date, text, jsonb, integer)',
    'audio_expired(date, integer)',
    'audio_clear(jsonb)'
  ]
  loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
    execute format('grant execute on function public.%s to service_role', f);
  end loop;
end
$$;
