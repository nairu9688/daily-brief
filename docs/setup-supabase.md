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
| `0001_init.sql` | Tables du §6.2, buckets privés `audio` et `pdf`, RLS, email autorisé (`private.app_settings`, `private.is_allowed_user()`) |
| `0002_context_runs.sql` | Fonctions de `brief:context` (fermeture R12, Threads ouverts, sujets de la veille) et bilan `runs` |
| `0003_publish.sql` | Fonction `publish_edition` (publication d'une édition en une transaction) |
| `0004_files.sql` | Dépôts Drive en attente (prise en charge, abandon, expiration) et fonctions de la purge des MP3 |

Deux façons de faire :

- **Par le connecteur Supabase** : demander à Claude d'appliquer chaque fichier, un par un, avec l'outil de migration du connecteur.
- **À la main** : dans le tableau de bord, ouvrir *SQL Editor*, coller le contenu de `0001_init.sql`, exécuter, puis recommencer avec les trois autres.

Chaque fichier est rejouable : l'exécuter deux fois ne casse rien et ne remet pas l'email autorisé à sa valeur par défaut.

Les migrations n'ont besoin d'aucune extension. En particulier, **elles n'utilisent pas pg_cron** : la purge des MP3 de plus de 30 jours est faite par `brief:publish` avec l'API Storage, parce que supprimer une ligne de `storage.objects` en SQL laisserait le fichier orphelin dans le bucket. La purge supprime les MP3 des éditions de plus de 30 jours (`audio_expired`, puis `audio_clear` vide `editions.audio_path`) et balaie aussi le bucket `audio` : un dossier `AAAA-MM-JJ/` de plus de 30 jours dont le MP3 n'a plus d'édition (publication interrompue, ligne supprimée) est supprimé lui aussi. Seuls les chemins de la forme `AAAA-MM-JJ/fr|en|es.mp3` sont supprimés ; tout autre chemin est signalé et jamais touché.

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

Le changement prend effet aussitôt, sans redéploiement. La comparaison ignore la casse et les espaces. Règles à connaître :

- **Une valeur vide ou blanche n'autorise personne** : vider la ligne ferme la lecture à tout le monde, ce n'est pas un moyen de l'ouvrir.
- **Un jeton de session anonyme est toujours refusé**, même si son email correspond (`is_anonymous` vrai).
- **Un jeton sans email** ne correspond à rien. L'application (lot 6) aura aussi une variable `ALLOWED_EMAIL` pour son écran de connexion ; **les deux doivent porter la même adresse**, et c'est celle de la base qui protège les données.

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

« Tout le monde » signifie que l'URL répond sans connexion Google ; c'est le jeton qui protège le dépôt. Le script ne fait rien sans le bon jeton, n'accepte que des fichiers nommés `Daily Brief AAAA-MM-JJ.pdf` ou `Daily Brief AAAA-MM-JJ FR|EN|ES.mp3`, décode tout le contenu (base64 strict) avant de toucher à Drive, et ne renvoie jamais le jeton.

**Remplacement : créer, puis mettre à la corbeille.** Pour un fichier de même nom déjà présent, le script crée d'abord le nouveau fichier, puis met les anciens à la corbeille (tous ceux du même nom, sauf le nouveau). Une création qui échoue laisse donc l'ancien fichier en place. Une erreur de quota de Google (trop d'exécutions ou de créations) est renvoyée au pipeline sous le code `drive-quota`, les autres erreurs Drive sous `drive-error` ; dans les deux cas le fichier est mis en attente et retenté au passage suivant. Le script répond `busy` si un autre dépôt est en cours (verrou de 30 s).

**Après toute modification de `Code.gs`**, il faut republier : *Déployer* → *Gérer les déploiements* → crayon → *Version : Nouvelle version* → *Déployer*. L'URL ne change pas. Un *nouveau* déploiement, lui, changerait l'URL.

Le script mémorise l'identifiant du dossier `Daily Brief` dans la propriété `ROOT_FOLDER_ID`. Si le dossier est déplacé, il reste suivi ; s'il est mis à la corbeille, le script en retrouve un du même nom à la racine de Mon Drive, sinon il le recrée.

## 6. Premier essai

Avec `.env` rempli (§4), sur une date déjà rendue par `brief:render` :

```bash
npm run brief:context -- --date AAAA-MM-JJ
npm run brief:publish -- --date AAAA-MM-JJ
```

Attendu : `brief:context` sort avec le code 0 et le store `supabase` ; `brief:publish` affiche `Publication complète : 3 édition(s) dans Supabase.` et `Drive : sent`. Le détail est dans `out/AAAA-MM-JJ/publish-report.json`.

Relancer `brief:publish` sur la même date ne crée aucun doublon : mêmes lignes en base, et dans Drive le nouveau fichier est créé puis l'ancien part à la corbeille.

## 7. À contrôler sur le vrai projet

Ces points ne peuvent pas être vérifiés hors ligne. Ils sont à cocher au premier essai.

- [ ] **Clé de service.** `brief:context` répond avec le code 0. Si la clé est une clé secrète `sb_secret_…` et que l'appel reçoit un 401, utiliser la clé `service_role` historique (JWT) : le pipeline envoie la même clé dans les en-têtes `apikey` et `Authorization`.
- [ ] **RLS avec un vrai jeton.** Connecté à l'application avec l'adresse autorisée, le brief s'affiche ; avec une autre adresse, tout est vide. Sans connexion, l'API REST répond par une erreur de droits.
- [ ] **Cases à cocher.** Cocher un mot et suivre un Thread dans l'application fonctionne ; toute autre écriture est refusée.
- [ ] **Buckets.** Le dépôt du PDF et d'un MP3 réussit ; les colonnes `file_size_limit` et `allowed_mime_types` des buckets sont bien celles de la migration.
- [ ] **Fichier absent.** Storage répond 404, ou 400 avec `statusCode` 404, `not_found` ou « Object not found », pour un fichier absent : la relance des dépôts en attente le traite comme « absent ». Tout autre 400 (droits, requête mal formée) est une erreur, pas une absence ; vérifier que la réponse réelle de Storage pour un objet inexistant est bien reconnue.
- [ ] **Purge.** Après 31 jours, les MP3 anciens disparaissent du bucket `audio` (par l'API Storage, sans pg_cron) et `editions.audio_path` est vide pour ces dates. Vérifier aussi que le listage des dossiers du bucket (balayage des MP3 orphelins) renvoie bien les dossiers datés.
- [ ] **Apps Script.** Le POST reçoit bien une redirection 302 vers `script.googleusercontent.com`, et un PDF réel de quelques Mo passe en moins de 3 minutes.
- [ ] **Fuseau.** `select (now() at time zone 'Europe/Paris')::date;` renvoie la date de Paris.
- [ ] **Version de Postgres.** Les tests tournent sur Postgres 18 (PGlite) ; le projet hébergé peut être en version 15 ou 17. Les migrations n'utilisent que du SQL courant, mais c'est leur application réelle qui fait foi.

## 8. Lire le bilan d'un passage

`out/AAAA-MM-JJ/publish-report.json` et la ligne `runs` du jour disent ce qui s'est passé. Le code de sortie de `brief:publish` vaut 0 si au moins une édition est publiée, 2 sinon. Le champ `status` vaut :

- `failed` : aucune édition publiée (code 2) ;
- `degraded` : au moins une édition publiée, mais **l'une de ces conditions est vraie** :
  - le rapport contient une entrée de niveau `error` (édition manquante ou invalide, Supabase coupé en cours de route, Drive mal configuré, fichier ni déposé ni mis en attente…) ;
  - le PDF n'est pas dans Supabase Storage ;
  - un fichier du jour (PDF ou MP3) n'est pas dans Supabase Storage ;
  - le dépôt Drive est `pending` (fichiers mis en attente) ou `failed` ;
- `ok` : tout le reste. Un dépôt Drive `skipped` (variables Apps Script absentes, simple avertissement) ne dégrade pas le passage.

### Dépôts Drive en attente (`drive_pending`)

Un fichier qui n'a pas pu partir dans Drive, mais qui est dans Storage, est inscrit dans `drive_pending` (une ligne par date). Au passage suivant :

- la ligne est **prise en charge avant d'être traitée** : la tentative est comptée d'avance, donc une panne en cours de route ne l'efface pas ;
- au plus 5 dépôts sont retentés par passage, les plus anciens d'abord, hors la date du jour ;
- chaque fichier est relu dans Storage et revérifié (nom, date, type, premiers octets) avant l'envoi ;
- après **5 tentatives**, ou si un fichier a disparu de Storage ou n'a plus le bon format, le dépôt est **abandonné** : il n'est plus retenté mais reste visible dans la table et dans le rapport ;
- un dépôt abandonné depuis plus de **30 jours** est supprimé de la table, avec un avertissement.

### Lignes `runs` restées à `running`

`close_stale_threads` crée la ligne `runs` du jour avec le statut `running` (et `steps.closedThreads`) ; `save_run` la remplace par le bilan en fin de passage. Une ligne qui reste à `running` signifie que le pipeline s'est arrêté avant la publication, ou que `brief:publish` n'a pas été lancé : ce n'est pas une erreur de la base. La page Santé (lot 6) doit l'afficher comme « interrompu » au bout de 6 heures.
