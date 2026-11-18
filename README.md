# Daily Brief — kit de conception

Ce kit sert à démarrer l'implémentation dans Claude Code. Copie-le à la racine du repo `daily-brief`, puis donne cette consigne à Claude Code :

> Lis `docs/specs/2026-11-06-daily-brief-design.md`, puis écris le plan d'implémentation de la phase 1 avant de coder. Les maquettes de `design/` et le prototype de `reference/` font foi pour le rendu visuel.

| Dossier | Contenu |
|---|---|
| `docs/specs/` | La spec validée (architecture, données, règles éditoriales R1-R12, design, routine) |
| `design/` | Maquette interactive v2 (HTML), PDF de démonstration à 3 éditions, feuilles de style et JS de référence |
| `fixtures/` | Brief réel du 06/11/2026 au format JSON de la spec, et Threads d'exemple |
| `reference/` | Prototype Node qui a produit les maquettes : `mapgen2.mjs` (cartes d3-geo), `render.mjs` (appli et PDF), `content.mjs` (données sources) |

Pour régénérer les maquettes à partir du prototype : `npm i d3-geo topojson-client world-atlas geist qrcode`, puis `node reference/mapgen2.mjs && node reference/render.mjs`, lancés depuis un dossier qui contient `design/app.css`, `design/app.js` et `design/pdf.css`.

## Développement

Prérequis : Node 22.

```bash
npm install
npm test               # tests unitaires (Vitest)
npm run typecheck      # TypeScript strict
npm run schema:emit    # régénère packages/schema/edition.schema.json
npm run brief:context -- --date AAAA-MM-JJ [--out out] [--allow-empty]
npm run brief:collect -- --date AAAA-MM-JJ [--out out]
npm run check:thenewsapi   # vérification §16 : TheNewsAPI est-elle en temps réel ?
npm run brief:newsletters -- --date AAAA-MM-JJ [--out out]   # messages Gmail enregistrés → newsletters/*.md
npm run brief:verify -- --date AAAA-MM-JJ [--out out]
npm run brief:audio -- --date AAAA-MM-JJ [--out out] [--no-ffmpeg]
npm run audio:samples -- [--out out] [--count 3]   # mise en place : échantillons de voix
npm run brief:render -- --date AAAA-MM-JJ [--out out]
npm run brief:publish -- --date AAAA-MM-JJ [--out out]
npm run brief:finish -- --date AAAA-MM-JJ [--out out] [--dry-run] [--no-ffmpeg]   # audio → rendu → publication, message final
npm run brief:notify -- --date AAAA-MM-JJ [--out out] [--dry-run]   # message final seul
npm run env:check      # contrôle du .env (noms seulement, jamais les valeurs)
npm run maps:preview   # aperçu des cartes de la fixture (out/maps-preview.html)
npm run web:dev        # appli web (FIXTURE=1 : données de fixtures/, sans connexion)
npm run web:build      # build de production de apps/web (hors ligne)
npm run web:e2e        # Playwright à 390 px, clair et sombre, en FIXTURE=1 (après web:build)
npm run web:check-bundle   # aucun secret ni nom de variable serveur dans le code du navigateur
npm run web:icons      # régénère les icônes PWA de apps/web/public/icons/
```

`brief:context` ferme les Threads sans événement depuis 21 jours (R12), puis écrit `out/<date>/context.json` (Threads ouverts et sujets de la veille) et `context-report.json`. Il lit Supabase avec `SUPABASE_URL` et `SUPABASE_SERVICE_ROLE_KEY` (environnement ou `.env`). Sans ces variables, il sort avec le code 2 ; l'option `--allow-empty`, réservée au développement local, écrit alors un contexte vide avec un avertissement. Une URL invalide, une erreur ou un délai dépassé du store donne le code 2, sans `context.json`. Les Threads fermés sont notés dans la table `runs` (`steps.closedThreads`), pour qu'une relance ne les perde pas.

