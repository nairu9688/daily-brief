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
  if e is null or jsonb_typeof(e) <> 'object' or e ->> 'date' is null or e ->> 'lang' is null
     or e ->> 'date' !~ '^\d{4}-\d{2}-\d{2}$' then
    raise exception 'publish_edition : édition absente ou incomplète' using errcode = '22023';
  end if;
  v_date := (e ->> 'date')::date;
  v_lang := e ->> 'lang';
  -- Deux publications simultanées de la même édition s'exécutent l'une après l'autre.
  perform pg_advisory_xact_lock(hashtextextended('publish_edition:' || v_date::text || ':' || v_lang, 0));
  -- Deux dates de la même langue publiées en même temps pourraient créer le même slug de Thread :
  -- second verrou, toujours pris après le premier (ordre constant, donc pas d'interblocage).
  perform pg_advisory_xact_lock(hashtextextended('threads:' || v_lang, 0));

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
          -- Le slug est pris par un Thread fermé (ou d'une autre langue) : on reprend le Thread daté
          -- ouvert le plus récent s'il existe, sinon nouveau Thread daté.
          select th.id into v_thread from public.threads th
          where th.lang = v_lang and th.status = 'open'
            and th.slug like replace(replace(replace(v_slug, '\', '\\'), '%', '\%'), '_', '\_') || '-____-__-__'
          order by th.created_at desc, th.slug desc limit 1;
        end if;
        if v_thread is null then
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

  -- Un Thread dont les seuls événements venaient de cette édition (donc créé par elle) et qui est
  -- resté sans événement disparaît, sauf s'il est suivi : un Thread suivi n'est jamais supprimé.
  delete from public.threads th
  where th.id = any (v_old_threads)
    and not th.followed
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
