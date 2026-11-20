# Accès public : lecture sans connexion, connexion facultative

**Décision (20/11/2026).** Le Daily Brief devient public en lecture. N'importe qui, sans session, lit le Brief, les éditions archivées, les Threads (liste et frise), le Vocab et l'Archive, écoute le MP3 et télécharge le PDF. La connexion devient facultative : elle reste réservée à `ALLOWED_EMAIL` et ouvre seulement ce qui est personnel ou interne :

- les actions personnelles : cocher un mot, « Tout cocher », « Ajouter à Anki », « Suivre ce thread » (et le filtre « coché » de la page Vocab) ;
- la page **Santé** (`runs`), ainsi que `drive_pending`, qu'aucune page n'affiche.

Remplace, dans la spec (§1, §2, §5, §6.2, §8.3), la règle « une seule adresse peut lire le brief ». **Spec :** `docs/specs/2026-11-06-daily-brief-design.md`. **Lot d'origine :** `docs/superpowers/plans/2026-11-06-phase-1-lot-6-appli-web.md`.

## Ce qui change

**Base (`supabase/migrations/0005_public_read.sql`, rejouable, 0001 à 0004 inchangées).**
- Les six tables de contenu (`editions`, `stories`, `sources`, `threads`, `thread_events`, `vocab_items`) : `grant select … to anon, authenticated` et une politique `<table>_public_read` (`for select to anon, authenticated using (true)`) qui remplace la politique `<table>_read` de 0001.
- Aucun droit d'écriture nouveau : `anon` n'a ni insert, ni update, ni delete. Les droits de colonne de 0001 (`vocab_items.selected`, `vocab_items.anki_status`, `threads.followed`) restent pour `authenticated`, filtrés par `private.is_allowed_user()`.
- `runs` et `drive_pending` : inchangées (politiques `*_read` de 0001), avec un `revoke all … from public, anon` explicite.
- Stockage : `daily_brief_files_public_read` sur `storage.objects` (`for select to anon, authenticated using (bucket_id in ('audio', 'pdf'))`) remplace `daily_brief_files_read`. Les buckets restent privés (`public = false`) : l'appli crée toujours une URL signée de 10 minutes, désormais aussi avec la clé publique seule.
- **Colonnes personnelles lisibles.** `vocab_items.selected`, `vocab_items.anki_status` et `threads.followed` se lisent publiquement : elles ne disent que quels mots sont cochés et quels Threads sont suivis. Des droits de colonne en lecture auraient cassé les `select` et les jointures PostgREST de l'appli pour un gain nul. L'appli ne les montre pas aux visiteurs, sauf la mention « suivi » de la liste des Threads et leur ordre (suivis d'abord), laissés tels quels.

**Appli (`apps/web`).**
- `proxy.ts` : ne renvoie plus vers `/login` que `/sante` (sans session : `/login` ; autre adresse : `/login?erreur=refuse`). CSP à nonce et passage des actions serveur (`next-action`) inchangés. `lib/access.ts` : `isPrivatePath`.
- Pages : `currentUser()` décide d'`editable`. Faux : `VocabCard` en lecture seule (`.vocab.ro`, ni case, ni « Tout cocher », ni pied Anki, ni état Anki), pas de `FollowButton`, pas de filtre « Coché ». L'Archive montre « Se connecter » (vers `/login`) à la place de « Santé → ».
- Santé : `redirect('/login')` sans utilisateur autorisé (en plus du proxy).
- Routes `/audio` et `/pdf` : plus de 401 sans session.
- Actions serveur : inchangées, `currentUser()` d'abord.
- `/login` : texte « Le brief se lit sans connexion… », lien « ← Retour au brief ». La déconnexion revient à `/` au lieu de `/login`.
- Mode fixture : connecté comme avant ; `FIXTURE_VISITOR=1` simule un visiteur (refusé hors mode fixture, comme lui).
- `ALLOWED_EMAIL` reste : il filtre l'envoi du lien, les actions personnelles et Santé.

**Tests.** PGlite : anon lit le contenu, jamais `runs` ni `drive_pending` ; anon n'écrit rien ; une autre adresse lit le contenu sans rien écrire ; l'utilisateur autorisé écrit toujours les trois colonnes ; stockage limité aux buckets `audio` et `pdf` ; buckets privés. Un aller-retour vérifie qu'`anon` relit exactement les lignes d'une édition que lit l'utilisateur autorisé. Appli : proxy, routes de fichiers, pages en visiteur, `VocabCard` en lecture seule, `currentUser` en mode fixture visiteur. Playwright : un second serveur `FIXTURE_VISITOR=1` (port 3211, `e2e/visitor.spec.ts`), clair et sombre, trois nouvelles captures.

## À faire sur le vrai service

1. Appliquer `0005_public_read.sql` au projet Supabase (connecteur ou *SQL Editor*), puis les vérifications de `docs/setup-supabase.md` §2.
2. Redéployer l'appli sur Vercel. Aucune variable à ajouter ni à retirer ; ne jamais y mettre `FIXTURE`, `FIXTURE_ALLOW_START` ni `FIXTURE_VISITOR`.
3. Les réglages d'authentification ne changent pas : *Allow new users to sign up* reste désactivé, et le lien n'est envoyé qu'à `ALLOWED_EMAIL`.

## Écarts

| Zone | Écart par rapport à la demande | Raison |
|---|---|---|
| Politiques | Nouvelles politiques `*_public_read` et `daily_brief_files_public_read` ; les anciennes `*_read` (contenu) et `daily_brief_files_read` sont supprimées, pas modifiées | Noms qui disent la règle. Rejouer 0001 seule refermerait la lecture (son `revoke all … from anon`) : on rejoue toujours toutes les migrations dans l'ordre, comme le test « rejouables » |
| `runs`, `drive_pending` | `revoke all … from public, anon` explicite dans 0005 | Rien ne change par rapport à 0001, mais la migration dit elle-même ce qui reste fermé |
| Vocab en lecture seule | Cases masquées plutôt que désactivées, et état Anki retiré de la ligne de méta | Une case grisée cochée aurait montré au visiteur les choix de l'utilisateur comme une action impossible |
| Page Vocab | Filtre « Coché » masqué au visiteur, et paramètre `coche` ignoré | Filtre personnel, sans sens pour un visiteur |
| Liste des Threads | Mention « suivi » et tri « suivis d'abord » gardés pour le visiteur | Colonne publique par décision, aucun risque ; pas de changement d'affichage à maintenir |
| Lien « Se connecter » | Dans l'en-tête de l'Archive seulement (à la place de « Santé → ») | Discret, et c'est là qu'était déjà l'accès à Santé ; l'en-tête des éditions reste celui de la maquette |
| Autre adresse connectée | Lit en lecture seule comme un visiteur ; seul `/sante` la renvoie vers `/login?erreur=refuse`. `/auth/confirm` la déconnecte toujours aussitôt | La RLS lui montre le même contenu qu'à `anon` |
| Déconnexion | Retour à `/` au lieu de `/login` | Le site est public : la page de connexion n'est plus le point d'entrée |
| E2E | Second serveur Playwright `FIXTURE_VISITOR=1` sur le même build | Le mode fixture n'a pas de session à retirer ; une variable propre au mode fixture, refusée sur Vercel et en production sans `FIXTURE_ALLOW_START`, n'ouvre rien de plus |
| Captures | Les 12 captures existantes inchangées (le serveur principal reste connecté) ; 6 nouvelles (Vocab EN, en-tête de l'Archive, `/login`, en clair et en sombre), regardées avant le commit | Seuls les écrans du visiteur changent |