`brief:collect` interroge, chacune indépendamment, la découverte principale (TheNewsAPI, ou Exa selon `primary` dans `pipeline/config/collect.json`), Exa, les flux de `pipeline/config/feeds.json` et, en secours, Webz.io. Il dédoublonne les articles, ne télécharge le texte intégral que pour les domaines `full` de la liste blanche (R1), puis écrit `out/<date>/raw.json` et `collect-report.json` : requêtes par source, budget TheNewsAPI, erreurs sans secret et textes lus par langue, avec `light: true` sous 15 textes (édition allégée, §12). Les clés `THENEWSAPI_KEY`, `EXA_API_KEY` et `WEBZ_TOKEN` viennent de l'environnement ou de `.env` ; sans clé, la source est ignorée avec un avertissement. Le plafond de 90 requêtes TheNewsAPI par jour est suivi dans `<out>/thenewsapi-usage.json` (par défaut `out/`) ; ce registre compte par jour UTC et il est écrit à chaque requête. Un fichier illisible daté d'un jour UTC antérieur remet le compte à zéro avec un avertissement ; illisible le même jour, il rend TheNewsAPI épuisé jusqu'à sa suppression. Deux passages du même jour sont combinés par le maximum des comptes, pas par leur somme. Codes de sortie de `brief:collect` :

- **0** : au moins un article est collecté, `raw.json` et `collect-report.json` sont écrits.
- **2** : aucun article, date incorrecte, dossier de sortie impossible à créer, configuration illisible, ou rapport impossible à écrire. **Il n'y a alors pas de `raw.json`** (un ancien fichier est supprimé) ; `collect-report.json` est écrit quand c'est possible (jamais pour une date incorrecte ni un dossier impossible à créer).

