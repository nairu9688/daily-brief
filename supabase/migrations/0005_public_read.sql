-- Daily Brief — lecture publique du contenu (docs/superpowers/plans/2026-11-20-acces-public.md).
-- Le brief se lit sans connexion : n'importe qui, avec la clé publique et sans session (rôle anon),
-- lit les éditions, sujets, sources, Threads, épisodes et mots, et ouvre le MP3 et le PDF par URL signée.
-- Restent réservés à l'utilisateur autorisé (private.is_allowed_user(), 0001) : la page Santé (runs),
-- la file Drive (drive_pending) et les seules écritures permises (vocab_items.selected,
-- vocab_items.anki_status, threads.followed). Rejouable : chaque politique est supprimée puis recréée.

-- ---------------------------------------------------------------------------------------------
-- 1. Tables de contenu : lecture pour tous
-- ---------------------------------------------------------------------------------------------
-- Droit de table entier (pas de droits de colonne) : les colonnes personnelles vocab_items.selected,
-- vocab_items.anki_status et threads.followed sont lisibles aussi. Elles ne disent que les mots cochés
-- et les Threads suivis : sans risque, et PostgREST garde ses `select=*` et ses jointures.
-- Aucun droit d'écriture n'est accordé ici : anon n'a toujours ni insert, ni update, ni delete.

do $$
declare
  t text;
begin
  foreach t in array array['editions', 'stories', 'sources', 'threads', 'thread_events', 'vocab_items']
  loop
    execute format('grant select on public.%I to anon, authenticated', t);
    -- La politique de lecture réservée de 0001 est remplacée par une lecture ouverte.
    execute format('drop policy if exists %I on public.%I', t || '_read', t);
    execute format('drop policy if exists %I on public.%I', t || '_public_read', t);
    execute format(
      'create policy %I on public.%I for select to anon, authenticated using (true)',
      t || '_public_read', t
    );
  end loop;
end
$$;

-- ---------------------------------------------------------------------------------------------
-- 2. runs et drive_pending : toujours réservées à l'utilisateur autorisé
-- ---------------------------------------------------------------------------------------------
-- Rappel explicite de 0001 : aucun droit pour anon, lecture pour authenticated filtrée par
-- private.is_allowed_user() (politiques runs_read et drive_pending_read, inchangées).
revoke all on public.runs, public.drive_pending from public, anon;

-- ---------------------------------------------------------------------------------------------
-- 3. Stockage : fichiers des buckets audio et pdf lisibles pour tous
-- ---------------------------------------------------------------------------------------------
-- Les buckets restent privés (public = false) : pas d'URL publique permanente. L'appli crée une URL
-- signée de 10 minutes avec la clé publique, ce qui demande le droit de lecture de l'objet.
drop policy if exists daily_brief_files_read on storage.objects;
drop policy if exists daily_brief_files_public_read on storage.objects;
create policy daily_brief_files_public_read on storage.objects for select to anon, authenticated
  using (bucket_id in ('audio', 'pdf'));
