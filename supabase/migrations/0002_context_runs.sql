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