Le champ `degraded` de `collect-report.json` vaut `true` quand la collecte est moins complète que prévu, même avec le code 0 : une source a été coupée (`stoppedBy` : clé refusée, quota, 429, délai ou échecs répétés), une source a levé une exception inattendue, l'échéance globale de 20 minutes est dépassée, le registre d'usage est illisible ou impossible à écrire, la clé de la découverte principale est absente, ou cette source n'a donné aucun candidat. La routine continue alors, mais le signale dans sa notification finale. L'option `--date` n'est qu'une étiquette de dossier : la fenêtre de collecte reste les 24 h avant maintenant (un avertissement le dit quand la date n'est pas celle de Paris).

`check:thenewsapi` (vérification §16) appelle une fois `/v1/news/top` par langue avec `THENEWSAPI_KEY` et affiche l'âge de l'article le plus récent. Si une langue dépasse 2 h, il conseille de passer `"primary": "exa"` dans `pipeline/config/collect.json`. Code 0 : temps réel ; 1 : passer à Exa ; 2 : vérification impossible. Option `--out <dossier>` (défaut `out`) : dossier du registre `thenewsapi-usage.json`, à garder identique à celui de `brief:collect`. Ses 3 requêtes sont inscrites dans ce registre et comptent dans le quota du jour ; la vérification est refusée (code 2) si le registre dépasserait 100 requêtes.

`brief:verify` contrôle `out/<date>/{fr,en,es}.json` selon les règles R1 à R12 de la spec. Il écrit `{lang}.verified.json` (conforme aux règles R1 à R12 détectables automatiquement) et `verify-report.json`. Code de sortie : 0 si propre, 1 si des corrections ont été appliquées, 2 en cas d’erreur : édition invalide ou absente, fichier d’entrée illisible, ou date incorrecte (l’édition doit alors être corrigée avant publication).

`brief:audio` lit l'`audioScript` de chaque `{lang}.verified.json` et le fait lire par Google Cloud Text-to-Speech, avec la voix Chirp 3 HD de l'édition (`pipeline/config/voices.json`). Le texte est découpé en morceaux de 4 500 octets au plus (la limite de l'API est de 5 000), aux fins de phrase, sinon aux virgules, sinon entre les mots, sans jamais couper un mot. Les morceaux sont concaténés avec ffmpeg s'il est présent (MP3 64 kb/s mono, `FFMPEG_PATH` pour un autre chemin), sinon trame par trame, au débit de la source. Il écrit `Daily Brief <date> FR.mp3` (et `EN`, `ES`), `audio.json` (`{ "fr": { "duration": "3:24" } }`) et `audio-report.json`. Les anciens MP3 du jour sont supprimés d'abord ; `brief:publish` ne prend de toute façon que les MP3 qu'annonce l'`audio-report.json` du passage. La clé `GOOGLE_TTS_API_KEY` vient de l'environnement ou de `.env` ; elle part dans l'en-tête `x-goog-api-key`, jamais dans l'URL, et n'apparaît dans aucun message ni rapport. Chaque requête a un délai de 60 s, et le passage entier est borné à 10 minutes. Le service est coupé après un 401, un 403, un 429, un délai dépassé ou 3 échecs consécutifs ; une erreur 5xx ou réseau a droit à une seconde tentative. Les caractères sont plafonnés à 5 000 par édition et 15 000 par passage. L'audio ne bloque jamais la routine : une édition en échec est publiée sans lecteur. Codes de sortie de `brief:audio` :

- **0** : au moins un MP3 est écrit (`status` vaut `ok`, ou `degraded` s'il en manque un), ou l'audio est désactivé faute de clé (`disabled`, avec un avertissement) ;
- **1** : la clé est présente mais aucun MP3 n'a été produit (`failed`) ;
- **2** : entrée invalide (`invalid`) : date incorrecte, `voices.json` invalide ou aucune édition vérifiée lisible, ou ancien fichier audio impossible à supprimer (aucun appel ; le fichier restant peut être publié).

Quel que soit ce code, la routine enchaîne sur `brief:render`, qui lit `audio.json` pour l'encart audio du PDF : `brief:audio` passe donc **avant** `brief:render`. `audio:samples` sert une seule fois, à la mise en place : il liste les voix Chirp 3 HD de chaque langue et écrit des échantillons dans `out/voice-samples/` (voir `docs/setup-audio.md`).

`brief:render` lit les `{lang}.verified.json` du jour et complète les photos Pexels si `PEXELS_API_KEY` est définie (variable d'environnement ou `.env`). Il écrit `{lang}.final.json`, `Daily Brief <date>.pdf` (A4, FR puis EN puis ES) et `render-report.json`. Une édition absente est omise ; sans aucune édition, il n'y a pas de PDF et le code de sortie vaut 2. Le code 2 peut accompagner des `{lang}.final.json` valides (PDF impossible) : la publication s'appuie sur `finals` du rapport. Le test visuel du PDF compare trois captures à `packages/render-pdf/test/__screens__/`. Après un changement voulu du gabarit, régénère-les avec `UPDATE_VISUAL=1 npx vitest run packages/render-pdf/test/visual.test.ts` et vérifie les images avant de les commiter.

`brief:render` imprime avec Chromium (Playwright 1.63.0) : il est préinstallé via `PLAYWRIGHT_BROWSERS_PATH` ; sinon, lance `npx playwright install chromium`. Le code 0 peut s'accompagner d'entrées de niveau `error` dans le rapport (une édition invalide est omise et le PDF contient les autres). Le fichier facultatif `audio.json`, écrit par `brief:audio`, a la forme `{ "fr": { "duration": "3:24" }, "en": { "duration": "3:10" }, "es": { "duration": "3:31" } }` ; chaque langue est facultative et les autres clés sont ignorées.

`brief:publish` publie ce que `brief:render` a produit, dans cet ordre :

1. il retente les dépôts Drive en attente des jours précédents : chaque ligne de `drive_pending` est prise en charge (tentative comptée) avant d'être traitée, au plus 5 lignes par passage, les plus anciennes d'abord ; après 5 tentatives, ou si un fichier a disparu de Storage, le dépôt est abandonné (il reste visible), et un dépôt abandonné depuis plus de 30 jours est supprimé de la table ;
2. il dépose dans Supabase Storage (buckets privés `pdf` et `audio`) le PDF et les MP3 annoncés par `audio-report.json` : un MP3 présent mais absent de ce rapport, ou un rapport d'une autre date ou antérieur au dernier `brief:verify`, est ignoré avec un avertissement (l'édition part sans lecteur) ;
3. il publie chaque édition listée dans `finals` de `render-report.json`, par un appel à la fonction SQL `publish_edition` : une transaction par édition, donc jamais d'édition à moitié écrite ;
4. il dépose les fichiers dans Google Drive par l'application web Apps Script (`apps-script/Code.gs`), un fichier par requête ; `Code.gs` crée le nouveau fichier avant de mettre l'ancien à la corbeille, et signale un quota Google par `drive-quota` ; en cas d'échec, les fichiers présents dans Storage vont dans la table `drive_pending` ;
5. il supprime les MP3 de plus de 30 jours par l'API Storage (sans pg_cron : une suppression en SQL laisserait le fichier orphelin), puis vide `editions.audio_path` ; il balaie aussi le bucket `audio` et supprime les dossiers datés de plus de 30 jours dont le MP3 n'a plus d'édition ;
6. il écrit la ligne `runs` du jour (bilan de chaque étape, d'après les rapports `context`, `collect`, `verify`, `audio` et `render`), puis `publish-report.json`.

Relancer une date remplace proprement ses données : mêmes éditions, sujets, sources et fichiers, sans doublon. Les mots cochés (`vocab_items.selected`, `anki_status`) et les Threads suivis (`threads.followed`) sont conservés. Variables : `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `APPS_SCRIPT_URL` et `APPS_SCRIPT_TOKEN` (environnement ou `.env`) ; aucune n'apparaît dans un message ni dans un rapport. Sans les variables Apps Script, le dépôt Drive est ignoré avec un avertissement. Codes de sortie de `brief:publish` :

- **0** : au moins une édition est publiée dans Supabase. Le champ `status` de `publish-report.json` vaut `ok`, ou `degraded` dès qu'une entrée de niveau `error` figure au rapport (édition manquante ou invalide, par exemple), que le PDF ou un fichier du jour n'est pas dans Storage, ou que le dépôt Drive est `pending` ou `failed`.
- **2** : aucune édition publiée (configuration Supabase absente ou refusée, rien à publier, date incorrecte). Le PDF est quand même envoyé à Drive quand c'est possible.

La base est décrite par `supabase/migrations/` : tables et RLS (`0001_init.sql`), puis les fonctions appelées par le pipeline. Les tests appliquent ces migrations à un Postgres embarqué (PGlite), avec les rôles `anon`, `authenticated` et `service_role` simulés par `pipeline/test/supabase/prelude.sql` : aucun test n'appelle Supabase, Google ni le réseau. Mise en place du projet réel : `docs/setup-supabase.md`.

`context.json`, `raw.json` et `newsletters/` sont facultatifs. Sans textes sources, toutes les citations et tous les chiffres sont retirés.

L'application web (`apps/web`, Next.js 16) lit Supabase avec la clé publique et la session de l'utilisateur : la RLS ne laisse lire que l'adresse autorisée, et l'appli n'écrit que `vocab_items.selected`, `vocab_items.anki_status` (mise en file Anki) et `threads.followed`. La connexion se fait par lien magique, ou par le code du même courriel, envoyé seulement à `ALLOWED_EMAIL`. Le MP3 et le PDF passent par des URL signées de 10 minutes. Avec `FIXTURE=1`, l'appli lit `fixtures/` sans connexion ni réseau : c'est le mode des tests (Vitest et Testing Library dans `npm test`, Playwright dans `npm run web:e2e`), interdit sur Vercel. Mise en ligne : `docs/setup-web.md`.

## Routine quotidienne

La routine (`ROUTINE.md`, tâche planifiée à 05:13, heure de Paris) enchaîne `env:check`, `brief:context`, `brief:collect`, l'enregistrement des newsletters Gmail puis `brief:newsletters`, la rédaction (`pipeline/editorial/PROMPT.md`), `brief:verify` (trois essais au plus) et `brief:finish`.

`brief:newsletters` lit les messages que la routine a enregistrés depuis le connecteur Gmail (`out/<date>/newsletters/gmail/<id>.json` : `id`, `from`, `subject`, `date`, `html`, `text`, copiés tels quels) et écrit `out/<date>/newsletters/<nn>-<newsletter>.md`, que `brief:verify` compte comme textes lus (R1). La conversion est mécanique et mot pour mot ; seuls les expéditeurs des newsletters actives de `pipeline/config/newsletters.json` sont gardés, une par média et 8 au plus ; aucun lien n'est suivi. Il écrit `newsletters-report.json`. Code 0 (même sans message), 2 si la date ou la configuration est inutilisable.

`brief:finish` lance `brief:audio`, `brief:render` puis `brief:publish`, chacun quoi qu'il arrive au précédent, écrit `routine-report.json` et affiche en dernière ligne le message final : « Brief du jour prêt : N sujets, M médias » ou « Brief incomplet : <raison> », avec entre parenthèses ce qui manque (collecte dégradée, audio partiel, Drive en attente…). Code 0 : les trois éditions sont publiées ; 2 : brief incomplet. `--dry-run` s'arrête avant la publication. `brief:notify` affiche le même message à partir des rapports présents, quand la routine s'arrête plus tôt.

`env:check` contrôle `.env` (écrit depuis Vault selon `pipeline/run/env-from-vault.md`) : chaque variable attendue est dite présente, vide ou absente, sans jamais afficher de valeur. Code 2 sans `SUPABASE_URL` ou `SUPABASE_SERVICE_ROLE_KEY`.

Mise en place complète, dans l'ordre : `docs/setup.md`.

Plans d'implémentation : `docs/superpowers/plans/`.
