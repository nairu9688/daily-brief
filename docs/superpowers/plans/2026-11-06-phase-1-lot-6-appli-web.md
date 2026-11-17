# Lot 6 — Application web : plan d'implémentation

> **Pour les agents :** sous-skill requis : superpowers:subagent-driven-development (recommandé) ou superpowers:executing-plans, tâche par tâche. Les étapes utilisent des cases à cocher (`- [ ]`) pour le suivi.

**Objectif :** livrer l'application web privée du Daily Brief dans `apps/web` : Brief du jour (en-tête collant, onglets FR/EN/ES retenus, Morning Brief et lecteur MP3, puces de rubriques, cartes §8.2, « En bref », Vocab du jour), Threads (liste et frise, « Suivre ce thread »), Vocab (filtres langue, date, coché), Archive (calendrier), Santé (table `runs`, « interrompu » au-delà de 6 h), barre d'onglets, connexion par lien magique, bandeaux « édition allégée » et « brief de la veille », manifeste PWA et icônes. Tout se teste hors ligne grâce au mode `FIXTURE=1`. Spec : §2, §3, §5, §6.2, §8.1 à §8.4, §12, §13 et §14 (étape 5).

**Architecture :** une appli Next.js (App Router) qui ne voit les données qu'à travers une interface `DataSource`.
- **Données.** `lib/data/` : modèles d'affichage communs, deux implémentations (`FixtureDataSource` lit `fixtures/`, `SupabaseDataSource` lit la base avec la clé publique et la session de l'utilisateur, donc sous RLS), et des fonctions pures qui valident par zod les lignes de PostgREST puis les convertissent. Un test PGlite publie la fixture avec la vraie fonction `publish_edition`, la relit comme l'utilisateur autorisé et vérifie qu'elle donne exactement ce que donne le mode fixture.
- **Accès.** `proxy.ts` (le middleware de Next 16) rafraîchit la session, renvoie vers `/login`, retient l'onglet d'édition et pose une CSP à nonce. La connexion est un lien magique (ou le code du même courriel), envoyé seulement à `ALLOWED_EMAIL`.
- **Écrans.** Composants serveur portés de `design/maquette-v2.html` et `design/app.css` ; quelques composants clients (lecteur, puces, cases à cocher, sources dépliables, suivi). Les écritures passent par trois actions serveur validées par zod, sur les seules colonnes que la RLS ouvre.
- **Fichiers.** `/audio/<date>/<langue>` et `/pdf/<date>` redirigent vers une URL signée de 10 minutes, créée avec la session.

Aucun test n'appelle Supabase, Vercel, Google ni Internet. Les composants se testent avec Vitest, Testing Library et jsdom ; la base est le Postgres embarqué du lot 4 (PGlite) ; l'appli entière se teste avec Playwright sur le build de production en mode `FIXTURE=1`.

**Pile :** Next.js 16.4.6 (Turbopack, `proxy.ts`), React 19.3.1, `@supabase/ssr` 0.12.7 et `@supabase/supabase-js` 2.119.0, `server-only` 0.0.1, zod 4 et `geist` 1.9.2 (déjà dans le dépôt). Tests : Vitest 3.2.7 (déjà là), `@testing-library/react` 16.3.3, `@testing-library/dom` 10.4.2, `@testing-library/user-event` 14.6.12, `jsdom` 30.1.3, `@playwright/test` 1.63.0 (même version que `playwright`, donc mêmes navigateurs) et `@types/react` / `@types/react-dom` 19.3.0. Toutes les versions sont figées (`-E`).

**Feuille de route :** `docs/superpowers/plans/2026-11-06-phase-1-roadmap.md` (lot 6, et les consignes des lots 1 à 5 pour le lot 6). **Spec :** `docs/specs/2026-11-06-daily-brief-design.md`. **Référence visuelle (fait foi) :** `design/maquette-v2.html`, `design/app.css`, `design/app.js`.

---

## Contexte pour l'exécutant

- **Point de départ.** Les lots 1 à 5 sont en place. Sur `8a229d6`, `npm test` donne `Test Files  78 passed (78)` et `Tests  821 passed (821)`, et `npm run typecheck` ne sort rien. Si la base a bougé depuis (corrections des lots 4 ou 5), ajouter la différence aux totaux attendus de chaque tâche : ce lot ajoute 19 fichiers de test et 102 tests Vitest, plus 44 tests Playwright (dont 2 ignorés) lancés à part.
- **Consignes pour les exécutants, sans exception :**
  - **Réseau.** Aucun accès réseau réel, sauf `npm install` (le registre npm passe par le proxy du conteneur). Le build de Next se fait hors ligne : il n'a besoin d'aucune police distante ni d'aucun service.
  - **Services.** Aucun appel à Supabase, Vercel ou Google ; aucun connecteur MCP.
  - **Clés.** Aucune clé ni aucun identifiant n'est demandé ni utilisé. Les tests utilisent des valeurs factices (`sb_publishable_test`, `https://ref.supabase.co`) qui ne sortent jamais de la machine.
  - **Fichiers intouchables.** Ne pas modifier `fixtures/brief-2026-11-06.json`, `design/`, `reference/` ; ni `packages/`, `pipeline/`, `supabase/` ou `apps-script/` (le lot les **importe** en lecture seule).
  - **Commits.** Chaque commit nomme ses fichiers (`git add <chemins>`), jamais `git add -A` ni `git commit -a` : un autre agent peut commiter en parallèle. Aucun `git push`.
- **Fichiers existants modifiés, et seulement ceux-là :** `package.json`, `package-lock.json`, `vitest.config.ts` et `.gitignore` (tâche 1) ; `README.md`, la feuille de route et `docs/setup-web.md` (tâche 14).
- **Importés en lecture seule :**
  - `@daily-brief/schema` : `EditionSchema`, `VisualSchema`, `UrlSchema`, `LANGS`, `RUBRIC_KEYS`, `parseBrief`, et les types ;
  - `@daily-brief/maps` : `renderMap(spec, label)` (SVG thémable par classes CSS, textes échappés par `escapeXml`) ;
  - pour les tests seulement : `pipeline/publish/rows.ts` (`editionPayload`), `pipeline/test/supabase/pg.ts` (PGlite, migrations, `asRole`) et `pipeline/test/helpers.ts` (`fixtureBrief`).
- **Consignes des lots précédents, toutes tenues :**
  - **Lot 1.** `transpilePackages: ['@daily-brief/schema', '@daily-brief/maps']`, parce que ces paquets exportent du TypeScript source (tâche 1).
  - **Lot 3.** Le bandeau « édition allégée » vient de `editions.status = 'light'`, que la publication recopie de `perLang.<lang>.light` (tâches 3 et 10). Une ligne `runs` à `running` depuis plus de 6 h s'affiche « interrompu » (tâche 11).
  - **Lot 4, lecture.** Tout passe par la clé publique et la session de l'utilisateur, sous RLS. `ALLOWED_EMAIL` porte la même adresse que `private.app_settings` (tâches 5, 6 et 14).
  - **Lot 4, écriture.** Seulement `vocab_items.selected`, `vocab_items.anki_status` (→ `queued`) et `threads.followed` (tâches 5 et 10).
  - **Lot 4, forme des données.** Rubriques et ordre dans `editions.sections` ; sujets par `stories.position` ; brèves = `sources` sans `story_id`, par rubrique puis position ; `morning_brief[].storyId` = `stories.key` ; sous-titre du Thread dans `stories.thread_subtitle` (tâche 3, vérifié sur PGlite).
  - **Lot 4, fichiers.** `pdf_path` et `audio_path` sont des chemins des buckets privés : URL signée créée avec la session ; `audio_path` nul = pas de lecteur, sans message (tâches 5, 10 et 12).
  - **Lot 4, types.** Les types TypeScript de la base ne sont pas générés depuis le projet réel (aucun accès) : les lignes sont décrites et validées par zod dans `lib/data/rows.ts`. La génération reste à faire au lot 7, une fois les migrations appliquées, pour comparaison.
  - **Lot 5.** Le lecteur lit `audio_path` par une URL signée, jamais publique, et prend la durée dans `loadedmetadata` (tâche 10, testé dans jsdom et par Playwright sur un MP3 réel).
- **Leçons des revues des lots 1 à 5, appliquées dès le départ :**
  - **Entrées.** Toute ligne de la base est validée par zod ; une ligne invalide est écartée et journalisée, jamais une exception qui casse la page. Toute URL affichée est en http(s) (une source `javascript:` n'atteint jamais un `href`) ; une photo n'est affichée que depuis `https://images.pexels.com`.
  - **Secrets.** Aucune clé de service : `lib/env.ts` refuse une clé `service_role` ou `sb_secret_…` mise par erreur dans la variable publique. Un test cherche dans le code envoyé au navigateur (`.next/static`) les noms des variables serveur et des valeurs témoins.
  - **SSRF (lot 2).** Pas de `next/image` ni de `remotePatterns` : les photos sont de simples `<img>` limitées par la CSP `img-src https://images.pexels.com`, et le serveur ne va jamais chercher une URL venue de l'édition.
  - **Sorties.** Pas de cache sur les fichiers privés (`Cache-Control: private, no-store`) ; aucune URL signée dans le HTML.
- **Commandes.** Elles se lancent depuis la racine du dépôt. Un échec « Failed to resolve import "@/…" » ou « Cannot find module » signifie que le module n'existe pas encore : c'est l'échec attendu de l'étape « vérifier l'échec ». Les tests PGlite démarrent une base en 1 à 2 s par fichier. Chromium est préinstallé (`PLAYWRIGHT_BROWSERS_PATH`, Playwright 1.63.0).
- **Documentation de Next 16.** Elle est livrée dans le paquet : `node_modules/next/dist/docs/` (notamment `01-app/03-api-reference/03-file-conventions/proxy.md`, `01-app/02-guides/content-security-policy.md` et `01-app/02-guides/upgrading/version-16.md`). La consulter plutôt que de se fier à des souvenirs de Next 14 ou 15 : `middleware.ts` s'appelle désormais `proxy.ts`, `params`, `searchParams`, `cookies()` et `headers()` sont asynchrones, et `next build` utilise Turbopack.

### Vérifications faites en préparant ce plan

Le plan a été exécuté de bout en bout dans une copie jetable du dépôt, sans réseau autre que le registre npm :

- `npm install` des versions ci-dessus : 0 vulnérabilité signalée ;
- `next build` **hors ligne** (proxy HTTP coupé) : réussi en Turbopack, 13 routes dynamiques et le manifeste statique ;
- `npm test` : `Test Files  97 passed (97)`, `Tests  923 passed (923)` ; `npm run typecheck` sans erreur ;
- `npm run web:e2e` : 42 tests Playwright réussis et 2 ignorés, aucune erreur de console ni violation de CSP, en clair et en sombre ;
- `npm run web:check-bundle` : aucun secret ni nom de variable serveur dans `.next/static`.

Les extraits de code de ce plan sont ceux de cette exécution.

### Décisions de conception

1. **Next.js 16.4.6, React 19.3.1, Turbopack et `proxy.ts`.**
   - **Versions.** Dernières versions stables au 17/11/2026 (`npm view`), figées. `@playwright/test` est figé à 1.63.0, la version de `playwright` déjà dans le dépôt, pour réutiliser les navigateurs installés.
   - **Proxy.** Next 16 a renommé le middleware en `proxy.ts`, exécuté en runtime Node (le runtime edge n'y est plus permis). C'est lui qui « redirige vers `/login` » demandé par la feuille de route.
   - **Polices.** `geist/font/sans` et `geist/font/mono` sont construits sur `next/font/local` à partir des fichiers du paquet `geist` : aucune police servie par un CDN (spec §8.1). Les familles passent par les variables `--font-geist-sans` et `--font-geist-mono` ; `app/globals.css` remplace `"Geist"` et `"Geist Mono"` de `design/app.css` par ces variables.
   - **Rendu.** La mise en page racine lit les en-têtes : toutes les pages sont dynamiques. C'est nécessaire au nonce de la CSP, et aucune donnée privée n'est figée au build.
2. **Un seul `npm test`, deux projets Vitest.**
   - **Pourquoi.** La feuille de route a choisi « un seul lanceur pour tous les paquets ». `vitest.config.ts` déclare deux projets : `pipeline` (l'existant, en Node) et `web` (jsdom, JSX automatique, alias `@/`). `npm test` lance les deux ; `npx vitest run --project web` lance l'appli seule.
   - **Node dans jsdom.** Un test qui a besoin de Node (PGlite, `NextRequest`, lecture de fichiers) le déclare par `// @vitest-environment node` en première ligne.
   - **À part.** Playwright (`npm run web:e2e`) reste hors de `npm test` : il lui faut un build de production et un serveur. Le contrôle du code envoyé au navigateur (`npm run web:check-bundle`) aussi, pour la même raison.
3. **Couche de données : `DataSource`, deux implémentations, mêmes écrans.**
   - **Interface.** `lib/data/types.ts` définit les modèles d'affichage (`EditionView`, `ThreadDetail`, `VocabEntry`, `RunRecord`…) et l'interface. Les pages appellent `getDataSource()` et ne savent pas d'où viennent les données.
   - **Fixture.** `FIXTURE=1` lit `fixtures/brief-2026-11-06.json` (les trois éditions) et `fixtures/threads-2026-11-06.json` (épisodes passés des Threads). Les identifiants sont des uuid stables, pour que les actions serveur valident les mêmes formats dans les deux modes. Les écritures restent en mémoire du processus. FR et EN ont un MP3 silencieux de 3 s, ES n'en a pas (cas « pas de lecteur »). Trois passages `runs` : réussi, dégradé, interrompu.
   - **Supabase.** `@supabase/ssr` avec la clé publique et les cookies de session ; chaque `select` nomme ses colonnes ; les lignes sont validées par zod puis converties par des fonctions pures (`lib/data/rows.ts`).
   - **Équivalence prouvée.** `test/data/roundtrip.test.ts` publie les trois éditions de la fixture avec la vraie `publish_edition` (PGlite, lot 4), les relit comme l'utilisateur autorisé (RLS active, JSON comme PostgREST) et vérifie que `editionFromRows` donne exactement `editionFromFixture`, aux identifiants près.
   - **Garde-fou.** `FIXTURE=1` est refusé si la variable `VERCEL` est présente : ce mode ouvre l'appli sans connexion.
4. **Connexion : lien magique, code de secours, `ALLOWED_EMAIL` en défense en profondeur.**
   - **Autorité.** La RLS (`private.is_allowed_user()`) protège les données. `ALLOWED_EMAIL` n'est donc pas une protection à lui seul, mais il n'est pas redondant : il sert trois fois, avec la même règle de comparaison que la base (sans casse ni espaces, jamais vide).
   - **Avant l'envoi.** Une autre adresse ne déclenche aucun courriel (pas d'abus du faible quota d'envoi de Supabase, pas de compte créé), avec exactement la même réponse que l'adresse autorisée.
   - **Dans le proxy.** Une session d'une autre adresse est renvoyée vers `/login?erreur=refuse` au lieu d'afficher des pages vides.
   - **Dans chaque action serveur et route de fichier.** L'utilisateur est revérifié (`getClaims()`, qui vérifie la signature du jeton).
   - **Retour du lien.** `/auth/confirm` accepte `token_hash` + `type` (modèle de courriel recommandé, qui marche d'un navigateur à l'autre) et `code` (PKCE par défaut). La destination est toujours `/` : aucune redirection ouverte. L'adresse du lien vient de `SITE_URL`, jamais de l'en-tête `Host` (sauf `localhost`).
   - **Code.** Le même courriel porte un code à 6 chiffres, saisi sur `/login` : sur iPhone, le lien s'ouvre dans Safari et non dans l'appli installée, qui a ses propres cookies.
5. **Écritures : trois actions serveur strictes.** `setVocabSelected`, `queueAnki` et `setThreadFollowed` valident leur entrée par `z.strictObject` (uuid, 1 à 50 identifiants, booléens ; toute autre clé est refusée), revérifient l'utilisateur et n'écrivent que `selected`, `anki_status` et `followed`. « Ajouter à Anki » ne fait que la mise en file de la phase 1 : `anki_status` passe de `none` à `queued` (filtre `.eq('anki_status', 'none')` : un mot `sent` n'est jamais rétrogradé). Une erreur de la base donne un message sobre et l'interface revient à l'état précédent.
6. **Fichiers privés : redirection vers une URL signée.** Le lecteur et le lien « PDF du jour » pointent vers des routes de l'appli (`/audio/<date>/<langue>`, `/pdf/<date>`). Chacune valide ses paramètres, revérifie l'utilisateur, lit le chemin en base, contrôle sa forme (`AAAA-MM-JJ/fr.mp3`, `AAAA-MM-JJ/daily-brief-AAAA-MM-JJ.pdf`), crée une URL signée de 600 s avec la session et répond 307 (`Cache-Control: private, no-store`, `Referrer-Policy: no-referrer`). L'URL signée n'apparaît jamais dans le HTML, et un lecteur ouvert longtemps en obtient une neuve à chaque chargement. Un MP3 d'environ 3 minutes est chargé bien avant l'expiration.
7. **Sécurité.**
   - **CSP à nonce.** `proxy.ts` pose `script-src 'self' 'nonce-…' 'strict-dynamic'` ; `img-src` se limite à `'self' data: https://images.pexels.com`, `media-src` à `'self'` et l'origine Supabase (cible des redirections audio), `connect-src` à `'self'` ; plus `object-src 'none'`, `base-uri 'self'`, `form-action 'self'` et `frame-ancestors 'none'`. `style-src` garde `'unsafe-inline'` pour les attributs `style` (couleurs des pastilles, hauteurs des barres du lecteur), comme le recommande la documentation de Next. `next.config.ts` ajoute `nosniff`, `Referrer-Policy`, `X-Frame-Options: DENY` et `Permissions-Policy`.
   - **Échappement.** Les textes écrits par le modèle passent tous par JSX, donc échappés par React (testé avec `<script>` et `<img onerror>`).
   - **`dangerouslySetInnerHTML`.** Un seul usage, `components/MapSvg.tsx`, pour le SVG de `renderMap`. Il est sûr : le SVG est produit par notre code et non par le modèle ; les tracés et coordonnées sont des nombres ; les classes viennent d'une liste fixe ; les seuls textes venus de l'édition (libellés des lieux, `aria-label`) passent par `escapeXml` du lot 2 ; et le `MapSpec` est validé par zod avant. Un test vérifie qu'aucun autre fichier n'utilise `dangerouslySetInnerHTML`.
   - **Liens sortants.** `target="_blank" rel="noopener noreferrer"`.
   - **Code du navigateur.** Les modules de données et d'authentification commencent par `import 'server-only'` : un import depuis un composant client casse le build. `npm run web:check-bundle` construit l'appli avec des valeurs témoins dans les variables serveur et les cherche, avec `service_role` et les noms des variables, dans `.next/static`.
8. **PWA : manifeste et icônes, pas de service worker.**
   - **Ce qui est livré.** `app/manifest.ts` donne `/manifest.webmanifest` (`display: standalone`, icônes 192, 512 et 512 « maskable »). `scripts/make-icons.ts` dessine les icônes (logo demi-disque de la maquette) avec `pngjs`, déjà dans le dépôt : elles sont déterministes et ne touchent pas `design/`. Le manifeste et les icônes sont servis sans session, car le navigateur les lit sans cookies.
   - **Pourquoi pas de service worker.** La lecture hors ligne est en phase 2 (spec §2). Un cache de pages privées risquerait de montrer un brief périmé ou de garder des données après déconnexion, et compliquerait la CSP et l'authentification. Il n'est plus exigé pour l'installation sur Android, et iOS ne l'a jamais exigé.
9. **Tests visuels : contrôles robustes, plus des captures de référence commitées.**
   - **Contrôles robustes (`e2e/smoke.spec.ts`).** Ils forment le garde-fou principal. Chaque écran, en clair et en sombre, à 390 px : statut 200, aucune erreur de console ni violation de CSP, aucun défilement horizontal, et les jetons de `design/app.css` présents (`--bg`, `--ink`, fond du `body`). S'y ajoutent des parcours : onglets, puces, lecteur (durée lue sur un vrai MP3), case cochée puis rechargée, Thread suivi, page Santé, manifeste.
   - **Captures (`e2e/visual.spec.ts`).** Six zones par thème (en-tête du Brief, carte fr-1, Vocab EN, Thread, calendrier, passage Santé), commitées comme au lot 2 et comparées avec `toHaveScreenshot` (1 % de pixels d'écart, animations coupées). Ce sont des zones, pas des pages entières : des fichiers légers (15 à 120 Ko) et peu sensibles au contenu voisin. Le mode fixture rend tout déterministe.
10. **Écarts assumés avec la maquette.**
    - **Onglets d'édition.** Ce sont des liens `?ed=xx` et non des boutons : le proxy écrit le cookie `ed` (httpOnly, un an), la page est rendue d'emblée dans la bonne langue, sans JavaScript.
    - **Mise en page.** La barre d'onglets est fixe et l'en-tête respecte les zones sûres (`env(safe-area-inset-*)`) au lieu du cadre de téléphone de la maquette.
    - **Santé.** Elle est rangée sous Archive (lien depuis l'Archive ; l'onglet Archive reste allumé) : la spec ne donne que quatre onglets.
    - **Frise.** L'épisode « À suivre » de la maquette n'a pas d'équivalent en base (`thread_events` n'a pas de prévision) : il n'est pas porté.
    - **Photo sans Pexels.** Un aplat neutre remplace les dégradés inventés de la maquette, avec la même légende.
    - **Interrompu.** « Interrompu » se calcule sur `runs.updated_at`.

### Points non vérifiables ici

Voir la dernière section, « Ce qui n'a pas pu être vérifié hors ligne », reprise à cocher dans `docs/setup-web.md`.

## Structure des fichiers

```
apps/web/
  package.json, next.config.ts, tsconfig.json, playwright.config.ts
  proxy.ts                      session Supabase, renvoi vers /login, cookie d'édition, CSP à nonce
  app/
    layout.tsx, globals.css     polices Geist, portage de design/app.css
    manifest.ts                 manifeste PWA
    actions.ts                  actions serveur : selected, anki_status → queued, followed
    (app)/layout.tsx            accent de l'édition, barre d'onglets
    (app)/page.tsx              Brief du jour (ou de la veille, avec bandeau)
    (app)/edition/[date]/       édition archivée
    (app)/threads/, (app)/threads/[id]/   liste, frise
    (app)/vocab/, (app)/archive/, (app)/sante/
    login/                      page, formulaire (lien et code), actions
    auth/confirm/, auth/signout/          retour du lien magique, déconnexion
    audio/[date]/[lang]/, pdf/[date]/     redirection vers une URL signée
  components/                   TopBar, TabBar, Banner, MorningBrief, Player, RubricFilter, StoryCard,
                                SourcesToggle, MapSvg, Briefs, VocabCard, EditionScreen, FollowButton, icons
  lib/
    env.ts                      FIXTURE, Supabase (clé de service refusée), ALLOWED_EMAIL, SITE_URL
    dates.ts, i18n.ts           dates de Paris, libellés FR/EN/ES, pastilles des médias
    data/                       types, rows (zod + conversions), fixture, supabase, ids, index
    supabase/server.ts          client de la requête (cookies, clé publique)
    auth.ts, access.ts, csp.ts, edition-choice.ts, runs.ts, calendar.ts, file-response.ts
  scripts/make-icons.ts, scripts/check-bundle.ts
  public/icons/                 icônes générées
  test/                         Vitest : lib, data (PGlite), components, app, security
  e2e/                          Playwright : smoke, visual (+ captures de référence)
docs/setup-web.md               mise en place Vercel et réglages d'authentification Supabase
```

---

### Tâche 1 : socle de l'appli, styles et configuration

**Fichiers :**
- Modifier : `package.json` (workspace `apps/*`, scripts), `package-lock.json`, `vitest.config.ts` (deux projets), `.gitignore`
- Créer : `apps/web/package.json`, `apps/web/next.config.ts`, `apps/web/tsconfig.json`, `apps/web/app/layout.tsx`, `apps/web/app/globals.css`, `apps/web/app/(app)/page.tsx` (provisoire, remplacé à la tâche 11), `apps/web/lib/env.ts`
- Test : `apps/web/test/setup.ts`, `apps/web/test/server-only.ts`, `apps/web/test/lib/env.test.ts`

Comportement attendu :
- **Workspace.** `apps/web` est le paquet `@daily-brief/web`, avec des dépendances figées. `npm test` lance le pipeline et l'appli ; `npm run typecheck` vérifie aussi l'appli.
- **Build.** `next build` réussit hors ligne ; les polices Geist viennent du paquet `geist`.
- **Configuration.**
  - **Mode fixture.** `FIXTURE=1` l'active, sauf sur Vercel, où il est refusé.
  - **Date du mode fixture.** « Aujourd'hui » vaut `2026-11-06`, ou `FIXTURE_TODAY`.
  - **Supabase.** L'URL est en https (http seulement pour un Supabase local). Une clé de service (`service_role` ou `sb_secret_…`) est refusée.
  - **`ALLOWED_EMAIL`.** Comparé sans casse ni espaces ; jamais vide.
  - **`SITE_URL`.** Origine du lien magique ; sans elle, seule une origine locale est acceptée.

- [ ] **Étape 1 : déclarer le workspace et installer les dépendances**

Dans `package.json` (racine), ajouter `"apps/*"` aux workspaces et ces scripts (les fichiers qu'ils appellent arrivent aux tâches 12 et 13) :

```json
  "workspaces": [
    "packages/*",
    "pipeline",
    "apps/*"
  ],
```

```json
    "typecheck": "tsc -p tsconfig.json && npm run typecheck -w @daily-brief/web",
    "web:dev": "npm run dev -w @daily-brief/web",
    "web:build": "npm run build -w @daily-brief/web",
    "web:e2e": "playwright test -c apps/web/playwright.config.ts",
    "web:check-bundle": "tsx apps/web/scripts/check-bundle.ts",
    "web:icons": "tsx apps/web/scripts/make-icons.ts"
```

(`typecheck` remplace la ligne existante ; les cinq autres s'ajoutent après `maps:preview`.)

Fichier `apps/web/package.json` :

```json
{
  "name": "@daily-brief/web",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start",
    "typecheck": "next typegen && tsc -p tsconfig.json"
  },
  "devDependencies": {
    "@playwright/test": "1.63.0",
    "@testing-library/dom": "10.4.2",
    "@testing-library/react": "16.3.3",
    "@testing-library/user-event": "14.6.12",
    "@types/react": "19.3.0",
    "@types/react-dom": "19.3.0",
    "jsdom": "30.1.3"
  },
  "dependencies": {
    "@daily-brief/maps": "*",
    "@daily-brief/schema": "*",
    "@supabase/ssr": "0.12.7",
    "@supabase/supabase-js": "2.119.0",
    "geist": "^1.9.2",
    "next": "16.4.6",
    "react": "19.3.1",
    "react-dom": "19.3.1",
    "server-only": "0.0.1",
    "zod": "^4.0.0"
  }
}
```

Dans `.gitignore`, ajouter à la fin :

```
apps/web/next-env.d.ts
*.tsbuildinfo
```

Commande : `npm install`
Attendu : `found 0 vulnerabilities` (ou seulement des avertissements de financement) ; `node_modules/@daily-brief/web` est un lien vers `apps/web` et `node_modules/next/package.json` porte `"version": "16.4.6"`.

- [ ] **Étape 2 : écrire la configuration de Vitest et les tests**

`vitest.config.ts` passe à deux projets. Le projet `pipeline` garde exactement les fichiers et l'environnement d'avant.

Fichier `vitest.config.ts` :

```ts
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const web = (p: string) => fileURLToPath(new URL(`./apps/web/${p}`, import.meta.url));

/**
 * Deux projets, un seul lanceur (`npm test`) : le pipeline et les paquets en Node, l'appli web en jsdom
 * (un fichier qui a besoin de Node, comme les tests PGlite, le déclare par `// @vitest-environment node`).
 */
export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'pipeline',
          include: ['packages/*/test/**/*.test.ts', 'pipeline/test/**/*.test.ts'],
          environment: 'node',
        },
      },
      {
        esbuild: { jsx: 'automatic' },
        resolve: { alias: { '@/': web(''), 'server-only': web('test/server-only.ts') } },
        test: {
          name: 'web',
          include: ['apps/web/test/**/*.test.{ts,tsx}'],
          environment: 'jsdom',
          setupFiles: [web('test/setup.ts')],
        },
      },
    ],
  },
});
```

Fichier `apps/web/test/server-only.ts` :

```ts
// Remplace le paquet `server-only` dans les tests : il lève hors d'un bundle serveur de Next.
export {};
```

Fichier `apps/web/test/setup.ts` :

```ts
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

afterEach(() => cleanup());
```

Fichier `apps/web/test/lib/env.test.ts` :

```ts
import { describe, expect, it } from 'vitest';
import { allowedEmail, ConfigError, fixtureMode, fixtureToday, isAllowedEmail, isServiceKey, supabaseConfig } from '@/lib/env';

const jwt = (payload: object) => `eyJhbGciOiJIUzI1NiJ9.${Buffer.from(JSON.stringify(payload)).toString('base64url')}.sig`;

describe('configuration de l’appli', () => {
  it('FIXTURE=1 active le mode fixture, sauf sur Vercel', () => {
    expect(fixtureMode({ FIXTURE: '1' })).toBe(true);
    expect(fixtureMode({ FIXTURE: 'true' })).toBe(false);
    expect(fixtureMode({})).toBe(false);
    expect(() => fixtureMode({ FIXTURE: '1', VERCEL: '1' })).toThrow(ConfigError);
  });

  it('« aujourd’hui » du mode fixture vaut la date de la fixture, ou FIXTURE_TODAY', () => {
    expect(fixtureToday({})).toBe('2026-11-06');
    expect(fixtureToday({ FIXTURE_TODAY: '2026-11-07' })).toBe('2026-11-07');
    expect(fixtureToday({ FIXTURE_TODAY: 'demain' })).toBe('2026-11-06');
  });

  it('lit l’URL et la clé publique de Supabase', () => {
    expect(supabaseConfig({ NEXT_PUBLIC_SUPABASE_URL: 'https://abc.supabase.co/', NEXT_PUBLIC_SUPABASE_ANON_KEY: jwt({ role: 'anon' }) })).toEqual({
      url: 'https://abc.supabase.co',
      anonKey: jwt({ role: 'anon' }),
      origin: 'https://abc.supabase.co',
    });
    expect(supabaseConfig({ NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:54321', NEXT_PUBLIC_SUPABASE_ANON_KEY: 'sb_publishable_x' }).origin).toBe('http://127.0.0.1:54321');
  });

  it('refuse une configuration absente, en http, ou avec identifiants', () => {
    expect(() => supabaseConfig({})).toThrow(/NEXT_PUBLIC_SUPABASE_URL/);
    expect(() => supabaseConfig({ NEXT_PUBLIC_SUPABASE_URL: 'http://abc.supabase.co', NEXT_PUBLIC_SUPABASE_ANON_KEY: 'k' })).toThrow(/https/);
    expect(() => supabaseConfig({ NEXT_PUBLIC_SUPABASE_URL: 'https://u:p@abc.supabase.co', NEXT_PUBLIC_SUPABASE_ANON_KEY: 'k' })).toThrow(/identifiants/);
  });

  it('refuse toute clé de service, JWT ou clé secrète', () => {
    expect(isServiceKey(jwt({ role: 'service_role' }))).toBe(true);
    expect(isServiceKey('sb_secret_abc')).toBe(true);
    expect(isServiceKey(jwt({ role: 'anon' }))).toBe(false);
    expect(() => supabaseConfig({ NEXT_PUBLIC_SUPABASE_URL: 'https://abc.supabase.co', NEXT_PUBLIC_SUPABASE_ANON_KEY: jwt({ role: 'service_role' }) })).toThrow(/clé de service/);
  });

  it('compare l’email autorisé sans casse ni espaces, et n’autorise jamais un email vide', () => {
    const env = { ALLOWED_EMAIL: ' Nanigeek@Gmail.com ' };
    expect(allowedEmail(env)).toBe('nanigeek@gmail.com');
    expect(isAllowedEmail('NANIGEEK@gmail.com ', env)).toBe(true);
    expect(isAllowedEmail('autre@gmail.com', env)).toBe(false);
    expect(isAllowedEmail('', { ALLOWED_EMAIL: '' })).toBe(false);
    expect(isAllowedEmail(null, env)).toBe(false);
    expect(allowedEmail({})).toBeNull();
  });
});
```

- [ ] **Étape 3 : vérifier l'échec**

Commande : `npx vitest run --project web apps/web/test/lib/env.test.ts`
Attendu : échec, `Failed to resolve import "@/lib/env"`.

- [ ] **Étape 4 : écrire la configuration de l'appli et `lib/env.ts`**

Fichier `apps/web/next.config.ts` :

```ts
import type { NextConfig } from 'next';

/**
 * Les paquets internes exportent leur TypeScript source : Next les transpile. Les en-têtes fixes sont
 * posés ici ; la CSP, qui porte un nonce par requête, est posée par proxy.ts.
 */
const config: NextConfig = {
  transpilePackages: ['@daily-brief/schema', '@daily-brief/maps'],
  poweredByHeader: false,
  reactStrictMode: true,
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), payment=()' },
        ],
      },
    ];
  },
};

export default config;
```

`tsconfig.json` est propre à l'appli (JSX, DOM, extension `next`) ; le `tsconfig.json` racine ne change pas.

Fichier `apps/web/tsconfig.json` :

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["dom", "dom.iterable", "ES2023"],
    "allowJs": false,
    "skipLibCheck": true,
    "strict": true,
    "noEmit": true,
    "esModuleInterop": true,
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "resolveJsonModule": true,
    "isolatedModules": true,
    "jsx": "react-jsx",
    "incremental": true,
    "plugins": [{ "name": "next" }],
    "paths": { "@/*": ["./*"] }
  },
  "include": ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts", ".next/dev/types/**/*.ts"],
  "exclude": ["node_modules", ".next"]
}
```

Fichier `apps/web/lib/env.ts` :

```ts
/**
 * Configuration lue dans l'environnement du serveur. Rien ici n'est secret : l'URL du projet et la
 * clé publique sont publiques par nature, ALLOWED_EMAIL ne protège rien à lui seul (c'est la RLS qui
 * protège les données). Ce module refuse en revanche toute clé de service : l'appli ne doit jamais
 * contourner la RLS, même mal configurée.
 */

type Env = Record<string, string | undefined>;

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigError';
  }
}

/** Date de la fixture : en mode fixture, « aujourd'hui » vaut cette date sauf FIXTURE_TODAY. */
export const FIXTURE_DATE = '2026-11-06';

/**
 * FIXTURE=1 : l'appli lit fixtures/ au lieu de Supabase, sans connexion. Interdit sur Vercel
 * (variable VERCEL présente au build comme à l'exécution) : ce mode ouvre tout sans authentification.
 */
export function fixtureMode(env: Env = process.env): boolean {
  if (env.FIXTURE !== '1') return false;
  if (env.VERCEL) throw new ConfigError('FIXTURE=1 est interdit sur Vercel : ce mode désactive la connexion.');
  return true;
}

/** « Aujourd'hui » du mode fixture : FIXTURE_TODAY (AAAA-MM-JJ) ou la date de la fixture. */
export function fixtureToday(env: Env = process.env): string {
  const v = env.FIXTURE_TODAY;
  return v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : FIXTURE_DATE;
}

export type SupabaseConfig = { url: string; anonKey: string; origin: string };

/** Charge utile d'un JWT, ou null si la chaîne n'en est pas un. */
function jwtPayload(token: string): Record<string, unknown> | null {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  try {
    const json = Buffer.from(parts[1].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
    const v: unknown = JSON.parse(json);
    return v && typeof v === 'object' ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** Vrai si la clé est une clé de service (JWT `role: service_role` ou clé secrète `sb_secret_…`). */
export function isServiceKey(key: string): boolean {
  if (key.startsWith('sb_secret_')) return true;
  return jwtPayload(key)?.role === 'service_role';
}

/**
 * URL et clé publique du projet (NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY). L'URL est en
 * https (http seulement pour un Supabase local sur 127.0.0.1 ou localhost). Une clé de service est refusée.
 */
export function supabaseConfig(env: Env = process.env): SupabaseConfig {
  const rawUrl = env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const anonKey = env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();
  if (!rawUrl || !anonKey) throw new ConfigError('NEXT_PUBLIC_SUPABASE_URL et NEXT_PUBLIC_SUPABASE_ANON_KEY sont requises (ou FIXTURE=1 en local).');
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new ConfigError('NEXT_PUBLIC_SUPABASE_URL n’est pas une URL.');
  }
  const local = url.hostname === '127.0.0.1' || url.hostname === 'localhost';
  if (url.protocol !== 'https:' && !(local && url.protocol === 'http:')) throw new ConfigError('NEXT_PUBLIC_SUPABASE_URL doit être en https.');
  if (url.username || url.password) throw new ConfigError('NEXT_PUBLIC_SUPABASE_URL ne doit pas contenir d’identifiants.');
  if (isServiceKey(anonKey)) throw new ConfigError('NEXT_PUBLIC_SUPABASE_ANON_KEY est une clé de service : utiliser la clé publique (anon ou sb_publishable_…).');
  return { url: url.origin, anonKey, origin: url.origin };
}

const normalize = (email: string) => email.trim().toLowerCase();

/** Email autorisé (ALLOWED_EMAIL), normalisé ; null si absent ou vide : personne n'est autorisé. */
export function allowedEmail(env: Env = process.env): string | null {
  const v = env.ALLOWED_EMAIL ? normalize(env.ALLOWED_EMAIL) : '';
  return v === '' ? null : v;
}

/** Même règle que private.is_allowed_user() : sans casse ni espaces, et jamais un email vide. */
export function isAllowedEmail(email: string | null | undefined, env: Env = process.env): boolean {
  const allowed = allowedEmail(env);
  return allowed !== null && typeof email === 'string' && normalize(email) === allowed;
}

/**
 * Origine du site pour le lien du courriel : SITE_URL (https) en production. Sans SITE_URL, seule une
 * origine locale (localhost, 127.0.0.1) est acceptée : un en-tête Host forgé ne choisit jamais la
 * destination du lien magique (Supabase la vérifie aussi contre sa liste « Redirect URLs »).
 */
export function siteOrigin(requestOrigin: string | null, env: Env = process.env): string | null {
  const configured = env.SITE_URL?.trim();
  if (configured) {
    try {
      const u = new URL(configured);
      return u.protocol === 'https:' && !u.username && !u.password ? u.origin : null;
    } catch {
      return null;
    }
  }
  if (!requestOrigin) return null;
  try {
    const u = new URL(requestOrigin);
    return u.hostname === 'localhost' || u.hostname === '127.0.0.1' ? u.origin : null;
  } catch {
    return null;
  }
}
```

`app/globals.css` est le portage de `design/app.css` : mêmes jetons (`:root`, thème sombre automatique), mêmes classes, sans les polices en base64, la barre et le cadre de la maquette ; les ajouts propres à l'appli sont à la fin.

Fichier `apps/web/app/globals.css` :

```css
/* Portage de design/app.css (fait foi) : mêmes jetons et mêmes classes. Retirés : polices en base64 (Geist
   vient de next/font/local), barre et cadre de la maquette. Ajouts propres à l'appli en fin de fichier. */

:root{
  --bg:#F4F4F1; --page:#ECECE8; --surface:#FFFFFF; --surface-2:#F7F7F5;
  --ink:#0E0E10; --ink-2:#55565C; --ink-3:#8C8D93; --line:#E4E4E0; --line-2:#D6D6D1;
  --map-land:#E9E9E5; --map-stroke:#FFFFFF; --map-dot:#D3D3CE; --map-soft:#DADAD5;
  --fr-l:#3E6BFF; --fr-d:#7B97FF; --en-l:#0E9F6E; --en-d:#34D399; --es-l:#C88E00; --es-d:#FFC233;
  --fr:var(--fr-l); --en:var(--en-l); --es:var(--es-l);
  --accent:var(--fr);
  --shadow:0 1px 0 rgba(0,0,0,.03), 0 8px 30px rgba(0,0,0,.05);
}
@media (prefers-color-scheme: dark){
  :root:not([data-theme="light"]){
    --bg:#0B0B0C; --page:#050506; --surface:#131315; --surface-2:#1A1A1D;
    --ink:#F3F3F1; --ink-2:#A7A8AE; --ink-3:#6C6D73; --line:#222225; --line-2:#2E2E32;
    --map-land:#1E1E21; --map-stroke:#0B0B0C; --map-dot:#232327; --map-soft:#2A2A2F;
    --fr:var(--fr-d); --en:var(--en-d); --es:var(--es-d); --shadow:none;
  }
}
:root[data-theme="dark"]{
  --bg:#0B0B0C; --page:#050506; --surface:#131315; --surface-2:#1A1A1D;
  --ink:#F3F3F1; --ink-2:#A7A8AE; --ink-3:#6C6D73; --line:#222225; --line-2:#2E2E32;
  --map-land:#1E1E21; --map-stroke:#0B0B0C; --map-dot:#232327; --map-soft:#2A2A2F;
  --fr:var(--fr-d); --en:var(--en-d); --es:var(--es-d); --shadow:none;
}
.app[data-ed="fr"]{--accent:var(--fr)} .app[data-ed="en"]{--accent:var(--en)} .app[data-ed="es"]{--accent:var(--es)}

*{box-sizing:border-box;margin:0;padding:0}
html{background:var(--page);color:var(--ink);font-family:var(--font-geist-sans),-apple-system,"Segoe UI",sans-serif;-webkit-font-smoothing:antialiased;-webkit-text-size-adjust:100%}
body{background:var(--page);min-height:100vh}
a{color:inherit;text-decoration:none}
button{font:inherit;color:inherit;background:none;border:0;cursor:pointer}
.mono{font-family:var(--font-geist-mono),ui-monospace,monospace;letter-spacing:.04em}
[hidden]{display:none!important}

/* appli */
.app{background:var(--bg);min-height:100%;padding-bottom:84px}
.topbar{position:sticky;top:0;z-index:20;padding:calc(14px + env(safe-area-inset-top)) 18px 0;background:color-mix(in srgb,var(--bg) 86%,transparent);backdrop-filter:blur(14px);-webkit-backdrop-filter:blur(14px)}
.brandrow{display:flex;justify-content:space-between;align-items:center}
.brand{display:flex;align-items:center;gap:8px;font-weight:500;font-size:14px;letter-spacing:.16em}
.logo{width:16px;height:16px;border-radius:50%;border:1.3px solid var(--ink);background:linear-gradient(90deg,var(--accent) 50%,transparent 50%);transition:background .3s}
.date{font-size:11px;color:var(--ink-3)}
.editions{display:flex;gap:6px;margin-top:14px;padding-bottom:12px;border-bottom:1px solid var(--line)}
.editions button{flex:1;min-width:0;text-align:left;padding:8px 10px 9px;border-radius:12px;border:1px solid var(--line);background:var(--surface);transition:.2s}
.editions button b{display:block;font-size:13px;font-weight:500}
.editions button span{display:block;font-size:9.5px;letter-spacing:.02em;color:var(--ink-3);margin-top:1px;text-transform:uppercase;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.editions button[aria-selected="true"]{border-color:var(--accent);box-shadow:inset 0 -2px 0 var(--accent)}
.editions button[data-ed="fr"][aria-selected="true"]{--accent:var(--fr)}
.editions button[data-ed="en"][aria-selected="true"]{--accent:var(--en)}
.editions button[data-ed="es"][aria-selected="true"]{--accent:var(--es)}

.kicker{font-size:10.5px;text-transform:uppercase;color:var(--ink-3);display:flex;gap:8px;align-items:center;flex-wrap:wrap}
.kicker .acc{color:var(--accent);font-weight:500}
.kicker i{width:3px;height:3px;border-radius:50%;background:var(--ink-3);display:inline-block}

/* morning brief */
.mb{padding:22px 18px 6px}
.mb h1{font-size:33px;line-height:1.06;letter-spacing:-.03em;font-weight:340;margin:10px 0 16px;text-wrap:balance}
.player{display:flex;align-items:center;gap:12px;padding:10px 14px 10px 10px;border-radius:999px;background:var(--surface);border:1px solid var(--line);box-shadow:var(--shadow)}
.play{width:38px;height:38px;border-radius:50%;background:var(--accent);display:grid;place-items:center;flex:none;color:#fff}
.play svg{width:14px;height:14px}
.wave{flex:1;display:flex;align-items:center;gap:2px;height:26px;overflow:hidden}
.wave i{display:block;width:3px;border-radius:2px;background:var(--line-2);flex:none}
.wave i.on{background:var(--accent)}
.playing .wave i{animation:wv 1s ease-in-out infinite alternate}
@keyframes wv{to{transform:scaleY(.35)}}
.ptime{font-size:11px;color:var(--ink-3);text-align:right;line-height:1.3}
.points{list-style:none;margin:18px 0 6px;border-top:1px solid var(--line)}
.points li{display:grid;grid-template-columns:30px 1fr;gap:4px;padding:13px 0;border-bottom:1px solid var(--line)}
.points .n{font-size:11px;color:var(--accent);padding-top:3px}
.points p{font-size:15px;line-height:1.42;color:var(--ink-2)}
.points p b{font-weight:500;color:var(--ink)}
.points .tag{display:block;margin-top:5px;font-size:10px;color:var(--ink-3);text-transform:uppercase}

/* rubriques */
.chips{display:flex;gap:6px;overflow-x:auto;padding:16px 18px 6px;scrollbar-width:none}
.chips::-webkit-scrollbar{display:none}
.chip{flex:none;font-size:12.5px;padding:7px 12px;border-radius:999px;border:1px solid var(--line);background:var(--surface);color:var(--ink-2);white-space:nowrap}
.chip.dim{color:var(--ink-3);opacity:.6}
.chip[aria-pressed="true"]{background:var(--ink);color:var(--bg);border-color:var(--ink);opacity:1}
.empty{margin:24px 18px;padding:18px;border:1px dashed var(--line-2);border-radius:16px;font-size:11px;color:var(--ink-3);text-transform:uppercase;text-align:center}
.rub{padding:22px 0 4px}
.rubhead{display:flex;justify-content:space-between;align-items:baseline;padding:0 18px 10px}
.rubhead h2{font:500 11px var(--font-geist-mono),monospace;text-transform:uppercase;letter-spacing:.12em}
.rubhead span{font-size:11px;color:var(--ink-3)}

/* carte */
.card{margin:0 12px 14px;background:var(--surface);border:1px solid var(--line);border-radius:22px;overflow:hidden;box-shadow:var(--shadow)}
.media{position:relative;aspect-ratio:16/10;background:var(--surface-2);overflow:hidden;border-bottom:1px solid var(--line)}
.media .map{width:100%;height:100%;display:block}
.media .cap,.photo .cap{position:absolute;left:12px;top:10px;font-size:9.5px;text-transform:uppercase;padding:4px 7px;border-radius:6px}
.media .cap{color:var(--ink-2);background:color-mix(in srgb,var(--surface) 82%,transparent);backdrop-filter:blur(6px);border:1px solid var(--line)}
.map .land{fill:var(--map-land);stroke:var(--map-stroke);stroke-width:.8}
.map .focus{fill:color-mix(in srgb,var(--accent) 34%,var(--map-land));stroke:var(--accent);stroke-width:1}
.map .focus-soft{fill:var(--map-soft);stroke:var(--map-stroke)}
.map .dot{fill:var(--map-dot)}
.map .marker{fill:var(--accent)}
.map .bubble{fill:var(--accent);fill-opacity:.22;stroke:var(--accent);stroke-width:1}
.map .pulse{fill:var(--accent);opacity:.18;transform-box:fill-box;transform-origin:center;animation:pl 2.4s ease-out infinite}
@keyframes pl{0%{transform:scale(.5);opacity:.4}100%{transform:scale(1.6);opacity:0}}
.map .arc{fill:none;stroke:var(--accent);stroke-width:1.6;stroke-dasharray:4 5;animation:dash 1.6s linear infinite}
@keyframes dash{to{stroke-dashoffset:-18}}
.map .maplabel{font:500 13px var(--font-geist-mono),monospace;fill:var(--ink-2);paint-order:stroke;stroke:var(--surface-2);stroke-width:4px}
.photo{position:relative;aspect-ratio:16/10;overflow:hidden;border-bottom:1px solid var(--line)}
.photo .ph{position:absolute;inset:0}
.photo .cap{color:#fff;background:rgba(0,0,0,.35);backdrop-filter:blur(6px)}
.photo .pex{position:absolute;right:12px;top:12px;font-size:9.5px;color:rgba(255,255,255,.85);text-transform:uppercase}

.body{padding:16px 16px 14px}
.card h3{font-size:21px;line-height:1.2;letter-spacing:-.02em;font-weight:420;margin:8px 0 10px;text-wrap:balance}
.ai{display:inline-flex;align-items:center;gap:5px;font-size:9.5px;text-transform:uppercase;color:var(--ink-3);margin-bottom:6px}
.ai svg{width:11px;height:11px;color:var(--accent)}
.sum{font-size:14.5px;line-height:1.52;color:var(--ink-2)}
.stats{display:grid;grid-template-columns:1fr 1fr;gap:1px;background:var(--line);border:1px solid var(--line);border-radius:14px;overflow:hidden;margin:14px 0 4px}
.stat{background:var(--surface);padding:10px 12px}
.stat b{display:block;font-size:21px;font-weight:380;letter-spacing:-.02em}
.stat span{font-size:11.5px;color:var(--ink-3);line-height:1.3;display:block;margin-top:2px}
.quote{margin:14px 0 4px;padding:2px 0 2px 14px;border-left:2px solid var(--accent)}
.quote p{font-size:17px;line-height:1.38;letter-spacing:-.01em;font-weight:360}
.quote p.tr{font-size:13px;color:var(--ink-2);margin-top:6px;font-weight:400}
.quote p.tr span{font-size:9.5px;text-transform:uppercase;color:var(--ink-3);margin-right:4px}
.quote cite{display:block;font-style:normal;font-size:10.5px;color:var(--ink-3);margin-top:6px;text-transform:uppercase}
.diverge{margin:14px 0 2px;border:1px solid color-mix(in srgb,var(--accent) 40%,var(--line));border-radius:12px;overflow:hidden}
.dh{display:flex;align-items:center;gap:6px;font-size:9.5px;text-transform:uppercase;color:var(--accent);padding:8px 12px;background:color-mix(in srgb,var(--accent) 8%,var(--surface))}
.dh svg{width:13px;height:13px}
.drow{display:grid;grid-template-columns:1fr 1fr;gap:1px;border-top:1px solid var(--line);background:var(--line)}
.drow .dk{grid-column:1/-1;background:var(--surface);font-size:11.5px;color:var(--ink-3);padding:7px 12px 0}
.dv{background:var(--surface);padding:2px 12px 9px}
.dv b{display:block;font-size:16px;font-weight:420;letter-spacing:-.01em}
.dv small{font-size:9.5px;color:var(--ink-3);text-transform:uppercase}
.prepa{display:flex;gap:10px;margin:14px 0 2px;padding:10px 12px;border-radius:12px;background:var(--surface-2);border:1px dashed var(--line-2)}
.prepa svg{width:16px;height:16px;flex:none;margin-top:2px;color:var(--accent)}
.prepa b{display:block;font-size:9.5px;text-transform:uppercase;color:var(--ink-3);font-weight:400;margin-bottom:2px}
.prepa p{font-size:12.5px;line-height:1.42;color:var(--ink-2)}
.thread{display:flex;align-items:center;gap:10px;margin:12px 0 2px;padding:10px 12px;border-radius:12px;border:1px solid var(--line)}
.thread>svg{width:18px;height:18px;flex:none;color:var(--accent)}
.thread .chev{width:14px;color:var(--ink-3)}
.thread div{flex:1;min-width:0}
.thread b{display:block;font-size:9.5px;text-transform:uppercase;color:var(--accent);font-weight:500}
.thread span{display:block;font-size:13px;line-height:1.3;margin-top:1px}
.thread em{font-style:normal;color:var(--ink-3)}
.srcs{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-top:14px;padding-top:12px;border-top:1px solid var(--line)}
.stack{display:flex;align-items:center;gap:8px;min-width:0}
.favs{display:flex;flex:none}
.fav{width:22px;height:22px;border-radius:50%;display:grid;place-items:center;font:500 8.5px var(--font-geist-mono),monospace;color:#fff;border:2px solid var(--surface);margin-left:-6px;flex:none}
.fav:first-child{margin-left:0}
.fav.sm{width:20px;height:20px;margin:0;border:0;font-size:8px}
.stack small{font-size:11.5px;color:var(--ink-2);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.btns{display:flex;gap:6px;flex:none}
.btn{display:inline-flex;align-items:center;gap:5px;font-size:12.5px;font-weight:450;padding:8px 12px;border-radius:999px;border:1px solid var(--line-2);background:var(--surface);white-space:nowrap}
.btn.pri{background:var(--ink);color:var(--bg);border-color:var(--ink)}
.btn svg{width:11px;height:11px}
.more{display:flex;flex-direction:column;margin-top:10px}
.more a{display:grid;grid-template-columns:20px 1fr auto;gap:10px;align-items:start;font-size:12.5px;line-height:1.35;color:var(--ink-2);padding:9px 0;border-top:1px dashed var(--line)}
.more .mt b{display:block;font-size:9.5px;font-weight:500;color:var(--ink);text-transform:uppercase;margin-bottom:2px}
.more .rd{font-size:8.5px;text-transform:uppercase;color:var(--ink-3);border:1px solid var(--line);border-radius:999px;padding:2px 6px;white-space:nowrap}
.more .rd.on{color:var(--accent);border-color:color-mix(in srgb,var(--accent) 45%,var(--line))}

/* en bref */
.briefs{margin:0 12px 14px;background:var(--surface);border:1px solid var(--line);border-radius:18px;padding:4px 14px;box-shadow:var(--shadow)}
.bh{font-size:9.5px;text-transform:uppercase;color:var(--ink-3);padding:10px 0 4px}
.brief{display:grid;grid-template-columns:20px 1fr 12px;gap:10px;align-items:start;padding:10px 0;border-top:1px solid var(--line);font-size:14px;line-height:1.38}
.brief:first-of-type{border-top:0}
.brief small{display:block;font-size:9.5px;color:var(--ink-3);text-transform:uppercase;margin-top:3px}
.brief>svg{width:11px;height:11px;color:var(--ink-3);margin-top:4px}

/* vocab */
.vocab{margin:0 12px 14px;background:var(--surface);border:1px solid var(--line);border-radius:22px;padding:16px;box-shadow:var(--shadow)}
.vocab header{display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;gap:10px}
.vocab h3{font-size:19px;font-weight:420;letter-spacing:-.015em;margin-top:4px}
.selall{font-size:10px;text-transform:uppercase;color:var(--ink-2);border:1px solid var(--line-2);border-radius:999px;padding:6px 10px;white-space:nowrap}
.vrow{display:grid;grid-template-columns:24px 1fr;gap:10px;padding:11px 0;border-top:1px solid var(--line);cursor:pointer;align-items:start}
.vrow:first-of-type{border-top:0}
.vrow input{position:absolute;opacity:0;pointer-events:none}
.vrow .box{width:20px;height:20px;border-radius:6px;border:1.5px solid var(--line-2);margin-top:1px;display:grid;place-items:center;transition:.15s}
.vrow input:checked+.box{background:var(--accent);border-color:var(--accent)}
.vrow input:checked+.box:after{content:"";width:9px;height:5px;border-left:2px solid #fff;border-bottom:2px solid #fff;transform:rotate(-45deg) translate(1px,-1px)}
.vt{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,44%);gap:2px 10px}
.vt b{font-size:15px;font-weight:500}
.vt b em{font-style:normal;font-weight:400;font-size:11px;color:var(--ink-3);margin-left:6px;font-family:var(--font-geist-mono),monospace}
.vt .fr{font-size:13px;color:var(--accent);text-align:right}
.vt p{grid-column:1/-1;font-size:12.5px;color:var(--ink-2);line-height:1.4}
.vocab footer{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-top:8px;padding-top:12px;border-top:1px solid var(--line)}
.anki{font-size:12.5px;font-weight:450;padding:9px 14px;border-radius:999px;background:var(--accent);color:#fff;transition:.2s}
.anki:disabled{background:var(--surface-2);color:var(--ink-3);border:1px solid var(--line);cursor:default}
.soon{font-size:9.5px;color:var(--ink-3);text-transform:uppercase}

.colophon{padding:14px 18px 8px;font-size:10.5px;color:var(--ink-3);line-height:1.5;text-transform:uppercase}

/* tab bar */
.tabbar{position:fixed;left:0;right:0;bottom:0;z-index:25;display:flex;justify-content:space-around;padding:10px 12px calc(10px + env(safe-area-inset-bottom));max-width:520px;margin:0 auto;background:color-mix(in srgb,var(--bg) 86%,transparent);backdrop-filter:blur(14px);-webkit-backdrop-filter:blur(14px);border-top:1px solid var(--line)}
.tabbar a{display:flex;flex-direction:column;align-items:center;gap:4px;font-size:10px;color:var(--ink-3)}
.tabbar a.on{color:var(--ink)}
.tabbar svg{width:20px;height:20px}

/* thread */
.th-head{padding:calc(16px + env(safe-area-inset-top)) 18px 16px;border-bottom:1px solid var(--line)}
.back{font-size:12px;color:var(--ink-3)}
.th-head h2{font-size:28px;line-height:1.08;letter-spacing:-.028em;font-weight:340;margin:12px 0 8px}
.th-head p{font-size:13.5px;color:var(--ink-2);line-height:1.45}
.follow{margin-top:14px;display:inline-flex;align-items:center;gap:6px;font-size:12.5px;font-weight:450;padding:8px 13px;border-radius:999px;background:var(--accent);color:#fff}
.follow svg{width:12px;height:12px}
.timeline{list-style:none;padding:8px 18px 20px;position:relative}
.timeline:before{content:"";position:absolute;left:29px;top:26px;bottom:40px;width:1px;background:var(--line-2)}
.timeline li{position:relative;padding:16px 0 10px 32px}
.timeline li:before{content:"";position:absolute;left:6px;top:21px;width:9px;height:9px;border-radius:50%;background:var(--bg);border:2px solid var(--ink-3)}
.timeline li.now:before{background:var(--accent);border-color:var(--accent);box-shadow:0 0 0 5px color-mix(in srgb,var(--accent) 22%,transparent)}
.timeline li.next:before{border-style:dashed}
.timeline .d{font-size:10.5px;color:var(--ink-3);text-transform:uppercase}
.timeline li.now .d{color:var(--accent)}
.timeline h4{font-size:17px;line-height:1.3;font-weight:420;margin:4px 0 6px;letter-spacing:-.012em}
.timeline p{font-size:13.5px;color:var(--ink-2);line-height:1.45}
.timeline .s{display:inline-block;margin-top:8px;font-size:11px;color:var(--ink-3);border:1px solid var(--line);padding:3px 8px;border-radius:999px}
.mini{margin:8px 0 0;border-radius:14px;overflow:hidden;border:1px solid var(--line);background:var(--surface-2)}
.mini .map{display:block;width:100%;height:auto}

/* ---- ajouts de l'appli (lot 6) ---- */
body{background:var(--bg)}
.app{max-width:520px;margin:0 auto;min-height:100vh;overflow-x:clip}
.editions a{flex:1;min-width:0;text-align:left;padding:8px 10px 9px;border-radius:12px;border:1px solid var(--line);background:var(--surface);transition:.2s}
.editions a b{display:block;font-size:13px;font-weight:500}
.editions a span{display:block;font-size:9.5px;letter-spacing:.02em;color:var(--ink-3);margin-top:1px;text-transform:uppercase;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.editions a[aria-current="page"]{border-color:var(--accent);box-shadow:inset 0 -2px 0 var(--accent)}
.banner{margin:14px 18px 0;padding:10px 12px;border-radius:12px;border:1px solid color-mix(in srgb,var(--accent) 40%,var(--line));background:color-mix(in srgb,var(--accent) 8%,var(--surface));font-size:12.5px;line-height:1.4;color:var(--ink-2)}
.banner b{display:block;font-size:9.5px;text-transform:uppercase;color:var(--accent);font-weight:500;margin-bottom:2px}
.play:disabled{opacity:.5}
.photo img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}
.photo .pex a{color:inherit;text-decoration:underline}
.ed-filter[data-show="pol"] .rub:not([data-rub="pol"]),.ed-filter[data-show="int"] .rub:not([data-rub="int"]),.ed-filter[data-show="eco"] .rub:not([data-rub="eco"]),
.ed-filter[data-show="ent"] .rub:not([data-rub="ent"]),.ed-filter[data-show="dro"] .rub:not([data-rub="dro"]),.ed-filter[data-show="tec"] .rub:not([data-rub="tec"]),
.ed-filter[data-show="env"] .rub:not([data-rub="env"]),.ed-filter[data-show="cul"] .rub:not([data-rub="cul"]),.ed-filter[data-show="spo"] .rub:not([data-rub="spo"]){display:none}
.anki-msg{font-size:11px;color:var(--ink-3);margin-top:8px}
.anki-msg[role="alert"]{color:var(--accent)}
.page-head{padding:calc(16px + env(safe-area-inset-top)) 18px 14px;border-bottom:1px solid var(--line)}
.page-head h1{font-size:28px;line-height:1.08;letter-spacing:-.028em;font-weight:340;margin-top:10px}
.page-head p{font-size:13px;color:var(--ink-2);margin-top:6px;line-height:1.45}
.list{list-style:none;padding:6px 12px 18px}
.list li{margin-top:10px}
.list a.item{display:block;padding:12px 14px;border-radius:16px;border:1px solid var(--line);background:var(--surface)}
.list .item b{display:block;font-size:16px;font-weight:420;letter-spacing:-.01em}
.list .item span{display:block;font-size:12.5px;color:var(--ink-2);margin-top:3px}
.list .item small{display:block;font-size:10px;color:var(--ink-3);text-transform:uppercase;margin-top:6px}
.follow[aria-pressed="true"]{background:var(--surface);color:var(--ink);border:1px solid var(--line-2)}
.filters{display:flex;flex-wrap:wrap;gap:6px;padding:12px 18px 4px}
.filters a{font-size:12px;padding:6px 11px;border-radius:999px;border:1px solid var(--line);background:var(--surface);color:var(--ink-2)}
.filters a[aria-current="true"]{background:var(--ink);color:var(--bg);border-color:var(--ink)}
.vocab .vmeta{grid-column:1/-1;font-size:9.5px;color:var(--ink-3);text-transform:uppercase}
.cal{padding:10px 12px 18px}
.cal nav{display:flex;justify-content:space-between;align-items:center;padding:6px 6px 12px;font-size:12px;color:var(--ink-2)}
.cal nav b{font-size:15px;font-weight:420;color:var(--ink);text-transform:capitalize}
.cal ol{list-style:none;display:grid;grid-template-columns:repeat(7,minmax(0,1fr));gap:4px}
.cal li{aspect-ratio:1;display:grid;place-items:center;border-radius:10px;font-size:13px;color:var(--ink-3)}
.cal li.h{font-size:9.5px;text-transform:uppercase;aspect-ratio:auto;padding:4px 0}
.cal li a{width:100%;height:100%;display:grid;place-items:center;border-radius:10px;background:var(--surface);border:1px solid var(--line);color:var(--ink);font-weight:500}
.cal li a.light{border-style:dashed}
.cal li a.today{border-color:var(--accent);box-shadow:inset 0 -2px 0 var(--accent)}
.runs{list-style:none;padding:6px 12px 18px}
.run{margin-top:10px;padding:12px 14px;border-radius:16px;border:1px solid var(--line);background:var(--surface)}
.run header{display:flex;justify-content:space-between;align-items:baseline;gap:8px}
.run header b{font-size:15px;font-weight:420}
.st{font-size:9.5px;text-transform:uppercase;padding:3px 7px;border-radius:999px;border:1px solid var(--line-2);color:var(--ink-2);white-space:nowrap}
.st.ok{color:var(--en);border-color:color-mix(in srgb,var(--en) 45%,var(--line))}
.st.degraded,.st.interrupted{color:var(--es);border-color:color-mix(in srgb,var(--es) 45%,var(--line))}
.st.failed{color:#D6336C;border-color:color-mix(in srgb,#D6336C 45%,var(--line))}
.run table{width:100%;border-collapse:collapse;margin-top:8px;font-size:12px;table-layout:fixed}
.run td{padding:5px 0;border-top:1px solid var(--line);vertical-align:top;color:var(--ink-2);overflow-wrap:anywhere}
.run td:first-child{width:28%;color:var(--ink);font-family:var(--font-geist-mono),monospace;font-size:10.5px;text-transform:uppercase}
.run td:nth-child(2){width:26%}
.run p{font-size:12px;color:var(--ink-3);margin-top:8px}
.login{max-width:420px;margin:0 auto;padding:calc(48px + env(safe-area-inset-top)) 22px 40px}
.login h1{font-size:30px;font-weight:340;letter-spacing:-.03em;margin:18px 0 8px}
.login p{font-size:13.5px;color:var(--ink-2);line-height:1.45}
.login form{display:flex;flex-direction:column;gap:10px;margin-top:22px}
.login label{font-size:10px;text-transform:uppercase;color:var(--ink-3)}
.login input{font:inherit;font-size:16px;padding:12px 14px;border-radius:14px;border:1px solid var(--line-2);background:var(--surface);color:var(--ink)}
.login button{font-size:14px;font-weight:450;padding:12px 14px;border-radius:999px;background:var(--ink);color:var(--bg)}
.login [role="status"],.login [role="alert"]{font-size:12.5px;color:var(--ink-2);margin-top:12px}
.signout{padding:0 18px 18px}
.signout button{font-size:11px;color:var(--ink-3);text-transform:uppercase;text-decoration:underline}
[data-ed="fr"]{--accent:var(--fr)} [data-ed="en"]{--accent:var(--en)} [data-ed="es"]{--accent:var(--es)}
```

Fichier `apps/web/app/layout.tsx` :

```tsx
import type { Metadata, Viewport } from 'next';
import { GeistMono } from 'geist/font/mono';
import { GeistSans } from 'geist/font/sans';
import { headers } from 'next/headers';
import type { ReactNode } from 'react';
import './globals.css';

export const metadata: Metadata = {
  title: 'Daily Brief',
  description: 'Briefing d’actualité quotidien, privé.',
  applicationName: 'Daily Brief',
  appleWebApp: { capable: true, title: 'Daily Brief', statusBarStyle: 'black-translucent' },
  icons: { icon: '/icons/icon.svg', apple: '/icons/apple-touch-icon.png' },
  robots: { index: false, follow: false },
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#F4F4F1' },
    { media: '(prefers-color-scheme: dark)', color: '#0B0B0C' },
  ],
};

/**
 * Racine : polices Geist auto-hébergées (paquet `geist`, construit sur next/font/local, aucune
 * police servie par un CDN). Lire les en-têtes rend toutes les pages dynamiques : Next y applique
 * le nonce de la CSP posée par proxy.ts, et aucune donnée privée n'est figée au build.
 */
export default async function RootLayout({ children }: { children: ReactNode }) {
  await headers();
  return (
    <html lang="fr" className={`${GeistSans.variable} ${GeistMono.variable}`}>
      <body>{children}</body>
    </html>
  );
}
```

Page provisoire, pour que le build ait une route (remplacée à la tâche 11) :

Fichier `apps/web/app/(app)/page.tsx` :

```tsx
export default function BriefPage() {
  return <p className="empty mono">Daily Brief</p>;
}
```

- [ ] **Étape 5 : vérifier le succès**

Commande : `npx vitest run --project web apps/web/test/lib/env.test.ts`
Attendu : `Test Files  1 passed (1)` et `Tests  6 passed (6)`.

Commande : `npm test && npm run typecheck`
Attendu : `Test Files  79 passed (79)`, `Tests  827 passed (827)` ; `tsc` sans sortie, puis `✓ Types generated successfully` et de nouveau aucune erreur pour l'appli.

Commande : `HTTPS_PROXY=http://127.0.0.1:9 HTTP_PROXY=http://127.0.0.1:9 npm run web:build`
Attendu : `✓ Compiled successfully` puis la liste des routes, dont `ƒ /` ; aucune requête réseau n'est nécessaire (le proxy coupé le prouve).

- [ ] **Étape 6 : commit**

```bash
git add package.json package-lock.json vitest.config.ts .gitignore apps/web/package.json apps/web/next.config.ts apps/web/tsconfig.json apps/web/app/layout.tsx apps/web/app/globals.css "apps/web/app/(app)/page.tsx" apps/web/lib/env.ts apps/web/test/setup.ts apps/web/test/server-only.ts apps/web/test/lib/env.test.ts
git commit -m "feat(web): socle Next.js de l'appli, styles portés et configuration"
```

---

### Tâche 2 : dates de Paris, libellés et pastilles des médias

**Fichiers :**
- Créer : `apps/web/lib/dates.ts`, `apps/web/lib/i18n.ts`
- Test : `apps/web/test/lib/format.test.ts`

Comportement attendu :
- **Dates.** Une date civile ne passe jamais par le fuseau du serveur. L'en-tête affiche « VEN 06.11.26 », la frise « Ven. 6 nov. », « Thu 5 Nov » ou « Mar 3 nov », et l'heure est celle de Paris. Une date impossible (« 2026-02-30 ») est refusée.
- **Libellés.** Les libellés de l'édition sont repris de `reference/render.mjs` (`T`), dans les trois langues. Les puces ont leurs libellés courts (« International », « Entreprises », « Droit »…), distincts des titres de rubrique ; les guillemets sont ceux du PDF.
- **Pastilles.** La couleur et les initiales d'un média sont calculées comme dans le prototype (« Sud Radio · AFP » → `#8A2E62`, « SR »).

- [ ] **Étape 1 : écrire les tests**

Fichier `apps/web/test/lib/format.test.ts` :

```ts
import { describe, expect, it } from 'vitest';
import { addDays, headerDate, isIsoDate, longDateFr, monthFr, parisTime, parisToday, shortDate } from '@/lib/dates';
import { CHIP_LABELS, favColor, initials, T, uniqueOutlets } from '@/lib/i18n';

describe('dates', () => {
  it('formate comme la maquette', () => {
    expect(headerDate('2026-11-06')).toBe('VEN 06.11.26');
    expect(shortDate('2026-11-06', 'fr')).toBe('Ven. 6 nov.');
    expect(shortDate('2026-11-05', 'en')).toBe('Thu 5 Nov');
    expect(shortDate('2026-11-03', 'es')).toBe('Mar 3 nov');
    expect(longDateFr('2026-11-06')).toBe('vendredi 6 novembre 2026');
    expect(monthFr('2026-11')).toBe('novembre 2026');
  });

  it('prend la date et l’heure de Paris, pas celles du serveur', () => {
    expect(parisToday(new Date('2026-11-06T23:30:00Z'))).toBe('2026-11-07');
    expect(parisTime('2026-11-06T04:41:00Z')).toBe('05:41');
  });

  it('valide et décale les dates civiles', () => {
    expect(isIsoDate('2026-11-06')).toBe(true);
    expect(isIsoDate('2026-02-30')).toBe(false);
    expect(isIsoDate('06/11/2026')).toBe(false);
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
  });
});

describe('libellés', () => {
  it('reprend les pastilles et initiales du prototype', () => {
    expect(favColor('Sud Radio · AFP')).toBe('#8A2E62');
    expect(favColor('Euronews')).toBe('#B8860B');
    expect(favColor('Sud Radio')).toBe('#0F3B85');
    expect(initials('Sud Radio · AFP')).toBe('SR');
    expect(initials('elDiario.es')).toBe('E');
    expect(uniqueOutlets([{ outlet: 'A' }, { outlet: 'B' }, { outlet: 'A' }])).toEqual(['A', 'B']);
  });

  it('a les libellés des trois éditions et des neuf puces', () => {
    expect(T.fr.subjects(1)).toBe('1 sujet');
    expect(T.en.subjects(2)).toBe('2 stories');
    expect(T.es.episodes(3)).toBe('3 episodios');
    for (const lang of ['fr', 'en', 'es'] as const) expect(Object.keys(CHIP_LABELS[lang])).toHaveLength(9);
  });
});
```

- [ ] **Étape 2 : vérifier l'échec**

Commande : `npx vitest run --project web apps/web/test/lib/format.test.ts`
Attendu : échec, `Failed to resolve import "@/lib/dates"`.

- [ ] **Étape 3 : implémenter**

Fichier `apps/web/lib/dates.ts` :

```ts
/** Dates civiles (AAAA-MM-JJ) et heures de Paris. Aucune date civile ne passe par le fuseau du serveur. */

export const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Vrai pour une date civile valide (« 2026-02-30 » est refusée). */
export function isIsoDate(s: string): boolean {
  if (!ISO_DATE.test(s)) return false;
  const d = new Date(`${s}T12:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

/** Date du jour à Paris. */
export function parisToday(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

/** Heure de Paris d'un horodatage ISO (« 05:41 »). */
export function parisTime(iso: string): string {
  return new Intl.DateTimeFormat('fr-FR', { timeZone: 'Europe/Paris', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(iso));
}

const civil = (iso: string) => new Date(`${iso}T12:00:00Z`);
const fmt = (locale: string, opts: Intl.DateTimeFormatOptions) => (iso: string) => new Intl.DateTimeFormat(locale, { ...opts, timeZone: 'UTC' }).format(civil(iso));

/** En-tête de l'appli : « VEN 06.11.26 ». */
export function headerDate(iso: string): string {
  const day = fmt('fr-FR', { weekday: 'short' })(iso).replace('.', '').slice(0, 3).toUpperCase();
  const [y, m, d] = iso.split('-');
  return `${day} ${d}.${m}.${y.slice(2)}`;
}

/** Date courte d'une ligne de frise ou de vocabulaire : « Ven 6 nov. », « Thu 5 Nov », « Mar 3 nov ». */
export function shortDate(iso: string, lang: 'fr' | 'en' | 'es'): string {
  const locale = { fr: 'fr-FR', en: 'en-GB', es: 'es-ES' }[lang];
  const s = fmt(locale, { weekday: 'short', day: 'numeric', month: 'short' })(iso).replace(/,/g, '');
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Date longue en français : « vendredi 6 novembre 2026 ». */
export const longDateFr = fmt('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

/** Mois en français : « novembre 2026 ». */
export const monthFr = (yyyyMm: string) => fmt('fr-FR', { month: 'long', year: 'numeric' })(`${yyyyMm}-01`);

/** Décale une date civile de `days` jours. */
export function addDays(iso: string, days: number): string {
  const d = civil(iso);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
```

Fichier `apps/web/lib/i18n.ts` :

```ts
import type { Lang, RubricKey } from '@daily-brief/schema';

/** Libellés de l'édition, repris de reference/render.mjs (T) et de design/maquette-v2.html. */
export type EditionStrings = {
  label: string;
  all: string;
  ai: string;
  read: string;
  sources: string;
  briefs: string;
  empty: string;
  listen: string;
  pause: string;
  translation: string;
  infos: string;
  subjects: (n: number) => string;
  full: string;
  title: string;
  diverge: string;
  prepa: string;
  follow: string;
  following: string;
  episodes: (n: number) => string;
  light: string;
  yesterday: (date: string) => string;
};

export const T: Record<Lang, EditionStrings> = {
  fr: {
    label: 'Français',
    all: 'Tout',
    ai: 'Résumé IA · d’après les sources citées',
    read: 'Lire',
    sources: 'sources',
    briefs: 'En bref',
    empty: 'Rien de marquant dans cette rubrique ce matin.',
    listen: 'Écouter',
    pause: 'Pause',
    translation: 'Traduction',
    infos: 'infos',
    subjects: (n) => (n > 1 ? `${n} sujets` : `${n} sujet`),
    full: 'lu en entier',
    title: 'titre + lien',
    diverge: 'Les chiffres divergent',
    prepa: 'Lien prépa',
    follow: 'Suivre ce thread',
    following: 'Thread suivi',
    episodes: (n) => (n > 1 ? `${n} épisodes` : `${n} épisode`),
    light: 'Édition allégée : peu de sources lisibles ce matin.',
    yesterday: (d) => `Brief de la veille (${d}) : l’édition du jour n’est pas encore disponible.`,
  },
  en: {
    label: 'English',
    all: 'All',
    ai: 'AI summary · based on cited sources',
    read: 'Read',
    sources: 'sources',
    briefs: 'In brief',
    empty: 'Nothing major in this section this morning.',
    listen: 'Listen',
    pause: 'Pause',
    translation: 'Translation',
    infos: 'stories',
    subjects: (n) => (n > 1 ? `${n} stories` : `${n} story`),
    full: 'read in full',
    title: 'headline + link',
    diverge: 'Sources differ',
    prepa: 'Lien prépa',
    follow: 'Follow this thread',
    following: 'Following',
    episodes: (n) => (n > 1 ? `${n} episodes` : `${n} episode`),
    light: 'Light edition: few readable sources this morning.',
    yesterday: (d) => `Yesterday’s brief (${d}): today’s edition is not available yet.`,
  },
  es: {
    label: 'Español',
    all: 'Todo',
    ai: 'Resumen IA · según las fuentes citadas',
    read: 'Leer',
    sources: 'fuentes',
    briefs: 'En breve',
    empty: 'Nada destacado en esta sección esta mañana.',
    listen: 'Escuchar',
    pause: 'Pausa',
    translation: 'Traducción',
    infos: 'temas',
    subjects: (n) => (n > 1 ? `${n} temas` : `${n} tema`),
    full: 'leído entero',
    title: 'titular + enlace',
    diverge: 'Las cifras difieren',
    prepa: 'Lien prépa',
    follow: 'Seguir este hilo',
    following: 'Hilo seguido',
    episodes: (n) => (n > 1 ? `${n} episodios` : `${n} episodio`),
    light: 'Edición reducida: pocas fuentes legibles esta mañana.',
    yesterday: (d) => `Brief del día anterior (${d}): la edición de hoy aún no está disponible.`,
  },
};

/** Libellés courts des puces de rubriques (maquette), distincts des titres de rubrique. */
export const CHIP_LABELS: Record<Lang, Record<RubricKey, string>> = {
  fr: { pol: 'Politique & société', int: 'International', eco: 'Économie', ent: 'Entreprises', dro: 'Droit', tec: 'Tech & IA', env: 'Environnement', cul: 'Culture', spo: 'Sport' },
  en: { pol: 'Politics & society', int: 'World', eco: 'Economy', ent: 'Business', dro: 'Law', tec: 'Tech & AI', env: 'Environment', cul: 'Culture', spo: 'Sport' },
  es: { pol: 'Política', int: 'Internacional', eco: 'Economía', ent: 'Empresas', dro: 'Derecho', tec: 'Tecnología', env: 'Medio ambiente', cul: 'Cultura', spo: 'Deporte' },
};

/** Région affichée sous chaque onglet d'édition quand l'édition n'est pas chargée. */
export const REGION: Record<Lang, string> = { fr: 'France · Monde', en: 'US · UK', es: 'España' };

/** Guillemets des citations (comme packages/render-pdf). */
export const QUOTE_MARKS: Record<Lang, [string, string]> = { fr: ['« ', ' »'], en: ['“', '”'], es: ['« ', ' »'] };

const PALETTE = ['#0F3B85', '#B8860B', '#7A1F2B', '#1F6F5C', '#5B3FA0', '#A23B12', '#2E5E9E', '#6B6B1F', '#8A2E62', '#305C2E'];

/** Couleur de la pastille d'un média, stable (même calcul que le prototype). */
export const favColor = (outlet: string) => PALETTE[[...outlet].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7) % PALETTE.length];

/** Initiales d'un média (« Sud Radio · AFP » → « SR »). */
export const initials = (outlet: string) =>
  outlet
    .split(/[\s·]+/)
    .filter((w) => /^[A-Za-zÀ-ÿ]/.test(w))
    .slice(0, 2)
    .map((w) => w[0].toUpperCase())
    .join('');

/** Médias distincts, dans l'ordre d'apparition. */
export const uniqueOutlets = (sources: { outlet: string }[]) => [...new Set(sources.map((s) => s.outlet))];
```

- [ ] **Étape 4 : vérifier le succès**

Commande : `npx vitest run --project web apps/web/test/lib/format.test.ts`
Attendu : `Tests  5 passed (5)`.

Commande : `npm test && npm run typecheck`
Attendu : `Test Files  80 passed (80)`, `Tests  832 passed (832)`, typage sans erreur.

- [ ] **Étape 5 : commit**

```bash
git add apps/web/lib/dates.ts apps/web/lib/i18n.ts apps/web/test/lib/format.test.ts
git commit -m "feat(web): dates de Paris, libellés FR/EN/ES et pastilles des médias"
```

---

### Tâche 3 : modèles d'affichage et lignes de la base, vérifiés sur PGlite

**Fichiers :**
- Créer : `apps/web/lib/data/types.ts`, `apps/web/lib/data/ids.ts`, `apps/web/lib/data/rows.ts`, `apps/web/lib/data/fixture-edition.ts`
- Test : `apps/web/test/data/rows.test.ts`, `apps/web/test/data/pg-rows.ts`, `apps/web/test/data/roundtrip.test.ts`

Comportement attendu :
- **Modèles.** `types.ts` décrit tout ce que les pages affichent et l'interface `DataSource` (implémentée aux tâches 4 et 5).
- **Validation.** `rows.ts` valide par zod les lignes que renvoie PostgREST (dates « AAAA-MM-JJ », horodatages ISO, jsonb) et les convertit. Une ligne invalide est écartée et décrite dans `problems`, jamais une exception.
- **Rangement.** Sujets et sources par `position`, brèves par rubrique dans l'ordre de `editions.sections`. `status = 'light'` donne `light: true` ; `audio_path` nul donne `hasAudio: false`.
- **URL.** Toute URL doit être en http(s) : une source `javascript:` est écartée, et un sujet resté sans source aussi. Une photo n'est affichée que depuis `https://images.pexels.com`.
- **Équivalence.** `editionFromFixture` (mode fixture) et `editionFromRows` (base) donnent le même résultat pour les trois éditions publiées par la vraie `publish_edition`, lues sous RLS comme l'utilisateur autorisé.

- [ ] **Étape 1 : écrire les tests**

`pg-rows.ts` réutilise l'outillage PGlite du lot 4 (`pipeline/test/supabase/pg.ts`) et `editionPayload` (`pipeline/publish/rows.ts`), en lecture seule. Les requêtes reproduisent la forme JSON de PostgREST (`to_jsonb`) et les `select` de la tâche 5 (Thread embarqué sous `thread`).

Fichier `apps/web/test/data/pg-rows.ts` :

```ts
import type { Lang } from '@daily-brief/schema';
import { editionPayload } from '../../../../pipeline/publish/rows';
import { fixtureBrief } from '../../../../pipeline/test/helpers';
import { ALLOWED_EMAIL, asRole, rpc, type TestDb } from '../../../../pipeline/test/supabase/pg';

/** Publie les trois éditions de la fixture avec la vraie fonction `publish_edition` (clé service). */
export async function publishFixture(db: TestDb, meta: { light?: Lang[]; audio?: Lang[] } = {}): Promise<void> {
  for (const ed of fixtureBrief().editions) {
    const payload = editionPayload(ed, {
      pdfPath: `${ed.date}/daily-brief-${ed.date}.pdf`,
      audioPath: meta.audio?.includes(ed.lang) ? `${ed.date}/${ed.lang}.mp3` : null,
      light: meta.light?.includes(ed.lang) ?? false,
      generatedAt: '2026-11-06T04:41:00Z',
    });
    await rpc(db, 'publish_edition', { payload });
  }
}

/** Requête lancée comme l'utilisateur autorisé (RLS active), chaque ligne en JSON comme PostgREST. */
export async function asUserJson<T = Record<string, unknown>>(db: TestDb, sql: string, params: unknown[] = []): Promise<T[]> {
  return asRole(db, { email: ALLOWED_EMAIL }, async (tx) => (await tx.query<{ j: T }>(sql, params)).rows.map((r) => r.j));
}

/**
 * Lignes d'une édition, de la forme que renvoient les `select` de lib/data/supabase.ts :
 * stories avec `thread:threads(id,title)` embarqué.
 */
export async function editionRows(db: TestDb, date: string, lang: Lang) {
  const [edition] = await asUserJson(db, `select to_jsonb(e) - 'published_at' as j from public.editions e where date = $1 and lang = $2`, [date, lang]);
  const id = (edition as { id: string }).id;
  const stories = await asUserJson(
    db,
    `select to_jsonb(s) || jsonb_build_object('thread', (select jsonb_build_object('id', t.id, 'title', t.title) from public.threads t where t.id = s.thread_id)) as j
     from public.stories s where edition_id = $1 order by position`,
    [id],
  );
  const sources = await asUserJson(db, `select to_jsonb(x) - 'id' - 'edition_id' as j from public.sources x where edition_id = $1 order by position`, [id]);
  const vocab = await asUserJson(db, `select to_jsonb(v) - 'edition_id' - 'lang' as j from public.vocab_items v where edition_id = $1 order by position`, [id]);
  return { edition, stories, sources, vocab };
}
```

Fichier `apps/web/test/data/roundtrip.test.ts` :

```ts
// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Lang } from '@daily-brief/schema';
import { editionFromFixture } from '@/lib/data/fixture-edition';
import { EditionRowSchema, editionFromRows, parseRows, SourceRowSchema, StoryRowSchema, VocabRowSchema } from '@/lib/data/rows';
import type { EditionView } from '@/lib/data/types';
import { fixtureBrief } from '../../../../pipeline/test/helpers';
import { createTestDb, type TestDb } from '../../../../pipeline/test/supabase/pg';
import { editionRows, publishFixture } from './pg-rows';

/** Identifiants propres à chaque source (uuid de la base, uuid stables de la fixture) : hors comparaison. */
const withoutIds = (e: EditionView) => ({
  ...e,
  sections: e.sections.map((s) => ({ ...s, stories: s.stories.map((st) => ({ ...st, thread: st.thread && { ...st.thread, id: '-' } })) })),
  vocab: e.vocab && { ...e.vocab, words: e.vocab.words.map((w) => ({ ...w, id: '-' })) },
});

let db: TestDb;
beforeAll(async () => {
  db = await createTestDb();
  await publishFixture(db, { audio: ['fr', 'en'], light: ['es'] });
}, 60_000);
afterAll(async () => db.close());

describe('aller-retour Supabase ↔ fixture', () => {
  for (const lang of ['fr', 'en', 'es'] as Lang[]) {
    it(`l’édition ${lang} relue en base est celle de la fixture`, async () => {
      const raw = await editionRows(db, '2026-11-06', lang);
      const mapped = editionFromRows({
        edition: EditionRowSchema.parse(raw.edition),
        stories: parseRows(StoryRowSchema, raw.stories, 'sujet').value,
        sources: parseRows(SourceRowSchema, raw.sources, 'source').value,
        vocab: parseRows(VocabRowSchema, raw.vocab, 'mot').value,
      });
      expect(mapped.problems).toEqual([]);
      const ed = fixtureBrief().editions.find((e) => e.lang === lang)!;
      const expected = editionFromFixture(ed, { light: lang === 'es', hasAudio: lang !== 'es', hasPdf: true, generatedAt: '-' });
      expect(withoutIds({ ...mapped.value, generatedAt: '-' })).toEqual(withoutIds(expected));
      expect(mapped.value.generatedAt).toMatch(/^2026-11-06T04:41:00/);
    });
  }
});
```

Fichier `apps/web/test/data/rows.test.ts` :

```ts
import { describe, expect, it } from 'vitest';
import { stableUuid } from '@/lib/data/ids';
import { editionFromRows, parseRows, pexelsSrc, safeUrl, StoryRowSchema, threadFromRow, type EditionRow, type SourceRow, type StoryRow } from '@/lib/data/rows';

const edition: EditionRow = {
  id: 'e1',
  date: '2026-11-06',
  lang: 'fr',
  region: 'France · Monde',
  headline: 'Titre',
  morning_brief: [],
  sections: [
    { key: 'pol', title: 'Politique & société' },
    { key: 'dro', title: 'Droit & justice' },
  ],
  vocab_title: null,
  audio_path: null,
  pdf_path: '2026-11-06/daily-brief-2026-11-06.pdf',
  status: 'light',
  generated_at: '2026-11-06T04:41:00+00:00',
};

const visual = { type: 'photo', query: 'train' };
const story = (over: Partial<StoryRow> = {}): StoryRow => ({
  id: 's1',
  key: '2026-11-06-fr-1',
  rubric: 'pol',
  position: 1,
  kicker: 'France',
  date_label: '05.11',
  title: 'Sujet',
  summary: 'Résumé',
  visual,
  stats: [],
  quote: null,
  divergences: [],
  prepa: null,
  thread_id: null,
  thread_subtitle: null,
  thread: null,
  ...over,
});
const source = (over: Partial<SourceRow> = {}): SourceRow => ({
  story_id: 's1',
  rubric: 'pol',
  position: 1,
  outlet: 'Euronews',
  title: 'Article',
  url: 'https://www.euronews.com/a',
  lang: 'fr',
  read_full: true,
  published_at: null,
  ...over,
});

describe('lignes Supabase → affichage', () => {
  it('range sujets, sources et brèves par rubrique, dans l’ordre des positions', () => {
    const { value, problems } = editionFromRows({
      edition,
      stories: [story()],
      sources: [source({ position: 2, outlet: 'B' }), source({ position: 1, outlet: 'A' }), source({ story_id: null, rubric: 'dro', outlet: 'Brève' })],
      vocab: [],
    });
    expect(problems).toEqual([]);
    expect(value.sections.map((s) => [s.key, s.stories.length, s.briefs.length])).toEqual([
      ['pol', 1, 0],
      ['dro', 0, 1],
    ]);
    expect(value.sections[0].stories[0].sources.map((s) => s.outlet)).toEqual(['A', 'B']);
    expect(value).toMatchObject({ light: true, hasAudio: false, hasPdf: true, vocab: null });
  });

  it('écarte une source javascript: et un sujet resté sans source', () => {
    const { value, problems } = editionFromRows({ edition, stories: [story()], sources: [source({ url: 'javascript:alert(1)' })], vocab: [] });
    expect(value.sections[0].stories).toEqual([]);
    expect(problems).toHaveLength(2);
  });

  it('écarte un sujet au visuel invalide sans casser l’édition', () => {
    const { value, problems } = editionFromRows({ edition, stories: [story({ visual: { type: 'video' } })], sources: [source()], vocab: [] });
    expect(value.sections[0].stories).toEqual([]);
    expect(problems[0]).toMatch(/2026-11-06-fr-1 ignoré/);
  });

  it('écarte les lignes mal formées', () => {
    const r = parseRows(StoryRowSchema, [story(), { id: 1 }], 'sujet');
    expect(r.value).toHaveLength(1);
    expect(r.problems).toHaveLength(1);
    expect(parseRows(StoryRowSchema, null, 'sujet').problems).toEqual(['sujet : réponse inattendue']);
  });

  it('n’accepte que des URL http(s) et des photos https de images.pexels.com', () => {
    expect(safeUrl('https://a.fr/x')).toBe('https://a.fr/x');
    expect(safeUrl('data:text/html,x')).toBeNull();
    expect(pexelsSrc('https://images.pexels.com/photos/1/a.jpeg?w=800')).toBe('https://images.pexels.com/photos/1/a.jpeg?w=800');
    expect(pexelsSrc('http://images.pexels.com/a.jpg')).toBeNull();
    expect(pexelsSrc('https://images.pexels.com.evil.fr/a.jpg')).toBeNull();
    expect(pexelsSrc('https://169.254.169.254/latest')).toBeNull();
    expect(pexelsSrc(undefined)).toBeNull();
  });

  it('construit une frise du plus récent au plus ancien, avec la carte et la première source', () => {
    const t = threadFromRow({
      id: 't1',
      title: 'Midterms 2026',
      lang: 'en',
      status: 'open',
      followed: false,
      thread_events: [
        { date: '2026-11-04', title: 'Avant', text: '', story: null },
        {
          date: '2026-11-06',
          title: 'Après',
          text: 'Suite',
          story: { rubric: 'pol', visual: { type: 'map', caption: 'US', map: { projection: 'albers-usa', places: [] } }, sources: [{ outlet: 'CBS', url: 'https://cbs.com/a', position: 1 }] },
        },
      ],
    });
    expect(t.events.map((e) => e.title)).toEqual(['Après', 'Avant']);
    expect(t.events[0]).toMatchObject({ rubric: 'pol', source: { outlet: 'CBS' }, map: { caption: 'US' } });
    expect(t).toMatchObject({ eventCount: 2, lastDate: '2026-11-06', lastTitle: 'Après' });
  });

  it('fabrique des uuid stables', () => {
    expect(stableUuid('a')).toBe(stableUuid('a'));
    expect(stableUuid('a')).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });
});
```

- [ ] **Étape 2 : vérifier l'échec**

Commande : `npx vitest run --project web apps/web/test/data`
Attendu : échec des deux fichiers de test, `Failed to resolve import "@/lib/data/…"`.

- [ ] **Étape 3 : implémenter**

Fichier `apps/web/lib/data/types.ts` :

```ts
import type { Divergence, Lang, MapSpec, MorningBriefItem, Prepa, Quote, RubricKey, SourceRef, Stat, Visual } from '@daily-brief/schema';

/**
 * Modèles d'affichage, communs aux deux sources de données (fixture et Supabase). Les pages ne voient
 * que ces types : le mode fixture et le mode Supabase rendent exactement les mêmes écrans.
 */

export type AnkiStatus = 'none' | 'queued' | 'sent';

export type StoryView = {
  /** Clé du sujet dans l'édition (`stories.key`, « 2026-11-06-fr-1 »). */
  id: string;
  kicker: string;
  date: string;
  title: string;
  summary: string;
  visual: Visual;
  stats: Stat[];
  quote: Quote | null;
  divergences: Divergence[];
  /** `id` : identifiant du Thread (uuid), pour le lien vers sa frise. */
  thread: { id: string; title: string; subtitle: string } | null;
  prepa: Prepa | null;
  sources: SourceRef[];
};

export type SectionView = { key: RubricKey; title: string; stories: StoryView[]; briefs: SourceRef[] };

export type VocabWord = {
  id: string;
  term: string;
  pos: string;
  translation: string;
  example: string;
  sourceUrl: string | null;
  selected: boolean;
  ankiStatus: AnkiStatus;
};

export type EditionView = {
  date: string;
  lang: Lang;
  region: string;
  headline: string;
  morningBrief: MorningBriefItem[];
  sections: SectionView[];
  vocab: { title: string; words: VocabWord[] } | null;
  /** `editions.status = 'light'` : édition allégée (spec §12). */
  light: boolean;
  /** `audio_path` présent : lecteur affiché. */
  hasAudio: boolean;
  hasPdf: boolean;
  generatedAt: string;
};

/** Un jour de l'archive : éditions publiées et éditions allégées. */
export type EditionDay = { date: string; langs: Lang[]; light: Lang[] };

export type ThreadSummary = {
  id: string;
  title: string;
  lang: Lang;
  status: 'open' | 'closed';
  followed: boolean;
  eventCount: number;
  lastDate: string | null;
  lastTitle: string | null;
};

export type ThreadEventView = {
  date: string;
  title: string;
  text: string;
  /** Rubrique du sujet lié (kicker de la frise), première source et carte éventuelle. */
  rubric: RubricKey | null;
  source: { outlet: string; url: string } | null;
  map: { spec: MapSpec; caption: string } | null;
};

/** Frise : événements du plus récent au plus ancien. */
export type ThreadDetail = ThreadSummary & { events: ThreadEventView[] };

export type VocabEntry = VocabWord & { date: string; lang: Lang };
export type VocabFilter = { lang?: Lang; date?: string; selected?: boolean };

export type RunStatus = 'running' | 'ok' | 'degraded' | 'failed';

/** Ligne `runs` telle qu'en base (steps validé à la lecture, voir lib/runs.ts). */
export type RunRecord = { date: string; status: RunStatus; steps: unknown; notes: string | null; updatedAt: string };

/** Fichier du jour : redirection vers une URL signée, ou octets servis directement (mode fixture). */
export type FileTarget = { kind: 'redirect'; url: string } | { kind: 'bytes'; body: Uint8Array; contentType: string };

export interface DataSource {
  readonly kind: 'fixture' | 'supabase';
  /** Date du jour à Paris (mode fixture : date de la fixture). */
  today(): string;
  edition(date: string, lang: Lang): Promise<EditionView | null>;
  /** Dernière date publiée pour la langue, au plus tard `onOrBefore`. */
  latestDate(lang: Lang, onOrBefore: string): Promise<string | null>;
  /** Jours publiés entre deux dates incluses, du plus ancien au plus récent. */
  days(from: string, to: string): Promise<EditionDay[]>;
  threads(): Promise<ThreadSummary[]>;
  thread(id: string): Promise<ThreadDetail | null>;
  vocab(filter: VocabFilter): Promise<VocabEntry[]>;
  runs(limit: number): Promise<RunRecord[]>;
  /** Écritures permises par la RLS : renvoient le nombre de lignes modifiées. */
  setSelected(ids: string[], selected: boolean): Promise<number>;
  queueAnki(ids: string[]): Promise<number>;
  setFollowed(id: string, followed: boolean): Promise<number>;
  audio(date: string, lang: Lang): Promise<FileTarget | null>;
  pdf(date: string): Promise<FileTarget | null>;
}
```

Fichier `apps/web/lib/data/ids.ts` :

```ts
import { createHash } from 'node:crypto';

/** Identifiant stable au format uuid (version 5, variante RFC) tiré d'une graine : ids du mode fixture. */
export function stableUuid(seed: string): string {
  const h = createHash('sha1').update(seed).digest('hex').slice(0, 32).split('');
  h[12] = '5';
  h[16] = ((parseInt(h[16], 16) & 0x3) | 0x8).toString(16);
  const s = h.join('');
  return `${s.slice(0, 8)}-${s.slice(8, 12)}-${s.slice(12, 16)}-${s.slice(16, 20)}-${s.slice(20)}`;
}
```

Fichier `apps/web/lib/data/rows.ts` :

```ts
import { z } from 'zod';
import {
  DivergenceSchema,
  IsoDateSchema,
  LangSchema,
  MorningBriefItemSchema,
  PrepaSchema,
  QuoteSchema,
  RubricKeySchema,
  StatSchema,
  UrlSchema,
  VisualSchema,
  type Lang,
  type SourceRef,
} from '@daily-brief/schema';
import type { EditionView, RunRecord, SectionView, StoryView, ThreadDetail, ThreadEventView, ThreadSummary, VocabEntry, VocabWord } from './types';

/**
 * Lignes telles que PostgREST les renvoie (JSON : dates « AAAA-MM-JJ », horodatages ISO), validées
 * par zod, puis converties en modèles d'affichage. Une ligne invalide n'interrompt jamais une page :
 * elle est écartée et signalée dans `problems`. Les URL doivent être en http(s) : une source
 * `javascript:` n'atteint jamais un attribut href.
 */

const Uuid = z.string().min(1);
const Timestamp = z.string().min(1);

export const EditionRowSchema = z.object({
  id: Uuid,
  date: IsoDateSchema,
  lang: LangSchema,
  region: z.string(),
  headline: z.string(),
  morning_brief: z.array(MorningBriefItemSchema),
  sections: z.array(z.object({ key: RubricKeySchema, title: z.string().min(1) })),
  vocab_title: z.string().nullable(),
  audio_path: z.string().nullable(),
  pdf_path: z.string().nullable(),
  status: z.enum(['published', 'light']),
  generated_at: Timestamp,
});

export const StoryRowSchema = z.object({
  id: Uuid,
  key: z.string().min(1),
  rubric: RubricKeySchema,
  position: z.number().int(),
  kicker: z.string(),
  date_label: z.string(),
  title: z.string().min(1),
  summary: z.string(),
  visual: z.unknown(),
  stats: z.unknown(),
  quote: z.unknown(),
  divergences: z.unknown(),
  prepa: z.unknown(),
  thread_id: Uuid.nullable(),
  thread_subtitle: z.string().nullable(),
  thread: z.object({ id: Uuid, title: z.string().min(1) }).nullable(),
});

export const SourceRowSchema = z.object({
  story_id: Uuid.nullable(),
  rubric: RubricKeySchema,
  position: z.number().int(),
  outlet: z.string().min(1),
  title: z.string().min(1),
  url: z.string(),
  lang: z.string(),
  read_full: z.boolean(),
  published_at: z.string().nullable(),
});

export const VocabRowSchema = z.object({
  id: Uuid,
  position: z.number().int(),
  term: z.string().min(1),
  pos: z.string(),
  translation: z.string(),
  example: z.string(),
  source_url: z.string().nullable(),
  selected: z.boolean(),
  anki_status: z.enum(['none', 'queued', 'sent']),
});

export type EditionRow = z.infer<typeof EditionRowSchema>;
export type StoryRow = z.infer<typeof StoryRowSchema>;
export type SourceRow = z.infer<typeof SourceRowSchema>;
export type VocabRow = z.infer<typeof VocabRowSchema>;

export type Mapped<T> = { value: T; problems: string[] };

/** Valide une liste de lignes : les invalides sont écartées et décrites. */
export function parseRows<T>(schema: z.ZodType<T>, rows: unknown, what: string): Mapped<T[]> {
  const problems: string[] = [];
  if (!Array.isArray(rows)) return { value: [], problems: [`${what} : réponse inattendue`] };
  const value: T[] = [];
  rows.forEach((r, i) => {
    const p = schema.safeParse(r);
    if (p.success) value.push(p.data);
    else problems.push(`${what} ${i} ignoré : ${p.error.issues[0]?.message ?? 'invalide'}`);
  });
  return { value, problems };
}

/** URL http(s) seulement, sinon null. */
export function safeUrl(url: string | null | undefined): string | null {
  return typeof url === 'string' && UrlSchema.safeParse(url).success ? url : null;
}

/** Photo affichable : seulement une image https de images.pexels.com (CSP img-src), sinon null. */
export function pexelsSrc(src: string | undefined): string | null {
  if (!src) return null;
  try {
    const u = new URL(src);
    return u.protocol === 'https:' && u.hostname === 'images.pexels.com' && !u.username && !u.password ? u.href : null;
  } catch {
    return null;
  }
}

const sourceOf = (r: SourceRow): SourceRef | null => {
  const url = safeUrl(r.url);
  if (!url) return null;
  return { outlet: r.outlet, title: r.title, url, lang: r.lang, readFull: r.read_full, ...(r.published_at ? { publishedAt: r.published_at } : {}) };
};

const byPosition = <T extends { position: number }>(a: T, b: T) => a.position - b.position;

const StoryJson = z.object({
  visual: VisualSchema,
  stats: z.array(StatSchema),
  quote: QuoteSchema.nullable(),
  divergences: z.array(DivergenceSchema),
  prepa: PrepaSchema.nullable(),
});

/** Lignes d'une édition → modèle d'affichage (fonction pure). */
export function editionFromRows(input: { edition: EditionRow; stories: StoryRow[]; sources: SourceRow[]; vocab: VocabRow[] }): Mapped<EditionView> {
  const { edition: e } = input;
  const problems: string[] = [];
  const storySources = new Map<string, SourceRef[]>();
  const briefs = new Map<string, SourceRef[]>();
  for (const r of [...input.sources].sort(byPosition)) {
    const s = sourceOf(r);
    if (!s) {
      problems.push(`source « ${r.title} » ignorée : URL refusée`);
      continue;
    }
    const map = r.story_id ? storySources : briefs;
    const key = r.story_id ?? r.rubric;
    map.set(key, [...(map.get(key) ?? []), s]);
  }

  const storiesByRubric = new Map<string, StoryView[]>();
  for (const r of [...input.stories].sort(byPosition)) {
    const json = StoryJson.safeParse({ visual: r.visual, stats: r.stats ?? [], quote: r.quote ?? null, divergences: r.divergences ?? [], prepa: r.prepa ?? null });
    const sources = storySources.get(r.id) ?? [];
    if (!json.success || sources.length === 0) {
      problems.push(`sujet ${r.key} ignoré : ${json.success ? 'aucune source valide' : json.error.issues[0]?.message}`);
      continue;
    }
    const story: StoryView = {
      id: r.key,
      kicker: r.kicker,
      date: r.date_label,
      title: r.title,
      summary: r.summary,
      ...json.data,
      thread: r.thread ? { id: r.thread.id, title: r.thread.title, subtitle: r.thread_subtitle ?? '' } : null,
      sources,
    };
    storiesByRubric.set(r.rubric, [...(storiesByRubric.get(r.rubric) ?? []), story]);
  }

  const sections: SectionView[] = e.sections.map((s) => ({ key: s.key, title: s.title, stories: storiesByRubric.get(s.key) ?? [], briefs: briefs.get(s.key) ?? [] }));
  const words: VocabWord[] = [...input.vocab].sort(byPosition).map((v) => ({
    id: v.id,
    term: v.term,
    pos: v.pos,
    translation: v.translation,
    example: v.example,
    sourceUrl: safeUrl(v.source_url),
    selected: v.selected,
    ankiStatus: v.anki_status,
  }));
  return {
    value: {
      date: e.date,
      lang: e.lang,
      region: e.region,
      headline: e.headline,
      morningBrief: e.morning_brief,
      sections,
      vocab: e.vocab_title !== null ? { title: e.vocab_title, words } : null,
      light: e.status === 'light',
      hasAudio: e.audio_path !== null,
      hasPdf: e.pdf_path !== null,
      generatedAt: e.generated_at,
    },
    problems,
  };
}

export const ThreadRowSchema = z.object({
  id: Uuid,
  title: z.string().min(1),
  lang: LangSchema,
  status: z.enum(['open', 'closed']),
  followed: z.boolean(),
  thread_events: z.array(
    z.object({
      date: IsoDateSchema,
      title: z.string(),
      text: z.string(),
      story: z
        .object({
          rubric: RubricKeySchema,
          visual: z.unknown(),
          sources: z.array(z.object({ outlet: z.string(), url: z.string(), position: z.number().int() })),
        })
        .nullable(),
    }),
  ),
});
export type ThreadRow = z.infer<typeof ThreadRowSchema>;

/** Thread et ses événements → frise, du plus récent au plus ancien (fonction pure). */
export function threadFromRow(r: ThreadRow): ThreadDetail {
  const events: ThreadEventView[] = r.thread_events
    .map((ev) => {
      const visual = ev.story ? VisualSchema.safeParse(ev.story.visual) : null;
      const first = ev.story ? [...ev.story.sources].sort(byPosition).find((s) => safeUrl(s.url)) : undefined;
      return {
        date: ev.date,
        title: ev.title,
        text: ev.text,
        rubric: ev.story?.rubric ?? null,
        source: first ? { outlet: first.outlet, url: first.url } : null,
        map: visual?.success && visual.data.type === 'map' ? { spec: visual.data.map, caption: visual.data.caption } : null,
      };
    })
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  return { ...threadSummary(r), events };
}

export function threadSummary(r: ThreadRow): ThreadSummary {
  const sorted = [...r.thread_events].sort((a, b) => (a.date < b.date ? 1 : -1));
  return {
    id: r.id,
    title: r.title,
    lang: r.lang,
    status: r.status,
    followed: r.followed,
    eventCount: r.thread_events.length,
    lastDate: sorted[0]?.date ?? null,
    lastTitle: sorted[0]?.title ?? null,
  };
}

export const VocabEntryRowSchema = VocabRowSchema.extend({ lang: LangSchema, edition: z.object({ date: IsoDateSchema }) });

export const vocabEntryFromRow = (r: z.infer<typeof VocabEntryRowSchema>): VocabEntry => ({
  id: r.id,
  term: r.term,
  pos: r.pos,
  translation: r.translation,
  example: r.example,
  sourceUrl: safeUrl(r.source_url),
  selected: r.selected,
  ankiStatus: r.anki_status,
  date: r.edition.date,
  lang: r.lang as Lang,
});

export const RunRowSchema = z.object({
  date: IsoDateSchema,
  status: z.enum(['running', 'ok', 'degraded', 'failed']),
  steps: z.unknown(),
  notes: z.string().nullable(),
  updated_at: Timestamp,
});

export const runFromRow = (r: z.infer<typeof RunRowSchema>): RunRecord => ({ date: r.date, status: r.status, steps: r.steps, notes: r.notes, updatedAt: r.updated_at });
```

Fichier `apps/web/lib/data/fixture-edition.ts` :

```ts
import type { Edition } from '@daily-brief/schema';
import { stableUuid } from './ids';
import type { EditionView } from './types';

export type FixtureMeta = { light: boolean; hasAudio: boolean; hasPdf: boolean; generatedAt: string };

/** Identifiant fixture d'un Thread : une langue, un titre (même règle d'unicité que les slugs du lot 4). */
export const fixtureThreadId = (lang: string, title: string) => stableUuid(`thread:${lang}:${title}`);
export const fixtureVocabId = (date: string, lang: string, term: string) => stableUuid(`vocab:${date}:${lang}:${term.trim().toLowerCase()}`);

/**
 * Édition de la fixture → modèle d'affichage. Doit donner exactement ce que donne une édition publiée
 * par `publish_edition` puis relue par `editionFromRows` (aux identifiants près) : c'est vérifié par
 * test/data/roundtrip.test.ts sur un vrai Postgres (PGlite).
 */
export function editionFromFixture(e: Edition, meta: FixtureMeta, state?: Map<string, { selected: boolean; ankiStatus: 'none' | 'queued' | 'sent' }>): EditionView {
  return {
    date: e.date,
    lang: e.lang,
    region: e.region,
    headline: e.headline,
    morningBrief: e.morningBrief,
    sections: e.sections.map((s) => ({
      key: s.key,
      title: s.title,
      stories: s.stories.map((st) => ({
        id: st.id,
        kicker: st.kicker,
        date: st.date,
        title: st.title,
        summary: st.summary,
        visual: st.visual,
        stats: st.stats,
        quote: st.quote,
        divergences: st.divergences,
        thread: st.thread ? { id: fixtureThreadId(e.lang, st.thread.title), title: st.thread.title, subtitle: st.thread.subtitle } : null,
        prepa: st.prepa,
        sources: st.sources,
      })),
      briefs: s.briefs,
    })),
    vocab: e.vocab
      ? {
          title: e.vocab.title,
          words: e.vocab.items.map((v) => {
            const id = fixtureVocabId(e.date, e.lang, v.term);
            const st = state?.get(id);
            return {
              id,
              term: v.term,
              pos: v.pos,
              translation: v.translation,
              example: v.example,
              sourceUrl: v.sourceUrl ?? null,
              selected: st?.selected ?? false,
              ankiStatus: st?.ankiStatus ?? 'none',
            };
          }),
        }
      : null,
    ...meta,
  };
}
```

- [ ] **Étape 4 : vérifier le succès**

Commande : `npx vitest run --project web apps/web/test/data`
Attendu : `Test Files  2 passed (2)`, `Tests  10 passed (10)`.

Commande : `npm test && npm run typecheck`
Attendu : `Test Files  82 passed (82)`, `Tests  842 passed (842)`, typage sans erreur.

- [ ] **Étape 5 : commit**

```bash
git add apps/web/lib/data/types.ts apps/web/lib/data/ids.ts apps/web/lib/data/rows.ts apps/web/lib/data/fixture-edition.ts apps/web/test/data/rows.test.ts apps/web/test/data/pg-rows.ts apps/web/test/data/roundtrip.test.ts
git commit -m "feat(web): modèles d'affichage et lignes de la base, équivalence fixture/Supabase sur PGlite"
```

---

### Tâche 4 : source de données du mode fixture

**Fichiers :**
- Créer : `apps/web/lib/data/fixture.ts`
- Test : `apps/web/test/data/fixture.test.ts`

Comportement attendu :
- **Fichiers lus.** `FixtureDataSource` lit `fixtures/brief-2026-11-06.json` (validé par `parseBrief`) et `fixtures/threads-2026-11-06.json`. Il trouve `fixtures/` en remontant depuis le dossier courant : racine pour Vitest, `apps/web` pour `next start`.
- **Éditions.** Les trois éditions sont servies pour le 6 novembre et rien d'autre. FR et EN ont un MP3, ES non ; aucun PDF. `light` est réglable, pour le bandeau.
- **Threads.** Ce sont ceux des sujets du jour, avec les épisodes passés du fichier des Threads, dont les dates sont lues dans les libellés (« Mar 20 oct » → `2026-10-20`). L'épisode « À suivre » n'est pas repris.
- **Écritures.** Mots cochés, file Anki et Threads suivis restent en mémoire du processus. Un identifiant inconnu ne modifie rien, et un mot déjà en file n'est pas compté deux fois.
- **Fichiers servis.** L'audio est un MP3 silencieux de 3 s (trames MPEG-2 valides), pour que le lecteur lise une vraie durée.
- **Passages `runs`.** Trois : réussi, dégradé (Drive en attente), et `running` ancien (interrompu).

- [ ] **Étape 1 : écrire les tests**

Fichier `apps/web/test/data/fixture.test.ts` :

```ts
// @vitest-environment node
import { beforeEach, describe, expect, it } from 'vitest';
import { FixtureDataSource, nodeDate, resetFixtureState, silentMp3 } from '@/lib/data/fixture';

const ds = () => new FixtureDataSource({ today: '2026-11-06' });

beforeEach(() => resetFixtureState());

describe('source de données du mode fixture', () => {
  it('rend les trois éditions de la fixture, et rien pour une autre date', async () => {
    const fr = await ds().edition('2026-11-06', 'fr');
    expect(fr?.headline).toBe('La rue pousse Lecornu à négocier, le Sud-Est sous l’eau');
    expect(fr?.sections.map((s) => s.key)).toEqual(['pol', 'int', 'env', 'eco', 'ent', 'dro', 'tec', 'spo']);
    expect(fr).toMatchObject({ hasAudio: true, hasPdf: false, light: false, vocab: null });
    expect((await ds().edition('2026-11-06', 'es'))?.hasAudio).toBe(false);
    expect(await ds().edition('2026-11-05', 'fr')).toBeNull();
  });

  it('marque une édition allégée sur demande', async () => {
    const light = new FixtureDataSource({ today: '2026-11-06', light: ['es'] });
    expect((await light.edition('2026-11-06', 'es'))?.light).toBe(true);
    expect(await light.days('2026-11-01', '2026-11-30')).toEqual([{ date: '2026-11-06', langs: ['fr', 'en', 'es'], light: ['es'] }]);
  });

  it('trouve la dernière date publiée jusqu’à une date donnée', async () => {
    expect(await ds().latestDate('fr', '2026-11-07')).toBe('2026-11-06');
    expect(await ds().latestDate('fr', '2026-11-05')).toBeNull();
  });

  it('lit les dates des épisodes passés', () => {
    expect(nodeDate('Mar 20 oct', '2026')).toBe('2026-10-20');
    expect(nodeDate('Wed 04 Nov', '2026')).toBe('2026-11-04');
    expect(nodeDate('Dom 18 ene', '2026')).toBe('2026-01-18');
    expect(nodeDate('À suivre', '2026')).toBeNull();
  });

  it('construit les Threads du jour avec leurs épisodes passés', async () => {
    const list = await ds().threads();
    expect(list.map((t) => `${t.lang}:${t.title}`).sort()).toEqual([
      'en:Midterms 2026',
      'es:Crisis ferroviaria 2026',
      'fr:Guerre en Ukraine',
      'fr:Midterms 2026',
      'fr:Mobilisation sociale de l’automne',
      'fr:Épisodes méditerranéens 2026',
    ]);
    const floods = list.find((t) => t.title === 'Épisodes méditerranéens 2026')!;
    const detail = await ds().thread(floods.id);
    expect(detail?.events.map((e) => e.date)).toEqual(['2026-11-06', '2026-10-20']);
    expect(detail?.events[0].map?.spec.projection).toBe('conic-france');
    expect(await ds().thread('inconnu')).toBeNull();
  });

  it('garde en mémoire mots cochés, file Anki et Threads suivis', async () => {
    const words = await ds().vocab({ lang: 'en' });
    expect(words).toHaveLength(6);
    expect(await ds().setSelected([words[0].id, 'inconnu'], true)).toBe(1);
    expect(await ds().queueAnki([words[1].id])).toBe(1);
    expect(await ds().queueAnki([words[1].id])).toBe(0);
    const after = await ds().vocab({ selected: true });
    expect(after.map((w) => [w.term, w.ankiStatus])).toEqual([
      [words[0].term, 'none'],
      [words[1].term, 'queued'],
    ]);
    const [t] = await ds().threads();
    expect(await ds().setFollowed(t.id, true)).toBe(1);
    expect((await ds().thread(t.id))?.followed).toBe(true);
    expect(await ds().setFollowed('inconnu', true)).toBe(0);
  });

  it('sert un MP3 silencieux pour FR et EN, rien pour ES ni pour le PDF', async () => {
    const audio = await ds().audio('2026-11-06', 'fr');
    expect(audio?.kind).toBe('bytes');
    expect(await ds().audio('2026-11-06', 'es')).toBeNull();
    expect(await ds().pdf()).toBeNull();
    const mp3 = silentMp3(3);
    expect([...mp3.slice(0, 4)]).toEqual([0xff, 0xf3, 0x44, 0xc4]);
    expect(mp3.length).toBe(125 * 96);
  });

  it('fournit trois passages : réussi, dégradé, interrompu', async () => {
    expect((await ds().runs(10)).map((r) => r.status)).toEqual(['ok', 'degraded', 'running']);
  });
});
```

- [ ] **Étape 2 : vérifier l'échec**

Commande : `npx vitest run --project web apps/web/test/data/fixture.test.ts`
Attendu : échec, `Failed to resolve import "@/lib/data/fixture"`.

- [ ] **Étape 3 : implémenter**

Fichier `apps/web/lib/data/fixture.ts` :

```ts
import 'server-only';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { z } from 'zod';
import { LANGS, parseBrief, type Brief, type Lang } from '@daily-brief/schema';
import { editionFromFixture, fixtureThreadId, fixtureVocabId } from './fixture-edition';
import type { AnkiStatus, DataSource, EditionDay, EditionView, FileTarget, RunRecord, ThreadDetail, ThreadEventView, ThreadSummary, VocabEntry, VocabFilter } from './types';

/**
 * Source de données du mode FIXTURE=1 : fixtures/brief-2026-11-06.json (trois éditions) et
 * fixtures/threads-2026-11-06.json (épisodes passés des Threads), lus sans réseau. Les écritures
 * (mots cochés, Anki, Threads suivis) restent en mémoire, le temps du processus.
 */

export type FixtureOptions = { today: string; light?: Lang[] };

const ThreadsFixture = z.record(
  z.string(),
  z.object({ title: z.string(), nodes: z.array(z.object({ st: z.string(), d: z.string(), h: z.string(), p: z.string(), src: z.string().optional() })) }),
);

/** Remonte depuis le dossier courant jusqu'au dossier fixtures/ du dépôt (vitest : racine ; next : apps/web). */
export function fixturesDir(start = process.cwd()): string {
  let dir = start;
  for (;;) {
    if (existsSync(join(dir, 'fixtures', 'brief-2026-11-06.json'))) return join(dir, 'fixtures');
    const up = dirname(dir);
    if (up === dir) throw new Error('dossier fixtures/ introuvable');
    dir = up;
  }
}

const MONTHS: Record<string, number> = {
  janv: 1, ene: 1, jan: 1, févr: 2, feb: 2, mars: 3, mar: 3, avr: 4, abr: 4, apr: 4, mai: 5, may: 5, juin: 6, jun: 6,
  juil: 7, jul: 7, août: 8, ago: 8, aug: 8, sept: 9, sep: 9, oct: 10, nov: 11, déc: 12, dic: 12, dec: 12,
};

/** « Mar 20 oct », « Wed 04 Nov », « Dom 18 ene » → date civile de l'année de la fixture, ou null. */
export function nodeDate(label: string, year: string): string | null {
  const m = /(\d{1,2})\s+([A-Za-zÀ-ÿ]+)/.exec(label);
  const month = m ? MONTHS[m[2].toLowerCase().replace('.', '')] : undefined;
  if (!m || !month) return null;
  return `${year}-${String(month).padStart(2, '0')}-${m[1].padStart(2, '0')}`;
}

/** Silence MP3 (MPEG-2, 24 kHz, 32 kb/s, mono), `seconds` secondes : le lecteur du mode fixture. */
export function silentMp3(seconds: number): Uint8Array {
  const frame = new Uint8Array(96);
  frame.set([0xff, 0xf3, 0x44, 0xc4]);
  const count = Math.round((seconds * 24000) / 576);
  const out = new Uint8Array(frame.length * count);
  for (let i = 0; i < count; i++) out.set(frame, i * frame.length);
  return out;
}

type MutableState = { vocab: Map<string, { selected: boolean; ankiStatus: AnkiStatus }>; followed: Map<string, boolean> };
// Survit aux rechargements à chaud de `next dev` ; propre à chaque processus.
const g = globalThis as typeof globalThis & { __dailyBriefFixtureState?: MutableState };
const state: MutableState = (g.__dailyBriefFixtureState ??= { vocab: new Map(), followed: new Map() });

/** Vide l'état en mémoire (tests). */
export function resetFixtureState(): void {
  state.vocab.clear();
  state.followed.clear();
}

const step = (status: string, finishedAt: string | null, counters: Record<string, number>, errors: string[] = []) => ({ status, finishedAt, durationMs: null, counters, errors });

export class FixtureDataSource implements DataSource {
  readonly kind = 'fixture' as const;
  private readonly brief: Brief;
  private readonly threadsFile: z.infer<typeof ThreadsFixture>;

  constructor(private readonly opts: FixtureOptions, dir = fixturesDir()) {
    const parsed = parseBrief(JSON.parse(readFileSync(join(dir, 'brief-2026-11-06.json'), 'utf8')));
    if (!parsed.success) throw new Error(`fixture invalide : ${parsed.errors.join(' ; ')}`);
    this.brief = parsed.data;
    this.threadsFile = ThreadsFixture.parse(JSON.parse(readFileSync(join(dir, 'threads-2026-11-06.json'), 'utf8')));
  }

  today(): string {
    return this.opts.today;
  }

  private generatedAt = () => `${this.brief.date}T04:41:00.000Z`;

  async edition(date: string, lang: Lang): Promise<EditionView | null> {
    const ed = this.brief.editions.find((e) => e.lang === lang);
    if (!ed || date !== this.brief.date) return null;
    return editionFromFixture(ed, { light: this.opts.light?.includes(lang) ?? false, hasAudio: lang !== 'es', hasPdf: false, generatedAt: this.generatedAt() }, state.vocab);
  }

  async latestDate(_lang: Lang, onOrBefore: string): Promise<string | null> {
    return this.brief.date <= onOrBefore ? this.brief.date : null;
  }

  async days(from: string, to: string): Promise<EditionDay[]> {
    const d = this.brief.date;
    return d >= from && d <= to ? [{ date: d, langs: [...LANGS], light: this.opts.light ?? [] }] : [];
  }

  private allThreads(): ThreadDetail[] {
    const year = this.brief.date.slice(0, 4);
    const out = new Map<string, ThreadDetail>();
    for (const ed of this.brief.editions) {
      for (const section of ed.sections) {
        for (const st of section.stories) {
          if (!st.thread) continue;
          const id = fixtureThreadId(ed.lang, st.thread.title);
          const first = st.sources[0];
          const event: ThreadEventView = {
            date: ed.date,
            title: st.title,
            text: st.thread.subtitle,
            rubric: section.key,
            source: first ? { outlet: first.outlet, url: first.url } : null,
            map: st.visual.type === 'map' ? { spec: st.visual.map, caption: st.visual.caption } : null,
          };
          const past: ThreadEventView[] = [];
          const file = this.threadsFile[ed.lang];
          if (file && file.title === st.thread.title) {
            for (const n of file.nodes.filter((x) => x.st === '')) {
              const date = nodeDate(n.d, year);
              if (date && date < ed.date) past.push({ date, title: n.h, text: n.p, rubric: null, source: null, map: null });
            }
          }
          const events = [event, ...past].sort((a, b) => (a.date < b.date ? 1 : -1));
          out.set(id, { id, title: st.thread.title, lang: ed.lang, status: 'open', followed: state.followed.get(id) ?? false, eventCount: events.length, lastDate: events[0].date, lastTitle: events[0].title, events });
        }
      }
    }
    return [...out.values()];
  }

  async threads(): Promise<ThreadSummary[]> {
    return this.allThreads().map(({ events: _events, ...summary }) => summary);
  }

  async thread(id: string): Promise<ThreadDetail | null> {
    return this.allThreads().find((t) => t.id === id) ?? null;
  }

  async vocab(filter: VocabFilter): Promise<VocabEntry[]> {
    const out: VocabEntry[] = [];
    for (const ed of this.brief.editions) {
      const view = await this.edition(ed.date, ed.lang);
      for (const w of view?.vocab?.words ?? []) out.push({ ...w, date: ed.date, lang: ed.lang });
    }
    return out.filter((w) => (!filter.lang || w.lang === filter.lang) && (!filter.date || w.date === filter.date) && (filter.selected === undefined || w.selected === filter.selected));
  }

  async runs(limit: number): Promise<RunRecord[]> {
    const d = this.brief.date;
    const ok = (at: string) => step('ok', at, {});
    const rows: RunRecord[] = [
      {
        date: d,
        status: 'ok',
        updatedAt: `${d}T04:52:00.000Z`,
        notes: '3 édition(s) publiée(s) : FR, EN, ES ; Drive : sent',
        steps: {
          context: step('ok', `${d}T04:14:00.000Z`, { openThreads: 4, yesterdayTopics: 12, closedThreads: 0, warnings: 0 }),
          collect: { ...step('ok', `${d}T04:22:00.000Z`, { articles: 184, groups: 61, warnings: 2 }), perLang: { fr: { articles: 80, fullTexts: 22, light: false }, en: { articles: 60, fullTexts: 18, light: false }, es: { articles: 44, fullTexts: 16, light: false } } },
          verify: step('ok', `${d}T04:35:00.000Z`, { editions: 3, fixed: 0, warnings: 1, errors: 0 }),
          render: step('ok', `${d}T04:41:00.000Z`, { finals: 3, pdfEditions: 3, pdf: 1, warnings: 0 }),
          publish: { ...step('ok', `${d}T04:52:00.000Z`, { editions: 3, stories: 10, sources: 41, vocab: 12, threadsCreated: 1, files: 4, audioPurged: 0 }), durationMs: 41000 },
          drive: step('sent', null, { sent: 4, pending: 0 }),
          closedThreads: [],
        },
      },
      {
        date: '2026-11-05',
        status: 'degraded',
        updatedAt: '2026-11-05T04:55:00.000Z',
        notes: '3 édition(s) publiée(s) : FR, EN, ES ; Drive : pending',
        steps: {
          context: ok('2026-11-05T04:14:00.000Z'),
          collect: ok('2026-11-05T04:21:00.000Z'),
          verify: ok('2026-11-05T04:33:00.000Z'),
          render: ok('2026-11-05T04:40:00.000Z'),
          publish: step('degraded', '2026-11-05T04:55:00.000Z', { editions: 3 }, ['Drive : délai dépassé']),
          drive: step('pending', null, { sent: 0, pending: 4 }, ['délai dépassé']),
          closedThreads: ['t-ancien'],
        },
      },
      { date: '2026-11-04', status: 'running', updatedAt: '2026-11-04T04:13:00.000Z', notes: null, steps: { closedThreads: [] } },
    ];
    return rows.slice(0, limit);
  }

  async setSelected(ids: string[], selected: boolean): Promise<number> {
    const known = await this.knownVocab();
    let n = 0;
    for (const id of ids) {
      if (!known.has(id)) continue;
      state.vocab.set(id, { selected, ankiStatus: state.vocab.get(id)?.ankiStatus ?? 'none' });
      n++;
    }
    return n;
  }

  async queueAnki(ids: string[]): Promise<number> {
    const known = await this.knownVocab();
    let n = 0;
    for (const id of ids) {
      const cur = state.vocab.get(id);
      if (!known.has(id) || (cur && cur.ankiStatus !== 'none')) continue;
      state.vocab.set(id, { selected: true, ankiStatus: 'queued' });
      n++;
    }
    return n;
  }

  async setFollowed(id: string, followed: boolean): Promise<number> {
    if (!this.allThreads().some((t) => t.id === id)) return 0;
    state.followed.set(id, followed);
    return 1;
  }

  private async knownVocab(): Promise<Set<string>> {
    return new Set(this.brief.editions.flatMap((e) => (e.vocab?.items ?? []).map((v) => fixtureVocabId(e.date, e.lang, v.term))));
  }

  async audio(date: string, lang: Lang): Promise<FileTarget | null> {
    const ed = await this.edition(date, lang);
    return ed?.hasAudio ? { kind: 'bytes', body: silentMp3(3), contentType: 'audio/mpeg' } : null;
  }

  async pdf(): Promise<FileTarget | null> {
    return null;
  }
}
```

- [ ] **Étape 4 : vérifier le succès**

Commande : `npx vitest run --project web apps/web/test/data/fixture.test.ts`
Attendu : `Tests  8 passed (8)`.

Commande : `npm test && npm run typecheck`
Attendu : `Test Files  83 passed (83)`, `Tests  850 passed (850)`, typage sans erreur.

- [ ] **Étape 5 : commit**

```bash
git add apps/web/lib/data/fixture.ts apps/web/test/data/fixture.test.ts
git commit -m "feat(web): source de données du mode fixture (éditions, Threads, écritures en mémoire)"
```

---

### Tâche 5 : source de données Supabase (clé publique, session, RLS)

**Fichiers :**
- Créer : `apps/web/lib/data/supabase.ts`, `apps/web/lib/supabase/server.ts`, `apps/web/lib/data/index.ts`
- Test : `apps/web/test/data/fake-supabase.ts`, `apps/web/test/data/supabase.test.ts`

Comportement attendu :
- **Client.** `createSupabase()` crée le client de la requête avec `@supabase/ssr`, la clé publique et les cookies de session. Aucune clé de service n'existe dans l'appli. `getDataSource()` choisit la fixture (`FIXTURE=1`) ou Supabase, une fois par requête (`cache` de React).
- **Lectures.**
  - **Édition.** Elle est lue par date et langue, puis ses sujets, sources et mots, en parallèle. Chaque `select` nomme ses colonnes ; les lignes sont validées et converties par la tâche 3. Une édition absente donne `null` ; une erreur de PostgREST lève une `DataError`, sans secret.
  - **Archive.** Les éditions sont regroupées par jour.
  - **Threads et frise.** Ils sont lus avec leurs événements et le sujet lié (rubrique, carte, sources).
  - **Vocabulaire.** Filtres langue, date (sur l'édition jointe) et coché.
  - **`runs`.** Du plus récent au plus ancien.
- **Écritures.** Elles ne nomment que `selected`, `anki_status` (passage `none` → `queued`, avec `selected` vrai) et `followed`. Elles renvoient le nombre de lignes modifiées (zéro si la RLS refuse), et prennent 1 à 50 identifiants.
- **Fichiers.** Le chemin lu en base doit avoir la forme attendue (`AAAA-MM-JJ/fr.mp3`, `AAAA-MM-JJ/daily-brief-AAAA-MM-JJ.pdf`), sinon rien n'est signé. L'URL signée vaut 600 s ; le PDF se télécharge sous `Daily Brief AAAA-MM-JJ.pdf`.

- [ ] **Étape 1 : écrire le faux client et les tests**

Le faux client enregistre les chaînes `from(…).select(…).eq(…)` et répond avec des lignes tirées de PGlite : les conversions sont donc testées sur la forme réelle des données, et les filtres sur les appels réellement faits.

Fichier `apps/web/test/data/fake-supabase.ts` :

```ts
import type { SupabaseClient } from '@supabase/supabase-js';

/** Appel enregistré : table, puis chaque méthode de la chaîne avec ses arguments. */
export type Call = { table: string; ops: [string, ...unknown[]][] };
export type Responder = (call: Call) => { data: unknown; error: { message: string } | null };

/**
 * Faux client Supabase : enregistre les chaînes `from(t).select(…).eq(…)…` et répond par `respond`.
 * Rien ne sort de la machine. Le stockage enregistre les demandes d'URL signée.
 */
export function fakeSupabase(respond: Responder) {
  const calls: Call[] = [];
  const signed: { bucket: string; path: string; expiresIn: number; options: unknown }[] = [];
  const builder = (table: string) => {
    const call: Call = { table, ops: [] };
    calls.push(call);
    const chain: Record<string, unknown> = {};
    for (const m of ['select', 'eq', 'neq', 'in', 'lte', 'gte', 'order', 'limit', 'update', 'not']) {
      chain[m] = (...args: unknown[]) => {
        call.ops.push([m, ...args]);
        return chain;
      };
    }
    chain.maybeSingle = () => {
      call.ops.push(['maybeSingle']);
      return Promise.resolve(respond(call));
    };
    chain.then = (ok: (v: unknown) => unknown, ko?: (e: unknown) => unknown) => Promise.resolve(respond(call)).then(ok, ko);
    return chain;
  };
  const client = {
    from: builder,
    storage: {
      from: (bucket: string) => ({
        createSignedUrl: async (path: string, expiresIn: number, options?: unknown) => {
          signed.push({ bucket, path, expiresIn, options });
          return { data: { signedUrl: `https://ref.supabase.co/storage/v1/object/sign/${bucket}/${path}?token=t` }, error: null };
        },
      }),
    },
  };
  return { client: client as unknown as SupabaseClient, calls, signed };
}

export const op = (call: Call, name: string) => call.ops.filter((o) => o[0] === name).map((o) => o.slice(1));
```

Fichier `apps/web/test/data/supabase.test.ts` :

```ts
// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SupabaseDataSource, SIGNED_URL_SECONDS, STORY_COLUMNS } from '@/lib/data/supabase';
import { createTestDb, type TestDb } from '../../../../pipeline/test/supabase/pg';
import { fakeSupabase, op, type Call } from './fake-supabase';
import { asUserJson, editionRows, publishFixture } from './pg-rows';

let db: TestDb;
beforeAll(async () => {
  db = await createTestDb();
  await publishFixture(db, { audio: ['fr'] });
}, 60_000);
afterAll(async () => db.close());

const today = () => '2026-11-06';

describe('source de données Supabase', () => {
  it('lit une édition par date et langue, avec ses sujets, sources et mots', async () => {
    const rows = await editionRows(db, '2026-11-06', 'en');
    const { client, calls } = fakeSupabase((c: Call) => ({ data: c.table === 'editions' ? rows.edition : c.table === 'stories' ? rows.stories : c.table === 'sources' ? rows.sources : rows.vocab, error: null }));
    const ed = await new SupabaseDataSource(client, today).edition('2026-11-06', 'en');
    expect(ed?.headline).toBe('A blue wave sweeps Congress');
    expect(ed?.vocab?.words).toHaveLength(6);
    expect(op(calls[0], 'eq')).toEqual([
      ['date', '2026-11-06'],
      ['lang', 'en'],
    ]);
    expect(op(calls.find((c) => c.table === 'stories')!, 'select')).toEqual([[STORY_COLUMNS]]);
  });

  it('renvoie null pour une édition absente et lève sur une erreur', async () => {
    const none = fakeSupabase(() => ({ data: null, error: null }));
    expect(await new SupabaseDataSource(none.client, today).edition('2026-11-07', 'fr')).toBeNull();
    const ko = fakeSupabase(() => ({ data: null, error: { message: 'JWT expired' } }));
    await expect(new SupabaseDataSource(ko.client, today).edition('2026-11-07', 'fr')).rejects.toThrow(/édition : JWT expired/);
  });

  it('regroupe l’archive par jour', async () => {
    const rows = await asUserJson(db, `select jsonb_build_object('date', date, 'lang', lang, 'status', status) as j from public.editions order by date`);
    const { client } = fakeSupabase(() => ({ data: rows, error: null }));
    expect(await new SupabaseDataSource(client, today).days('2026-11-01', '2026-11-30')).toEqual([{ date: '2026-11-06', langs: ['fr', 'en', 'es'], light: [] }]);
  });

  it('lit les Threads et leur frise sous RLS', async () => {
    const rows = await asUserJson(
      db,
      `select jsonb_build_object('id', t.id, 'title', t.title, 'lang', t.lang, 'status', t.status, 'followed', t.followed,
         'thread_events', coalesce((select jsonb_agg(jsonb_build_object('date', e.date, 'title', e.title, 'text', e.text,
           'story', (select jsonb_build_object('rubric', s.rubric, 'visual', s.visual, 'sources',
             (select jsonb_agg(jsonb_build_object('outlet', x.outlet, 'url', x.url, 'position', x.position)) from public.sources x where x.story_id = s.id))
             from public.stories s where s.id = e.story_id))) from public.thread_events e where e.thread_id = t.id), '[]'::jsonb)) as j
       from public.threads t`,
    );
    const { client } = fakeSupabase(() => ({ data: rows, error: null }));
    const list = await new SupabaseDataSource(client, today).threads();
    expect(list.map((t) => t.title)).toContain('Crisis ferroviaria 2026');
    const detail = await new SupabaseDataSource(client, today).thread(list[0].id);
    expect(detail?.events[0].source?.url).toMatch(/^https:/);
  });

  it('n’écrit que les colonnes ouvertes par la RLS', async () => {
    const { client, calls } = fakeSupabase(() => ({ data: [{ id: 'a' }], error: null }));
    const ds = new SupabaseDataSource(client, today);
    expect(await ds.setSelected(['a'], true)).toBe(1);
    expect(await ds.queueAnki(['a'])).toBe(1);
    expect(await ds.setFollowed('t', true)).toBe(1);
    expect(calls.map((c) => [c.table, op(c, 'update')[0][0]])).toEqual([
      ['vocab_items', { selected: true }],
      ['vocab_items', { anki_status: 'queued', selected: true }],
      ['threads', { followed: true }],
    ]);
    expect(op(calls[1], 'eq')).toEqual([['anki_status', 'none']]);
    expect(await ds.setSelected([], true)).toBe(0);
    expect(await ds.setSelected(Array.from({ length: 51 }, (_, i) => `id${i}`), true)).toBe(0);
  });

  it('signe l’audio pour 10 minutes et refuse un chemin inattendu', async () => {
    const ok = fakeSupabase(() => ({ data: { audio_path: '2026-11-06/fr.mp3' }, error: null }));
    expect(await new SupabaseDataSource(ok.client, today).audio('2026-11-06', 'fr')).toEqual({ kind: 'redirect', url: 'https://ref.supabase.co/storage/v1/object/sign/audio/2026-11-06/fr.mp3?token=t' });
    expect(ok.signed).toEqual([{ bucket: 'audio', path: '2026-11-06/fr.mp3', expiresIn: SIGNED_URL_SECONDS, options: undefined }]);
    const none = fakeSupabase(() => ({ data: { audio_path: null }, error: null }));
    expect(await new SupabaseDataSource(none.client, today).audio('2026-11-06', 'es')).toBeNull();
    const odd = fakeSupabase(() => ({ data: { audio_path: '../pdf/x.pdf' }, error: null }));
    expect(await new SupabaseDataSource(odd.client, today).audio('2026-11-06', 'fr')).toBeNull();
    expect(odd.signed).toEqual([]);
  });

  it('signe le PDF du jour en téléchargement', async () => {
    const f = fakeSupabase(() => ({ data: [{ pdf_path: '2026-11-06/daily-brief-2026-11-06.pdf' }], error: null }));
    expect((await new SupabaseDataSource(f.client, today).pdf('2026-11-06'))?.kind).toBe('redirect');
    expect(f.signed[0]).toMatchObject({ bucket: 'pdf', options: { download: 'Daily Brief 2026-11-06.pdf' } });
  });
});
```

- [ ] **Étape 2 : vérifier l'échec**

Commande : `npx vitest run --project web apps/web/test/data/supabase.test.ts`
Attendu : échec, `Failed to resolve import "@/lib/data/supabase"`.

- [ ] **Étape 3 : implémenter**

Fichier `apps/web/lib/data/supabase.ts` :

```ts
import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { LANGS, type Lang } from '@daily-brief/schema';
import {
  EditionRowSchema,
  editionFromRows,
  parseRows,
  RunRowSchema,
  runFromRow,
  SourceRowSchema,
  StoryRowSchema,
  threadFromRow,
  ThreadRowSchema,
  threadSummary,
  VocabEntryRowSchema,
  vocabEntryFromRow,
  VocabRowSchema,
} from './rows';
import type { DataSource, EditionDay, EditionView, FileTarget, RunRecord, ThreadDetail, ThreadSummary, VocabEntry, VocabFilter } from './types';

/**
 * Source de données Supabase : clé publique et session de l'utilisateur (client de lib/supabase/server.ts),
 * donc toujours sous RLS. Jamais de clé de service ici. Les écritures ne nomment que les colonnes que
 * la migration 0001 ouvre à l'utilisateur : vocab_items.selected, vocab_items.anki_status, threads.followed.
 */

export const SIGNED_URL_SECONDS = 600;
export const MAX_IDS = 50;

export const EDITION_COLUMNS = 'id,date,lang,region,headline,morning_brief,sections,vocab_title,audio_path,pdf_path,status,generated_at';
export const STORY_COLUMNS = 'id,key,rubric,position,kicker,date_label,title,summary,visual,stats,quote,divergences,prepa,thread_id,thread_subtitle,thread:threads(id,title)';
export const SOURCE_COLUMNS = 'story_id,rubric,position,outlet,title,url,lang,read_full,published_at';
export const VOCAB_COLUMNS = 'id,position,term,pos,translation,example,source_url,selected,anki_status';
export const THREAD_COLUMNS = 'id,title,lang,status,followed,thread_events(date,title,text,story:stories(rubric,visual,sources(outlet,url,position)))';

const AUDIO_PATH = /^\d{4}-\d{2}-\d{2}\/(fr|en|es)\.mp3$/;
const PDF_PATH = /^\d{4}-\d{2}-\d{2}\/daily-brief-\d{4}-\d{2}-\d{2}\.pdf$/;

export class DataError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DataError';
  }
}

type Result = { data: unknown; error: { message: string } | null };

function check(what: string, r: Result): unknown {
  if (r.error) throw new DataError(`${what} : ${r.error.message}`);
  return r.data;
}

/** Les lignes écartées sont signalées dans les journaux du serveur, jamais à l'écran. */
function report(problems: string[]): void {
  for (const p of problems) console.warn(`[daily-brief] ${p}`);
}

export class SupabaseDataSource implements DataSource {
  readonly kind = 'supabase' as const;

  constructor(
    private readonly db: SupabaseClient,
    private readonly todayFn: () => string,
  ) {}

  today(): string {
    return this.todayFn();
  }

  async edition(date: string, lang: Lang): Promise<EditionView | null> {
    const row = check('édition', await this.db.from('editions').select(EDITION_COLUMNS).eq('date', date).eq('lang', lang).maybeSingle());
    if (row === null) return null;
    const edition = EditionRowSchema.safeParse(row);
    if (!edition.success) throw new DataError(`édition ${date} ${lang} illisible`);
    const id = edition.data.id;
    const [stories, sources, vocab] = await Promise.all([
      this.db.from('stories').select(STORY_COLUMNS).eq('edition_id', id).order('position'),
      this.db.from('sources').select(SOURCE_COLUMNS).eq('edition_id', id).order('position'),
      this.db.from('vocab_items').select(VOCAB_COLUMNS).eq('edition_id', id).order('position'),
    ]);
    const s = parseRows(StoryRowSchema, check('sujets', stories), 'sujet');
    const src = parseRows(SourceRowSchema, check('sources', sources), 'source');
    const v = parseRows(VocabRowSchema, check('mots', vocab), 'mot');
    const mapped = editionFromRows({ edition: edition.data, stories: s.value, sources: src.value, vocab: v.value });
    report([...s.problems, ...src.problems, ...v.problems, ...mapped.problems]);
    return mapped.value;
  }

  async latestDate(lang: Lang, onOrBefore: string): Promise<string | null> {
    const rows = check('dernière édition', await this.db.from('editions').select('date').eq('lang', lang).lte('date', onOrBefore).order('date', { ascending: false }).limit(1));
    const first = Array.isArray(rows) ? (rows[0] as { date?: unknown } | undefined) : undefined;
    return typeof first?.date === 'string' ? first.date : null;
  }

  async days(from: string, to: string): Promise<EditionDay[]> {
    const rows = check('archive', await this.db.from('editions').select('date,lang,status').gte('date', from).lte('date', to).order('date'));
    const byDate = new Map<string, EditionDay>();
    for (const r of Array.isArray(rows) ? (rows as { date: string; lang: Lang; status: string }[]) : []) {
      if (!LANGS.includes(r.lang)) continue;
      const day = byDate.get(r.date) ?? { date: r.date, langs: [], light: [] };
      day.langs.push(r.lang);
      if (r.status === 'light') day.light.push(r.lang);
      byDate.set(r.date, day);
    }
    return [...byDate.values()].map((d) => ({ ...d, langs: LANGS.filter((l) => d.langs.includes(l)), light: LANGS.filter((l) => d.light.includes(l)) }));
  }

  private async threadRows(id?: string) {
    let q = this.db.from('threads').select(THREAD_COLUMNS);
    if (id) q = q.eq('id', id);
    const rows = parseRows(ThreadRowSchema, check('Threads', await q.order('updated_at', { ascending: false }).limit(200)), 'Thread');
    report(rows.problems);
    return rows.value;
  }

  async threads(): Promise<ThreadSummary[]> {
    return (await this.threadRows()).map(threadSummary);
  }

  async thread(id: string): Promise<ThreadDetail | null> {
    const [row] = await this.threadRows(id);
    return row ? threadFromRow(row) : null;
  }

  async vocab(filter: VocabFilter): Promise<VocabEntry[]> {
    let q = this.db.from('vocab_items').select(`${VOCAB_COLUMNS},lang,edition:editions!inner(date)`);
    if (filter.lang) q = q.eq('lang', filter.lang);
    if (filter.date) q = q.eq('edition.date', filter.date);
    if (filter.selected !== undefined) q = q.eq('selected', filter.selected);
    const rows = parseRows(VocabEntryRowSchema, check('vocabulaire', await q.limit(500)), 'mot');
    report(rows.problems);
    return rows.value.map(vocabEntryFromRow).sort((a, b) => (a.date === b.date ? 0 : a.date < b.date ? 1 : -1));
  }

  async runs(limit: number): Promise<RunRecord[]> {
    const rows = parseRows(RunRowSchema, check('passages', await this.db.from('runs').select('date,status,steps,notes,updated_at').order('date', { ascending: false }).limit(limit)), 'passage');
    report(rows.problems);
    return rows.value.map(runFromRow);
  }

  private static count(what: string, r: Result): number {
    const data = check(what, r);
    return Array.isArray(data) ? data.length : 0;
  }

  async setSelected(ids: string[], selected: boolean): Promise<number> {
    if (ids.length === 0 || ids.length > MAX_IDS) return 0;
    return SupabaseDataSource.count('mots', await this.db.from('vocab_items').update({ selected }).in('id', ids).select('id'));
  }

  /** « Ajouter à Anki » : met en file les mots encore à `none` (un mot déjà envoyé n'est pas rétrogradé). */
  async queueAnki(ids: string[]): Promise<number> {
    if (ids.length === 0 || ids.length > MAX_IDS) return 0;
    return SupabaseDataSource.count('Anki', await this.db.from('vocab_items').update({ anki_status: 'queued', selected: true }).in('id', ids).eq('anki_status', 'none').select('id'));
  }

  async setFollowed(id: string, followed: boolean): Promise<number> {
    return SupabaseDataSource.count('Thread', await this.db.from('threads').update({ followed }).eq('id', id).select('id'));
  }

  private async signed(bucket: 'audio' | 'pdf', path: string, download?: string): Promise<FileTarget | null> {
    const { data, error } = await this.db.storage.from(bucket).createSignedUrl(path, SIGNED_URL_SECONDS, download ? { download } : undefined);
    if (error || !data?.signedUrl) return null;
    return { kind: 'redirect', url: data.signedUrl };
  }

  async audio(date: string, lang: Lang): Promise<FileTarget | null> {
    const row = check('audio', await this.db.from('editions').select('audio_path').eq('date', date).eq('lang', lang).maybeSingle()) as { audio_path?: unknown } | null;
    const path = row?.audio_path;
    return typeof path === 'string' && AUDIO_PATH.test(path) ? this.signed('audio', path) : null;
  }

  async pdf(date: string): Promise<FileTarget | null> {
    const rows = check('PDF', await this.db.from('editions').select('pdf_path').eq('date', date).not('pdf_path', 'is', null).limit(1));
    const path = Array.isArray(rows) ? (rows[0] as { pdf_path?: unknown } | undefined)?.pdf_path : undefined;
    return typeof path === 'string' && PDF_PATH.test(path) ? this.signed('pdf', path, `Daily Brief ${date}.pdf`) : null;
  }
}
```

Fichier `apps/web/lib/supabase/server.ts` :

```ts
import 'server-only';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { supabaseConfig } from '@/lib/env';

/**
 * Client Supabase d'une requête : clé publique et session de l'utilisateur lue dans ses cookies.
 * Toutes les lectures et écritures passent donc par la RLS (private.is_allowed_user()).
 */
export async function createSupabase() {
  const { url, anonKey } = supabaseConfig();
  const store = await cookies();
  return createServerClient(url, anonKey, {
    cookies: {
      getAll: () => store.getAll(),
      setAll: (list) => {
        try {
          for (const { name, value, options } of list) store.set(name, value, options);
        } catch {
          // Composant serveur : les cookies ne s'y écrivent pas, le proxy rafraîchit la session.
        }
      },
    },
  });
}
```

Fichier `apps/web/lib/data/index.ts` :

```ts
import 'server-only';
import { cache } from 'react';
import { LANGS, type Lang } from '@daily-brief/schema';
import { parisToday } from '@/lib/dates';
import { fixtureMode, fixtureToday } from '@/lib/env';
import { createSupabase } from '@/lib/supabase/server';
import { FixtureDataSource } from './fixture';
import { SupabaseDataSource } from './supabase';
import type { DataSource } from './types';

/** FIXTURE_LIGHT=es,en : éditions allégées du mode fixture (tests du bandeau). */
const fixtureLight = (): Lang[] => (process.env.FIXTURE_LIGHT ?? '').split(',').filter((l): l is Lang => (LANGS as readonly string[]).includes(l));

/** Source de données de la requête : fixtures/ si FIXTURE=1, sinon Supabase avec la session. */
export const getDataSource = cache(async (): Promise<DataSource> => {
  if (fixtureMode()) return new FixtureDataSource({ today: fixtureToday(), light: fixtureLight() });
  return new SupabaseDataSource(await createSupabase(), () => parisToday());
});
```

- [ ] **Étape 4 : vérifier le succès**

Commande : `npx vitest run --project web apps/web/test/data`
Attendu : `Test Files  4 passed (4)`, `Tests  25 passed (25)`.

Commande : `npm test && npm run typecheck`
Attendu : `Test Files  84 passed (84)`, `Tests  857 passed (857)`, typage sans erreur.

- [ ] **Étape 5 : commit**

```bash
git add apps/web/lib/data/supabase.ts apps/web/lib/supabase/server.ts apps/web/lib/data/index.ts apps/web/test/data/fake-supabase.ts apps/web/test/data/supabase.test.ts
git commit -m "feat(web): source de données Supabase sous RLS, écritures limitées, URL signées"
```

---

### Tâche 6 : proxy, CSP à nonce et utilisateur courant

**Fichiers :**
- Créer : `apps/web/proxy.ts`, `apps/web/lib/access.ts`, `apps/web/lib/csp.ts`, `apps/web/lib/edition-choice.ts`, `apps/web/lib/auth.ts`
- Test : `apps/web/test/app/proxy.test.ts`

Comportement attendu :
- **Chemins publics.** `/login`, `/auth/confirm`, le manifeste et les icônes. Le manifeste et les icônes sont aussi exclus du `matcher`, car le navigateur les lit sans cookies.
- **Session.** Sans session, une page renvoie vers `/login`. Une session d'une autre adresse que `ALLOWED_EMAIL` renvoie vers `/login?erreur=refuse`. L'utilisateur autorisé passe, et les cookies de session rafraîchis sont recopiés sur la réponse.
- **Onglet d'édition.** `?ed=fr|en|es` écrit le cookie `ed` (httpOnly, `SameSite=Lax`, `Secure` en https, un an). Il est aussi recopié dans la requête, pour que la page soit rendue dans cette langue dès cette requête. Une autre valeur est ignorée.
- **CSP.** Toute réponse porte une CSP à nonce : `'strict-dynamic'`, `img-src` limité à Pexels, `media-src` limité à l'origine Supabase, `connect-src 'self'`, `frame-ancestors 'none'`. `'unsafe-eval'` n'est présent qu'en développement, et `upgrade-insecure-requests` qu'en https.
- **Mode fixture.** Il n'appelle pas Supabase et ne demande pas de connexion ; il est refusé sur Vercel.
- **`currentUser()`.** Il revérifie l'utilisateur pour les actions et les routes de fichiers, avec `getClaims()` et `ALLOWED_EMAIL`.

- [ ] **Étape 1 : écrire les tests**

`@supabase/ssr` est simulé : le faux `getClaims` renvoie l'email voulu et peut « rafraîchir » la session par `setAll`, comme le vrai.

Fichier `apps/web/test/app/proxy.test.ts` :

```ts
// @vitest-environment node
import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { access, isPublicPath } from '@/lib/access';
import { buildCsp } from '@/lib/csp';

const m = vi.hoisted(() => ({ email: null as string | null, refreshed: false }));
vi.mock('@supabase/ssr', () => ({
  createServerClient: (_url: string, _key: string, opts: { cookies: { setAll: (l: { name: string; value: string; options?: object }[]) => void } }) => ({
    auth: {
      getClaims: async () => {
        if (m.refreshed) opts.cookies.setAll([{ name: 'sb-ref-auth-token', value: 'neuf', options: { path: '/' } }]);
        return { data: m.email ? { claims: { email: m.email } } : null, error: null };
      },
    },
  }),
}));

import { proxy } from '@/proxy';

const req = (path: string, init?: { https?: boolean }) => new NextRequest(`${init?.https ? 'https' : 'http'}://brief.example${path}`);

beforeEach(() => {
  m.email = null;
  m.refreshed = false;
  vi.stubEnv('FIXTURE', '');
  vi.stubEnv('VERCEL', '');
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://ref.supabase.co');
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'sb_publishable_test');
  vi.stubEnv('ALLOWED_EMAIL', 'nanigeek@gmail.com');
});

describe('décision d’accès', () => {
  it('laisse passer les chemins publics, renvoie vers /login sans session ou avec une autre adresse', () => {
    for (const p of ['/login', '/auth/confirm', '/manifest.webmanifest', '/icons/icon-192.png']) expect(isPublicPath(p)).toBe(true);
    expect(access('/', null, false)).toBe('login');
    expect(access('/', 'intrus@exemple.fr', false)).toBe('refuse');
    expect(access('/vocab', 'nanigeek@gmail.com', true)).toBe('allow');
    expect(access('/auth/signout', null, false)).toBe('login');
  });
});

describe('CSP', () => {
  it('porte le nonce, l’origine Supabase pour l’audio et rien d’autre de distant', () => {
    const csp = buildCsp({ nonce: 'abc', supabaseOrigin: 'https://ref.supabase.co', dev: false, upgrade: true });
    expect(csp).toContain("script-src 'self' 'nonce-abc' 'strict-dynamic'");
    expect(csp).toContain("media-src 'self' https://ref.supabase.co");
    expect(csp).toContain("img-src 'self' data: https://images.pexels.com");
    expect(csp).toContain("connect-src 'self'");
    expect(csp).toContain('upgrade-insecure-requests');
    expect(csp).not.toContain('unsafe-eval');
    expect(buildCsp({ nonce: 'n', supabaseOrigin: null, dev: true, upgrade: false })).toContain("'unsafe-eval'");
  });
});

describe('proxy', () => {
  it('renvoie vers /login sans session, et vers /login?erreur=refuse pour une autre adresse', async () => {
    expect((await proxy(req('/vocab'))).headers.get('location')).toBe('http://brief.example/login');
    m.email = 'intrus@exemple.fr';
    expect((await proxy(req('/'))).headers.get('location')).toBe('http://brief.example/login?erreur=refuse');
  });

  it('laisse passer l’utilisateur autorisé avec une CSP à nonce, et recopie la session rafraîchie', async () => {
    m.email = 'NaniGeek@gmail.com';
    m.refreshed = true;
    const r = await proxy(req('/', { https: true }));
    expect(r.headers.get('location')).toBeNull();
    expect(r.headers.get('content-security-policy')).toMatch(/'nonce-[A-Za-z0-9+/=]+'/);
    expect(r.cookies.get('sb-ref-auth-token')?.value).toBe('neuf');
  });

  it('laisse /login ouvert sans session', async () => {
    expect((await proxy(req('/login'))).headers.get('location')).toBeNull();
  });

  it('retient l’édition choisie dans un cookie, et ignore une valeur inconnue', async () => {
    m.email = 'nanigeek@gmail.com';
    const r = await proxy(req('/?ed=es', { https: true }));
    expect(r.cookies.get('ed')).toMatchObject({ value: 'es', httpOnly: true, secure: true, sameSite: 'lax' });
    expect((await proxy(req('/?ed=de'))).cookies.get('ed')).toBeUndefined();
  });

  it('en mode fixture, n’appelle pas Supabase et ne demande pas de connexion', async () => {
    vi.stubEnv('FIXTURE', '1');
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', '');
    const r = await proxy(req('/'));
    expect(r.headers.get('location')).toBeNull();
    expect(r.headers.get('content-security-policy')).toContain("media-src 'self';");
  });

  it('refuse le mode fixture sur Vercel', async () => {
    vi.stubEnv('FIXTURE', '1');
    vi.stubEnv('VERCEL', '1');
    await expect(proxy(req('/'))).rejects.toThrow(/interdit sur Vercel/);
  });
});
```

- [ ] **Étape 2 : vérifier l'échec**

Commande : `npx vitest run --project web apps/web/test/app/proxy.test.ts`
Attendu : échec, `Failed to resolve import "@/lib/access"`.

- [ ] **Étape 3 : implémenter**

Fichier `apps/web/lib/access.ts` :

```ts
/** Chemins ouverts sans session : connexion, retour du lien magique, manifeste et icônes. */
export function isPublicPath(path: string): boolean {
  return path === '/login' || path === '/auth/confirm' || path === '/manifest.webmanifest' || path.startsWith('/icons/');
}

export type Access = 'public' | 'allow' | 'login' | 'refuse';

/**
 * Décision du proxy pour une requête : chemin public, utilisateur autorisé, pas de session (vers
 * /login), ou session d'une autre adresse (vers /login?erreur=refuse : la RLS ne lui montrerait rien).
 */
export function access(path: string, email: string | null, allowed: boolean): Access {
  if (isPublicPath(path)) return 'public';
  if (!email) return 'login';
  return allowed ? 'allow' : 'refuse';
}
```

Fichier `apps/web/lib/csp.ts` :

```ts
/** Content-Security-Policy d'une réponse, avec le nonce de la requête (posée par proxy.ts). */
export type CspOptions = { nonce: string; supabaseOrigin: string | null; dev: boolean; upgrade: boolean };

export function buildCsp({ nonce, supabaseOrigin, dev, upgrade }: CspOptions): string {
  const media = ["'self'", ...(supabaseOrigin ? [supabaseOrigin] : [])];
  const directives = [
    "default-src 'self'",
    // 'strict-dynamic' : seuls les scripts portant le nonce (ceux de Next) et ce qu'ils chargent s'exécutent.
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${dev ? " 'unsafe-eval'" : ''}`,
    // Attributs style (couleurs des pastilles, hauteurs des barres) : pas de feuille externe.
    "style-src 'self' 'unsafe-inline'",
    // Photos : seulement le CDN de Pexels (leçon SSRF du lot 2 : pas d'optimiseur d'images côté serveur).
    "img-src 'self' data: https://images.pexels.com",
    // Audio : la route /audio redirige vers une URL signée du projet Supabase.
    `media-src ${media.join(' ')}`,
    "connect-src 'self'",
    "font-src 'self'",
    "manifest-src 'self'",
    "worker-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ];
  if (upgrade) directives.push('upgrade-insecure-requests');
  return directives.join('; ');
}
```

Fichier `apps/web/lib/edition-choice.ts` :

```ts
import { LANGS, type Lang } from '@daily-brief/schema';

/** Cookie qui retient l'onglet d'édition choisi (FR/EN/ES). */
export const EDITION_COOKIE = 'ed';

export const isLang = (v: unknown): v is Lang => typeof v === 'string' && (LANGS as readonly string[]).includes(v);

/** Langue choisie : valeur du cookie si elle est valide, sinon FR. */
export const chosenLang = (cookie: string | undefined): Lang => (isLang(cookie) ? cookie : 'fr');
```

Fichier `apps/web/proxy.ts` :

```ts
import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';
import { access } from '@/lib/access';
import { buildCsp } from '@/lib/csp';
import { EDITION_COOKIE, isLang } from '@/lib/edition-choice';
import { fixtureMode, isAllowedEmail, supabaseConfig } from '@/lib/env';

/**
 * Proxy (ex-middleware, Next 16, runtime Node) : pour chaque page,
 * 1. retient l'onglet d'édition (`?ed=en` → cookie `ed`, visible dès cette requête) ;
 * 2. rafraîchit la session Supabase et renvoie vers /login sans session, ou avec une autre adresse
 *    que ALLOWED_EMAIL (le mode FIXTURE=1 n'a pas de connexion) ;
 * 3. pose la CSP avec un nonce propre à la requête.
 */
export async function proxy(request: NextRequest) {
  const fixture = fixtureMode();
  const config = fixture ? null : supabaseConfig();
  const nonce = btoa(crypto.randomUUID());
  const https = request.nextUrl.protocol === 'https:' || request.headers.get('x-forwarded-proto') === 'https';
  const csp = buildCsp({ nonce, supabaseOrigin: config?.origin ?? null, dev: process.env.NODE_ENV === 'development', upgrade: https });

  const ed = request.nextUrl.searchParams.get('ed');
  if (isLang(ed)) request.cookies.set(EDITION_COOKIE, ed);

  const next = () => {
    const headers = new Headers(request.headers);
    headers.set('x-nonce', nonce);
    headers.set('content-security-policy', csp);
    return NextResponse.next({ request: { headers } });
  };
  let response = next();
  const pending: { name: string; value: string; options?: Parameters<typeof response.cookies.set>[2] }[] = [];

  if (config) {
    const supabase = createServerClient(config.url, config.anonKey, {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (list) => {
          for (const { name, value } of list) request.cookies.set(name, value);
          response = next();
          pending.push(...list);
        },
      },
    });
    const { data } = await supabase.auth.getClaims();
    const email = typeof data?.claims?.email === 'string' ? data.claims.email : null;
    const decision = access(request.nextUrl.pathname, email, isAllowedEmail(email));
    if (decision === 'login' || decision === 'refuse') {
      const url = request.nextUrl.clone();
      url.pathname = '/login';
      url.search = decision === 'refuse' ? '?erreur=refuse' : '';
      response = NextResponse.redirect(url);
    }
  }

  for (const { name, value, options } of pending) response.cookies.set(name, value, options);
  if (isLang(ed)) response.cookies.set(EDITION_COOKIE, ed, { path: '/', maxAge: 60 * 60 * 24 * 365, sameSite: 'lax', httpOnly: true, secure: https });
  response.headers.set('Content-Security-Policy', csp);
  return response;
}

export const config = {
  // Tout sauf les fichiers statiques de Next, le manifeste et les icônes (lus sans session par le navigateur).
  matcher: ['/((?!_next/static|_next/image|icons/|manifest.webmanifest|favicon.ico).*)'],
};
```

Fichier `apps/web/lib/auth.ts` :

```ts
import 'server-only';
import { fixtureMode, isAllowedEmail } from '@/lib/env';
import { createSupabase } from '@/lib/supabase/server';

export type CurrentUser = { email: string };

/**
 * Utilisateur de la requête, s'il est l'utilisateur autorisé ; null sinon. Le proxy fait déjà ce
 * contrôle, mais chaque action serveur et chaque route de fichier le refait (défense en profondeur).
 * `getClaims()` vérifie la signature du jeton ; la RLS reste l'autorité sur les données.
 */
export async function currentUser(): Promise<CurrentUser | null> {
  if (fixtureMode()) return { email: 'fixture@localhost' };
  const supabase = await createSupabase();
  const { data, error } = await supabase.auth.getClaims();
  const email = data?.claims?.email;
  if (error || typeof email !== 'string' || !isAllowedEmail(email)) return null;
  return { email };
}
```

- [ ] **Étape 4 : vérifier le succès**

Commande : `npx vitest run --project web apps/web/test/app/proxy.test.ts`
Attendu : `Tests  8 passed (8)`.

Commande : `npm test && npm run typecheck`
Attendu : `Test Files  85 passed (85)`, `Tests  865 passed (865)`, typage sans erreur.

Commande : `HTTPS_PROXY=http://127.0.0.1:9 npm run web:build`
Attendu : `✓ Compiled successfully` et, sous la liste des routes, `ƒ Proxy (Middleware)`.

- [ ] **Étape 5 : commit**

```bash
git add apps/web/proxy.ts apps/web/lib/access.ts apps/web/lib/csp.ts apps/web/lib/edition-choice.ts apps/web/lib/auth.ts apps/web/test/app/proxy.test.ts
git commit -m "feat(web): proxy (session, renvoi vers /login, onglet retenu) et CSP à nonce"
```

---

### Tâche 7 : connexion par lien magique

**Fichiers :**
- Créer : `apps/web/app/login/actions.ts`, `apps/web/app/login/LoginForm.tsx`, `apps/web/app/login/page.tsx`, `apps/web/app/auth/confirm/route.ts`, `apps/web/app/auth/signout/route.ts`
- Test : `apps/web/test/app/login.test.ts`, `apps/web/test/app/auth-routes.test.ts`

Comportement attendu :
- **`sendLink`.** Il valide l'adresse (zod). Pour l'adresse autorisée seulement, il appelle `signInWithOtp` avec `emailRedirectTo = <SITE_URL>/auth/confirm`. Une autre adresse ne déclenche aucun appel, avec exactement le même message. Sans `SITE_URL`, seule une origine locale est permise ; un en-tête `Host` forgé ne choisit jamais la destination du lien.
- **`verifyCode`.** Il accepte le code à 6 chiffres du même courriel, espaces tolérés, pour l'adresse autorisée seulement, puis renvoie vers `/`. Toute erreur donne « Code invalide ou expiré. ».
- **`/auth/confirm`.** Il accepte `token_hash` + `type` (`email`, `magiclink`) ou `code`. Il renvoie toujours vers `/`, quel que soit un paramètre `next`. Lien incomplet ou expiré : `/login?erreur=lien`. Session d'une autre adresse : déconnexion, puis `/login?erreur=refuse`.
- **`/auth/signout`.** Il répond en POST seulement.

- [ ] **Étape 1 : écrire les tests**

Fichier `apps/web/test/app/login.test.ts` :

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => ({
  auth: {
    signInWithOtp: vi.fn(async (_: unknown) => ({ error: null as null | { message: string } })),
    verifyOtp: vi.fn(async (_: unknown) => ({ error: null as null | { message: string } })),
  },
  host: 'localhost:3000',
}));
vi.mock('@/lib/supabase/server', () => ({ createSupabase: async () => ({ auth: m.auth }) }));
vi.mock('next/headers', () => ({ headers: async () => new Headers({ host: m.host }) }));
vi.mock('next/navigation', () => ({
  redirect: (to: string) => {
    throw new Error(`REDIRECT ${to}`);
  },
}));

import { sendLink, verifyCode } from '@/app/login/actions';

const form = (fields: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.set(k, v);
  return f;
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('ALLOWED_EMAIL', 'nanigeek@gmail.com');
  vi.stubEnv('FIXTURE', '');
  vi.stubEnv('SITE_URL', '');
  m.host = 'localhost:3000';
});

describe('connexion par lien magique', () => {
  it('envoie le lien à l’adresse autorisée, retour sur /auth/confirm', async () => {
    const r = await sendLink({ step: 'email' }, form({ email: ' NaniGeek@gmail.com ' }));
    expect(r).toMatchObject({ step: 'code', email: 'nanigeek@gmail.com' });
    expect(m.auth.signInWithOtp).toHaveBeenCalledWith({ email: 'nanigeek@gmail.com', options: { emailRedirectTo: 'http://localhost:3000/auth/confirm', shouldCreateUser: true } });
  });

  it('n’envoie rien à une autre adresse, avec la même réponse', async () => {
    const ok = await sendLink({ step: 'email' }, form({ email: 'nanigeek@gmail.com' }));
    const other = await sendLink({ step: 'email' }, form({ email: 'intrus@exemple.fr' }));
    expect(other.message).toBe(ok.message);
    expect(m.auth.signInWithOtp).toHaveBeenCalledTimes(1);
  });

  it('n’envoie rien sans ALLOWED_EMAIL', async () => {
    vi.stubEnv('ALLOWED_EMAIL', '');
    await sendLink({ step: 'email' }, form({ email: 'nanigeek@gmail.com' }));
    expect(m.auth.signInWithOtp).not.toHaveBeenCalled();
  });

  it('prend SITE_URL en production et refuse un Host forgé', async () => {
    m.host = 'evil.example';
    expect(await sendLink({ step: 'email' }, form({ email: 'nanigeek@gmail.com' }))).toEqual({ step: 'email', error: 'SITE_URL n’est pas configurée.' });
    vi.stubEnv('SITE_URL', 'https://daily-brief.vercel.app');
    await sendLink({ step: 'email' }, form({ email: 'nanigeek@gmail.com' }));
    expect(m.auth.signInWithOtp).toHaveBeenCalledWith(expect.objectContaining({ options: expect.objectContaining({ emailRedirectTo: 'https://daily-brief.vercel.app/auth/confirm' }) }));
  });

  it('refuse une adresse invalide et signale un échec d’envoi', async () => {
    expect((await sendLink({ step: 'email' }, form({ email: 'pas une adresse' }))).error).toBe('Adresse invalide.');
    m.auth.signInWithOtp.mockResolvedValueOnce({ error: { message: 'rate limit' } });
    expect((await sendLink({ step: 'email' }, form({ email: 'nanigeek@gmail.com' }))).error).toMatch(/Envoi impossible/);
  });

  it('vérifie le code reçu puis renvoie vers le Brief', async () => {
    await expect(verifyCode({ step: 'code' }, form({ email: 'nanigeek@gmail.com', code: '123 456' }))).rejects.toThrow('REDIRECT /');
    expect(m.auth.verifyOtp).toHaveBeenCalledWith({ email: 'nanigeek@gmail.com', token: '123456', type: 'email' });
  });

  it('refuse un code mal formé, une autre adresse, ou un code expiré', async () => {
    expect((await verifyCode({ step: 'code' }, form({ email: 'nanigeek@gmail.com', code: 'abc' }))).error).toBe('Code invalide ou expiré.');
    expect((await verifyCode({ step: 'code' }, form({ email: 'intrus@exemple.fr', code: '123456' }))).error).toBe('Code invalide ou expiré.');
    expect(m.auth.verifyOtp).not.toHaveBeenCalled();
    m.auth.verifyOtp.mockResolvedValueOnce({ error: { message: 'expired' } });
    expect((await verifyCode({ step: 'code' }, form({ email: 'nanigeek@gmail.com', code: '123456' }))).error).toBe('Code invalide ou expiré.');
  });
});
```

Fichier `apps/web/test/app/auth-routes.test.ts` :

```ts
// @vitest-environment node
import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => ({
  email: 'nanigeek@gmail.com' as string | null,
  auth: {
    verifyOtp: vi.fn(async (_: unknown) => ({ error: null as null | Error })),
    exchangeCodeForSession: vi.fn(async (_: unknown) => ({ error: null as null | Error })),
    getClaims: vi.fn(async () => ({ data: { claims: { email: m.email } }, error: null })),
    signOut: vi.fn(async () => ({ error: null })),
  },
}));
vi.mock('@/lib/supabase/server', () => ({ createSupabase: async () => ({ auth: m.auth }) }));

import { GET } from '@/app/auth/confirm/route';
import { POST } from '@/app/auth/signout/route';

const get = (qs: string) => GET(new NextRequest(`https://brief.example/auth/confirm${qs}`));

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('ALLOWED_EMAIL', 'nanigeek@gmail.com');
  vi.stubEnv('FIXTURE', '');
  m.email = 'nanigeek@gmail.com';
});

describe('retour du lien magique', () => {
  it('accepte token_hash et renvoie toujours vers /', async () => {
    const r = await get('?token_hash=abc&type=email&next=https://evil.example');
    expect(r.status).toBe(303);
    expect(r.headers.get('location')).toBe('https://brief.example/');
    expect(m.auth.verifyOtp).toHaveBeenCalledWith({ token_hash: 'abc', type: 'email' });
  });

  it('accepte un code PKCE', async () => {
    await get('?code=xyz');
    expect(m.auth.exchangeCodeForSession).toHaveBeenCalledWith('xyz');
  });

  it('renvoie vers /login pour un lien incomplet, inconnu ou expiré', async () => {
    expect((await get('')).headers.get('location')).toBe('https://brief.example/login?erreur=lien');
    expect((await get('?token_hash=abc&type=recovery')).headers.get('location')).toBe('https://brief.example/login?erreur=lien');
    m.auth.verifyOtp.mockResolvedValueOnce({ error: new Error('expired') });
    expect((await get('?token_hash=abc&type=magiclink')).headers.get('location')).toBe('https://brief.example/login?erreur=lien');
  });

  it('déconnecte aussitôt une autre adresse', async () => {
    m.email = 'intrus@exemple.fr';
    expect((await get('?code=xyz')).headers.get('location')).toBe('https://brief.example/login?erreur=refuse');
    expect(m.auth.signOut).toHaveBeenCalled();
  });

  it('déconnecte en POST', async () => {
    const r = await POST(new NextRequest('https://brief.example/auth/signout', { method: 'POST' }));
    expect(r.headers.get('location')).toBe('https://brief.example/login');
    expect(m.auth.signOut).toHaveBeenCalled();
  });
});
```

- [ ] **Étape 2 : vérifier l'échec**

Commande : `npx vitest run --project web apps/web/test/app/login.test.ts apps/web/test/app/auth-routes.test.ts`
Attendu : échec des deux fichiers, `Failed to resolve import "@/app/login/actions"` et `"@/app/auth/confirm/route"`.

- [ ] **Étape 3 : implémenter**

Fichier `apps/web/app/login/actions.ts` :

```ts
'use server';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { fixtureMode, isAllowedEmail, siteOrigin } from '@/lib/env';
import { createSupabase } from '@/lib/supabase/server';

export type LoginState = { step: 'email' | 'code'; email?: string; message?: string; error?: string };

const Email = z.email().max(254);
const Code = z.string().regex(/^\d{6,10}$/);

/** Message identique que l'adresse soit autorisée ou non : la page ne révèle pas l'adresse autorisée. */
const SENT = 'Si cette adresse est autorisée, un lien de connexion vient de partir. Ouvre-le, ou saisis ici le code du courriel.';

async function requestOrigin(): Promise<string | null> {
  const h = await headers();
  const host = h.get('host');
  return host ? `${h.get('x-forwarded-proto') ?? 'http'}://${host}` : null;
}

/**
 * Envoie le lien magique. ALLOWED_EMAIL est vérifié AVANT tout appel à Supabase : une autre adresse
 * ne déclenche aucun courriel (pas d'abus du quota d'envoi, pas de compte créé), avec la même réponse.
 */
export async function sendLink(_prev: LoginState, form: FormData): Promise<LoginState> {
  const email = Email.safeParse(String(form.get('email') ?? '').trim().toLowerCase());
  if (!email.success) return { step: 'email', error: 'Adresse invalide.' };
  if (fixtureMode()) return { step: 'email', error: 'Mode fixture : pas de connexion, l’appli est ouverte.' };
  const sent: LoginState = { step: 'code', email: email.data, message: SENT };
  if (!isAllowedEmail(email.data)) return sent;
  const origin = siteOrigin(await requestOrigin());
  if (!origin) return { step: 'email', error: 'SITE_URL n’est pas configurée.' };
  const supabase = await createSupabase();
  const { error } = await supabase.auth.signInWithOtp({ email: email.data, options: { emailRedirectTo: `${origin}/auth/confirm`, shouldCreateUser: true } });
  if (error) return { step: 'email', error: 'Envoi impossible pour le moment, réessaie dans une minute.' };
  return sent;
}

/**
 * Code à usage unique du même courriel : utile depuis l'appli installée sur l'écran d'accueil, où le
 * lien s'ouvrirait dans le navigateur et non dans l'appli.
 */
export async function verifyCode(prev: LoginState, form: FormData): Promise<LoginState> {
  const email = Email.safeParse(String(form.get('email') ?? '').trim().toLowerCase());
  const code = Code.safeParse(String(form.get('code') ?? '').replace(/\s/g, ''));
  const retry: LoginState = { ...prev, step: 'code', error: 'Code invalide ou expiré.' };
  if (!email.success || !code.success || !isAllowedEmail(email.data)) return retry;
  const supabase = await createSupabase();
  const { error } = await supabase.auth.verifyOtp({ email: email.data, token: code.data, type: 'email' });
  if (error) return retry;
  redirect('/');
}
```

Fichier `apps/web/app/login/LoginForm.tsx` :

```tsx
'use client';
import { useActionState } from 'react';
import { sendLink, verifyCode, type LoginState } from './actions';

export function LoginForm() {
  const [state, send, sending] = useActionState(sendLink, { step: 'email' } as LoginState);
  const [codeState, verify, verifying] = useActionState(verifyCode, { step: 'code' } as LoginState);
  return (
    <>
      <form action={send}>
        <label htmlFor="email">Adresse e-mail</label>
        <input id="email" name="email" type="email" autoComplete="email" required defaultValue={state.email} />
        <button type="submit" disabled={sending}>
          Recevoir le lien
        </button>
      </form>
      {state.message && <p role="status">{state.message}</p>}
      {state.error && <p role="alert">{state.error}</p>}
      {state.step === 'code' && (
        <form action={verify}>
          <input type="hidden" name="email" value={state.email ?? ''} />
          <label htmlFor="code">Code reçu</label>
          <input id="code" name="code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9 ]{6,12}" required />
          <button type="submit" disabled={verifying}>
            Se connecter
          </button>
          {codeState.error && <p role="alert">{codeState.error}</p>}
        </form>
      )}
    </>
  );
}
```

Fichier `apps/web/app/login/page.tsx` :

```tsx
import { LoginForm } from './LoginForm';

const ERRORS: Record<string, string> = {
  refuse: 'Cette adresse n’est pas autorisée à lire le brief.',
  lien: 'Lien invalide ou expiré : demande-en un nouveau.',
};

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ erreur?: string }> }) {
  const erreur = (await searchParams).erreur;
  return (
    <main className="login" data-ed="fr">
      <div className="brand">
        <span className="logo" aria-hidden="true" />
        DAILY BRIEF
      </div>
      <h1>Connexion</h1>
      <p>Un lien de connexion est envoyé à l’adresse autorisée. Le brief est privé.</p>
      {erreur && ERRORS[erreur] && <p role="alert">{ERRORS[erreur]}</p>}
      <LoginForm />
    </main>
  );
}
```

Fichier `apps/web/app/auth/confirm/route.ts` :

```ts
import { NextResponse, type NextRequest } from 'next/server';
import { isAllowedEmail } from '@/lib/env';
import { createSupabase } from '@/lib/supabase/server';

const TYPES = new Set(['email', 'magiclink']);

/**
 * Retour du lien magique. Deux formes : `token_hash` + `type` (modèle de courriel recommandé, marche
 * même si le lien s'ouvre dans un autre navigateur) ou `code` (flux PKCE par défaut). La destination
 * est toujours `/` : aucun paramètre ne choisit où l'on est renvoyé (pas de redirection ouverte).
 */
export async function GET(request: NextRequest) {
  const url = request.nextUrl;
  const to = (path: string) => NextResponse.redirect(new URL(path, url.origin), { status: 303 });
  const supabase = await createSupabase();
  const tokenHash = url.searchParams.get('token_hash');
  const type = url.searchParams.get('type');
  const code = url.searchParams.get('code');
  const { error } =
    tokenHash && type && TYPES.has(type)
      ? await supabase.auth.verifyOtp({ token_hash: tokenHash, type: type as 'email' | 'magiclink' })
      : code
        ? await supabase.auth.exchangeCodeForSession(code)
        : { error: new Error('lien incomplet') };
  if (error) return to('/login?erreur=lien');
  const { data } = await supabase.auth.getClaims();
  if (!isAllowedEmail(typeof data?.claims?.email === 'string' ? data.claims.email : null)) {
    await supabase.auth.signOut();
    return to('/login?erreur=refuse');
  }
  return to('/');
}
```

Fichier `apps/web/app/auth/signout/route.ts` :

```ts
import { NextResponse, type NextRequest } from 'next/server';
import { fixtureMode } from '@/lib/env';
import { createSupabase } from '@/lib/supabase/server';

/** Déconnexion (POST seulement : un lien ou une image ne peut pas déconnecter). */
export async function POST(request: NextRequest) {
  if (!fixtureMode()) await (await createSupabase()).auth.signOut();
  return NextResponse.redirect(new URL('/login', request.nextUrl.origin), { status: 303 });
}
```

- [ ] **Étape 4 : vérifier le succès**

Commande : `npx vitest run --project web apps/web/test/app/login.test.ts apps/web/test/app/auth-routes.test.ts`
Attendu : `Test Files  2 passed (2)`, `Tests  12 passed (12)`.

Commande : `npm test && npm run typecheck`
Attendu : `Test Files  87 passed (87)`, `Tests  877 passed (877)`, typage sans erreur.

- [ ] **Étape 5 : commit**

```bash
git add apps/web/app/login apps/web/app/auth apps/web/test/app/login.test.ts apps/web/test/app/auth-routes.test.ts
git commit -m "feat(web): connexion par lien magique ou code, réservée à ALLOWED_EMAIL"
```

---

### Tâche 8 : carte d'un sujet, carte SVG et brèves

**Fichiers :**
- Créer : `apps/web/components/icons.tsx`, `apps/web/components/MapSvg.tsx`, `apps/web/components/SourcesToggle.tsx`, `apps/web/components/StoryCard.tsx`, `apps/web/components/Briefs.tsx`
- Test : `apps/web/test/components/fixture-views.ts`, `apps/web/test/components/story-card.test.tsx`

Comportement attendu :
- **Ordre (§8.2).** Visuel avec sa légende, kicker et date, titre, « Résumé IA », résumé, quatre chiffres, citation (guillemets de la langue, traduction étiquetée), « Les chiffres divergent », Thread (lien vers sa frise), lien prépa, puis pastilles, « N sources » et « Lire ». Un élément absent ne laisse pas de trou.
- **Carte.** Elle est rendue côté serveur par `renderMap` dans `MapSvg`, seul usage de `dangerouslySetInnerHTML` (voir la décision 7).
- **Photo.** `<img>` seulement depuis `https://images.pexels.com`, avec le crédit du photographe ; sinon un aplat neutre, et la légende « Photo libre · « requête » ».
- **Sources.** « N sources » déplie la liste : média, titre, badge « lu en entier » ou « titre + lien ». « Lire » ouvre la première source lue en entier. Tous les liens sortants portent `rel="noopener noreferrer"`.
- **Textes.** Tout texte de l'édition est échappé par React.

- [ ] **Étape 1 : écrire les tests**

`fixture-views.ts` lit la fixture directement : en jsdom, les chemins tirés de `import.meta.url` (comme dans `pipeline/test/helpers.ts`) ne sont pas fiables.

Fichier `apps/web/test/components/fixture-views.ts` :

```ts
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Brief, Lang } from '@daily-brief/schema';
import { fixturesDir } from '@/lib/data/fixture';
import { editionFromFixture } from '@/lib/data/fixture-edition';
import type { EditionView, StoryView } from '@/lib/data/types';

// Lecture directe : en jsdom, les chemins tirés de import.meta.url (pipeline/test/helpers.ts) ne sont pas fiables.
const brief = (): Brief => JSON.parse(readFileSync(join(fixturesDir(), 'brief-2026-11-06.json'), 'utf8'));

/** Éditions de la fixture au format d'affichage, pour les tests de composants. */
export function fixtureView(lang: Lang, meta: Partial<{ light: boolean; hasAudio: boolean; hasPdf: boolean }> = {}): EditionView {
  const ed = brief().editions.find((e) => e.lang === lang)!;
  return editionFromFixture(ed, { light: false, hasAudio: true, hasPdf: false, generatedAt: '2026-11-06T04:41:00.000Z', ...meta });
}

export function fixtureStory(id: string): StoryView {
  for (const lang of ['fr', 'en', 'es'] as Lang[]) {
    for (const s of fixtureView(lang).sections) {
      const st = s.stories.find((x) => x.id === id);
      if (st) return structuredClone(st);
    }
  }
  throw new Error(`sujet ${id} absent de la fixture`);
}
```

Fichier `apps/web/test/components/story-card.test.tsx` :

```tsx
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { Briefs } from '@/components/Briefs';
import { StoryCard } from '@/components/StoryCard';
import { fixtureStory, fixtureView } from './fixture-views';

const order = (el: HTMLElement) =>
  [...el.querySelectorAll('.media,.photo,.kicker,h3,.ai,.sum,.stats,.quote,.diverge,.thread,.prepa,.srcs')].map((n) => n.className.split(' ')[0] || n.tagName.toLowerCase());

describe('carte d’un sujet', () => {
  it('empile les éléments dans l’ordre du §8.2', () => {
    const { container } = render(<StoryCard story={fixtureStory('2026-11-06-fr-1')} lang="fr" />);
    expect(order(container)).toEqual(['media', 'kicker', 'h3', 'ai', 'sum', 'stats', 'quote', 'diverge', 'thread', 'prepa', 'srcs']);
    expect(container.querySelector('svg.map')).not.toBeNull();
    expect(screen.getByText('Résumé IA · d’après les sources citées')).toBeTruthy();
    expect(screen.getByText(/La question qui est posée/).textContent).toMatch(/^« .* »$/);
  });

  it('ne laisse pas de trou quand des éléments manquent', () => {
    const story = { ...fixtureStory('2026-11-06-fr-5'), stats: [], quote: null, divergences: [], thread: null, prepa: null };
    const { container } = render(<StoryCard story={story} lang="fr" />);
    expect(order(container)).toEqual(['photo', 'kicker', 'h3', 'ai', 'sum', 'srcs']);
  });

  it('affiche une photo Pexels, et un aplat pour toute autre URL', () => {
    const base = fixtureStory('2026-11-06-fr-5');
    const pexels = { id: 1, src: 'https://images.pexels.com/photos/1/p.jpeg', width: 10, height: 10, photographer: 'Ana', photographerUrl: 'https://www.pexels.com/@ana', pexelsUrl: 'https://www.pexels.com/photo/1' };
    const { container, unmount } = render(<StoryCard story={{ ...base, visual: { type: 'photo', query: 'train', pexels } }} lang="fr" />);
    expect(container.querySelector('img')?.getAttribute('src')).toBe('https://images.pexels.com/photos/1/p.jpeg');
    expect(screen.getByText('Pexels · Ana')).toBeTruthy();
    unmount();
    const evil = render(<StoryCard story={{ ...base, visual: { type: 'photo', query: 'train', pexels: { ...pexels, src: 'https://evil.example/p.jpg' } } }} lang="fr" />);
    expect(evil.container.querySelector('img')).toBeNull();
    expect(evil.container.querySelector('.ph')).not.toBeNull();
  });

  it('échappe les textes écrits par le modèle', () => {
    const story = { ...fixtureStory('2026-11-06-fr-5'), title: '<img src=x onerror=alert(1)>', summary: '<script>alert(1)</script>' };
    const { container } = render(<StoryCard story={story} lang="fr" />);
    expect(container.querySelector('script')).toBeNull();
    expect(container.querySelector('h3 img')).toBeNull();
    expect(screen.getByRole('heading').textContent).toBe('<img src=x onerror=alert(1)>');
  });

  it('déplie la liste des sources et ouvre la première source lue en entier', async () => {
    const { container } = render(<StoryCard story={fixtureStory('2026-11-06-fr-2')} lang="fr" />);
    const more = container.querySelector('.more') as HTMLElement;
    expect(more.hidden).toBe(true);
    await userEvent.click(screen.getByRole('button', { name: '6 sources' }));
    expect(more.hidden).toBe(false);
    expect(within(more).getAllByRole('link')).toHaveLength(6);
    const read = screen.getByRole('link', { name: /^Lire/ });
    expect(read.getAttribute('rel')).toBe('noopener noreferrer');
    expect(read.getAttribute('href')).toBe(fixtureStory('2026-11-06-fr-2').sources.find((s) => s.readFull)!.url);
  });

  it('lie le Thread à sa frise', () => {
    const story = fixtureStory('2026-11-06-fr-4');
    render(<StoryCard story={story} lang="fr" />);
    expect(screen.getByRole('link', { name: /Épisodes méditerranéens 2026/ }).getAttribute('href')).toBe(`/threads/${story.thread!.id}`);
  });

  it('liste les brèves en anglais avec leur média', () => {
    const tec = fixtureView('en').sections.find((s) => s.key === 'tec')!;
    render(<Briefs briefs={tec.briefs} lang="en" />);
    expect(screen.getByText('In brief')).toBeTruthy();
    expect(screen.getAllByRole('link')).toHaveLength(2);
  });
});
```

- [ ] **Étape 2 : vérifier l'échec**

Commande : `npx vitest run --project web apps/web/test/components/story-card.test.tsx`
Attendu : échec, `Failed to resolve import "@/components/Briefs"`.

- [ ] **Étape 3 : implémenter**

Fichier `apps/web/components/icons.tsx` :

```tsx
/** Icônes SVG de la maquette (reference/render.mjs, ICON), en composants. */

export const Spark = () => (
  <svg viewBox="0 0 12 12" aria-hidden="true">
    <path d="M6 0l1.4 4.6L12 6 7.4 7.4 6 12 4.6 7.4 0 6l4.6-1.4z" fill="currentColor" />
  </svg>
);
export const Ext = () => (
  <svg viewBox="0 0 11 11" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
    <path d="M3 8l5-5M4 3h4v4" />
  </svg>
);
export const ThreadIcon = () => (
  <svg viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
    <circle cx="4" cy="4" r="2.2" />
    <circle cx="14" cy="9" r="2.2" />
    <circle cx="4" cy="14" r="2.2" />
    <path d="M6 5l6 3M6 13l6-3" />
  </svg>
);
export const Chev = () => (
  <svg className="chev" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
    <path d="M7 4l5 5-5 5" />
  </svg>
);
export const Cap = () => (
  <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" aria-hidden="true">
    <path d="M1 6l7-3.5L15 6 8 9.5z" />
    <path d="M4 7.6v3.2c1.2 1.1 2.6 1.6 4 1.6s2.8-.5 4-1.6V7.6" />
  </svg>
);
export const Split = () => (
  <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden="true">
    <path d="M8 2v4M8 6L3.5 11M8 6l4.5 5" />
    <circle cx="3.5" cy="12.5" r="1.6" />
    <circle cx="12.5" cy="12.5" r="1.6" />
  </svg>
);
export const Play = () => (
  <svg viewBox="0 0 14 14" aria-hidden="true">
    <path d="M3 1.5v11l9-5.5z" fill="currentColor" />
  </svg>
);
export const Pause = () => (
  <svg viewBox="0 0 14 14" aria-hidden="true">
    <path d="M3 1.5h3v11H3zM8 1.5h3v11H8z" fill="currentColor" />
  </svg>
);
export const Bell = () => (
  <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden="true">
    <path d="M6 1.5a3 3 0 013 3V7l1 1.5H2L3 7V4.5a3 3 0 013-3zM5 10.5h2" />
  </svg>
);
export const TabBrief = () => (
  <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
    <rect x="3" y="3" width="14" height="14" rx="3" />
    <path d="M6.5 7.5h7M6.5 10.5h7M6.5 13.5h4" />
  </svg>
);
export const TabThreads = () => (
  <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
    <circle cx="5" cy="5" r="2.2" />
    <circle cx="15" cy="10" r="2.2" />
    <circle cx="5" cy="15" r="2.2" />
    <path d="M7 6l6 3M7 14l6-3" />
  </svg>
);
export const TabVocab = () => (
  <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
    <path d="M4 4h9a3 3 0 013 3v9H7a3 3 0 01-3-3z" />
    <path d="M8 8h5M8 11h3" />
  </svg>
);
export const TabArchive = () => (
  <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
    <rect x="3" y="4" width="14" height="13" rx="2" />
    <path d="M3 8h14M7 2.5v3M13 2.5v3" />
  </svg>
);
```

Fichier `apps/web/components/MapSvg.tsx` :

```tsx
import { renderMap } from '@daily-brief/maps';
import type { MapSpec } from '@daily-brief/schema';

/**
 * Carte SVG rendue côté serveur par @daily-brief/maps. C'est le SEUL usage de dangerouslySetInnerHTML
 * de l'appli (vérifié par test/security/static.test.ts), et il est sûr :
 * - le SVG est produit par notre code, pas par le modèle : tracés et coordonnées sont des nombres,
 *   les classes viennent d'une liste fixe ;
 * - les seuls textes venus de l'édition (noms et libellés des lieux, `aria-label`) passent par
 *   `escapeXml` de packages/maps/src/svg.ts (& < > " échappés), testé avec une balise <script> ;
 * - le MapSpec est validé par zod (MapSpecSchema) avant d'arriver ici.
 */
export function MapSvg({ spec, label }: { spec: MapSpec; label: string }) {
  return <span style={{ display: 'contents' }} dangerouslySetInnerHTML={{ __html: renderMap(spec, label) }} />;
}
```

Fichier `apps/web/components/SourcesToggle.tsx` :

```tsx
'use client';
import { useId, useState, type ReactNode } from 'react';
import { Ext } from './icons';

/** Pied de carte : pile de médias, bouton « N sources » qui déplie la liste, bouton « Lire ». */
export function SourcesToggle({ stack, count, sourcesLabel, readLabel, readUrl, children }: { stack: ReactNode; count: number; sourcesLabel: string; readLabel: string; readUrl: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  return (
    <>
      <div className="srcs">
        {stack}
        <div className="btns">
          {count > 1 && (
            <button type="button" className="btn" aria-expanded={open} aria-controls={id} onClick={() => setOpen((o) => !o)}>
              {count} {sourcesLabel}
            </button>
          )}
          <a className="btn pri" target="_blank" rel="noopener noreferrer" href={readUrl}>
            {readLabel} <Ext />
          </a>
        </div>
      </div>
      {count > 1 && (
        <div className="more" id={id} hidden={!open}>
          {children}
        </div>
      )}
    </>
  );
}
```

Fichier `apps/web/components/StoryCard.tsx` :

```tsx
import Link from 'next/link';
import type { Lang, SourceRef } from '@daily-brief/schema';
import { pexelsSrc, safeUrl } from '@/lib/data/rows';
import type { StoryView } from '@/lib/data/types';
import { favColor, initials, QUOTE_MARKS, T, uniqueOutlets } from '@/lib/i18n';
import { Cap, Chev, Split, Spark, ThreadIcon } from './icons';
import { MapSvg } from './MapSvg';
import { SourcesToggle } from './SourcesToggle';

/** Pastille d'un média (initiales sur sa couleur). */
export function Fav({ outlet, small }: { outlet: string; small?: boolean }) {
  return (
    <span className={small ? 'fav sm' : 'fav'} style={{ background: favColor(outlet) }} aria-hidden="true">
      {initials(outlet)}
    </span>
  );
}

function Visual({ story }: { story: StoryView }) {
  const v = story.visual;
  if (v.type === 'map') {
    return (
      <div className="media">
        <MapSvg spec={v.map} label={v.caption} />
        <span className="cap mono">{v.caption}</span>
      </div>
    );
  }
  const src = pexelsSrc(v.pexels?.src);
  const credit = v.pexels ? safeUrl(v.pexels.photographerUrl) : null;
  return (
    <div className="photo">
      {src ? <img src={src} alt={v.pexels?.alt ?? ''} loading="lazy" decoding="async" referrerPolicy="no-referrer" /> : <div className="ph" style={{ background: 'linear-gradient(165deg,var(--surface-2) 0%,var(--line-2) 100%)' }} />}
      <span className="pex mono">{v.pexels && credit ? <a href={credit} target="_blank" rel="noopener noreferrer">Pexels · {v.pexels.photographer}</a> : 'Pexels'}</span>
      <span className="cap mono">Photo libre · « {v.query} »</span>
    </div>
  );
}

/** Première source lue en entier (bouton « Lire »), sinon la première. */
export const primarySource = (sources: SourceRef[]) => sources.find((s) => s.readFull) ?? sources[0];

/**
 * Carte d'un sujet (spec §8.2), dans l'ordre : visuel, kicker et date, titre, « Résumé IA », résumé,
 * chiffres, citation, divergences, Thread, lien prépa, sources. Un élément absent ne laisse pas de trou.
 * Tous les textes passent par JSX (échappés par React).
 */
export function StoryCard({ story, lang }: { story: StoryView; lang: Lang }) {
  const t = T[lang];
  const [open, close] = QUOTE_MARKS[lang];
  const outlets = uniqueOutlets(story.sources);
  const primary = primarySource(story.sources);
  return (
    <article className="card" data-story={story.id}>
      <Visual story={story} />
      <div className="body">
        <div className="kicker mono">
          <span className="acc">{story.kicker}</span>
          <i />
          {story.date}
        </div>
        <h3>{story.title}</h3>
        <div className="ai mono">
          <Spark />
          {t.ai}
        </div>
        <p className="sum">{story.summary}</p>
        {story.stats.length > 0 && (
          <div className="stats">
            {story.stats.map((s, i) => (
              <div className="stat" key={i}>
                <b>{s.value}</b>
                <span>{s.label}</span>
              </div>
            ))}
          </div>
        )}
        {story.quote && (
          <blockquote className="quote">
            <p>
              {open}
              {story.quote.text}
              {close}
            </p>
            {story.quote.translation && (
              <p className="tr">
                <span className="mono">{t.translation}</span> {story.quote.translation}
              </p>
            )}
            <cite className="mono">{story.quote.speaker}</cite>
          </blockquote>
        )}
        {story.divergences.length > 0 && (
          <div className="diverge">
            <div className="dh mono">
              <Split />
              {t.diverge}
            </div>
            {story.divergences.map((d, i) => (
              <div className="drow" key={i}>
                <span className="dk">{d.metric}</span>
                <div className="dv">
                  <b>{d.a.value}</b>
                  <small className="mono">{d.a.by}</small>
                </div>
                <div className="dv">
                  <b>{d.b.value}</b>
                  <small className="mono">{d.b.by}</small>
                </div>
              </div>
            ))}
          </div>
        )}
        {story.thread && (
          <Link className="thread" href={`/threads/${story.thread.id}`}>
            <ThreadIcon />
            <div>
              <b className="mono">Thread</b>
              <span>
                {story.thread.title} {story.thread.subtitle && <em>· {story.thread.subtitle}</em>}
              </span>
            </div>
            <Chev />
          </Link>
        )}
        {story.prepa && (
          <div className="prepa">
            <Cap />
            <div>
              <b className="mono">
                {t.prepa} · {story.prepa.subject}
              </b>
              <p>{story.prepa.text}</p>
            </div>
          </div>
        )}
        <SourcesToggle
          stack={
            <div className="stack">
              <div className="favs">
                {outlets.slice(0, 4).map((o) => (
                  <Fav key={o} outlet={o} />
                ))}
              </div>
              <small>
                {outlets.slice(0, 2).join(', ')}
                {outlets.length > 2 ? ` +${outlets.length - 2}` : ''}
              </small>
            </div>
          }
          count={story.sources.length}
          sourcesLabel={t.sources}
          readLabel={t.read}
          readUrl={primary.url}
        >
          {story.sources.map((s, i) => (
            <a key={i} target="_blank" rel="noopener noreferrer" href={s.url}>
              <Fav outlet={s.outlet} small />
              <span className="mt">
                <b className="mono">{s.outlet}</b>
                {s.title}
              </span>
              <span className={s.readFull ? 'rd mono on' : 'rd mono'}>{s.readFull ? t.full : t.title}</span>
            </a>
          ))}
        </SourcesToggle>
      </div>
    </article>
  );
}
```

Fichier `apps/web/components/Briefs.tsx` :

```tsx
import type { Lang, SourceRef } from '@daily-brief/schema';
import { T } from '@/lib/i18n';
import { Ext } from './icons';
import { Fav } from './StoryCard';

/** « En bref » : titres et liens des brèves d'une rubrique. */
export function Briefs({ briefs, lang }: { briefs: SourceRef[]; lang: Lang }) {
  if (briefs.length === 0) return null;
  return (
    <div className="briefs">
      <div className="bh mono">{T[lang].briefs}</div>
      {briefs.map((b, i) => (
        <a className="brief" key={i} target="_blank" rel="noopener noreferrer" href={b.url}>
          <Fav outlet={b.outlet} small />
          <span className="bt">
            {b.title}
            <small className="mono">{b.outlet}</small>
          </span>
          <Ext />
        </a>
      ))}
    </div>
  );
}
```

- [ ] **Étape 4 : vérifier le succès**

Commande : `npx vitest run --project web apps/web/test/components/story-card.test.tsx`
Attendu : `Tests  7 passed (7)`.

Commande : `npm test && npm run typecheck`
Attendu : `Test Files  88 passed (88)`, `Tests  884 passed (884)`, typage sans erreur.

- [ ] **Étape 5 : commit**

```bash
git add apps/web/components/icons.tsx apps/web/components/MapSvg.tsx apps/web/components/SourcesToggle.tsx apps/web/components/StoryCard.tsx apps/web/components/Briefs.tsx apps/web/test/components/fixture-views.ts apps/web/test/components/story-card.test.tsx
git commit -m "feat(web): carte d'un sujet (§8.2), carte SVG côté serveur et brèves"
```

---

### Tâche 9 : en-tête, bandeaux et barre d'onglets

**Fichiers :**
- Créer : `apps/web/components/TopBar.tsx`, `apps/web/components/Banner.tsx`, `apps/web/components/TabBar.tsx`, `apps/web/app/(app)/layout.tsx`
- Test : `apps/web/test/components/chrome.test.tsx`

Comportement attendu :
- **En-tête collant.** Il porte le logo demi-disque à l'accent de l'édition, la date (« VEN 06.11.26 ») et l'heure de génération à Paris. Les trois onglets d'édition sont des liens `?ed=xx` sur la page courante (Brief ou édition archivée), et l'onglet actif porte `aria-current="page"`.
- **Bandeaux.** « Édition allégée » et « Brief de la veille » (avec la date), dans la langue de l'édition.
- **Barre d'onglets.** Brief, Threads, Vocab, Archive ; l'onglet de la page courante est allumé. Santé et les éditions archivées allument respectivement Archive et Brief.
- **Mise en page des écrans.** `(app)/layout.tsx` pose l'accent de l'édition choisie (cookie `ed`) et la barre d'onglets.

- [ ] **Étape 1 : écrire les tests**

Fichier `apps/web/test/components/chrome.test.tsx` :

```tsx
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Banner } from '@/components/Banner';
import { TabBar } from '@/components/TabBar';
import { TopBar } from '@/components/TopBar';

const nav = vi.hoisted(() => ({ path: '/' }));
vi.mock('next/navigation', () => ({ usePathname: () => nav.path }));

describe('en-tête, bandeaux et barre d’onglets', () => {
  it('l’en-tête montre la date, l’heure de Paris et les trois éditions', () => {
    render(<TopBar lang="en" date="2026-11-06" generatedAt="2026-11-06T04:41:00Z" basePath="/" />);
    expect(screen.getByText('VEN 06.11.26 · 05:41')).toBeTruthy();
    const tabs = screen.getAllByRole('link');
    expect(tabs.map((a) => a.getAttribute('href'))).toEqual(['/?ed=fr', '/?ed=en', '/?ed=es']);
    expect(tabs.map((a) => a.getAttribute('aria-current'))).toEqual([null, 'page', null]);
  });

  it('les onglets d’une édition archivée restent sur sa date', () => {
    render(<TopBar lang="fr" date="2026-11-05" basePath="/edition/2026-11-05" />);
    expect(screen.getAllByRole('link')[2].getAttribute('href')).toBe('/edition/2026-11-05?ed=es');
  });

  it('affiche les deux bandeaux dans la langue de l’édition', () => {
    render(<Banner kind="light" lang="fr" date="2026-11-06" />);
    expect(screen.getByRole('status').textContent).toBe('Édition allégéeÉdition allégée : peu de sources lisibles ce matin.');
    render(<Banner kind="yesterday" lang="en" date="2026-11-05" />);
    expect(screen.getAllByRole('status')[1].textContent).toContain('Yesterday’s brief (Thu 5 Nov)');
  });

  it('allume l’onglet de la page courante (Santé est rangée sous Archive)', () => {
    nav.path = '/threads/abc';
    const { unmount } = render(<TabBar />);
    expect(screen.getByRole('link', { name: 'Threads' }).className).toBe('on');
    expect(screen.getAllByRole('link').map((a) => a.textContent)).toEqual(['Brief', 'Threads', 'Vocab', 'Archive']);
    unmount();
    nav.path = '/sante';
    render(<TabBar />);
    expect(screen.getByRole('link', { name: 'Archive' }).getAttribute('aria-current')).toBe('page');
  });
});
```

- [ ] **Étape 2 : vérifier l'échec**

Commande : `npx vitest run --project web apps/web/test/components/chrome.test.tsx`
Attendu : échec, `Failed to resolve import "@/components/Banner"`.

- [ ] **Étape 3 : implémenter**

Fichier `apps/web/components/TopBar.tsx` :

```tsx
import Link from 'next/link';
import { LANGS, type Lang } from '@daily-brief/schema';
import { headerDate, parisTime } from '@/lib/dates';
import { REGION, T } from '@/lib/i18n';

/**
 * En-tête collant : logo demi-disque à l'accent de l'édition, date, onglets FR/EN/ES. Les onglets sont
 * des liens `?ed=xx` : le proxy retient le choix dans le cookie `ed`, sans JavaScript.
 */
export function TopBar({ lang, date, generatedAt, basePath }: { lang: Lang; date: string; generatedAt?: string; basePath: string }) {
  return (
    <header className="topbar">
      <div className="brandrow">
        <div className="brand">
          <span className="logo" aria-hidden="true" />
          DAILY BRIEF
        </div>
        <div className="date mono">
          {headerDate(date)}
          {generatedAt ? ` · ${parisTime(generatedAt)}` : ''}
        </div>
      </div>
      <nav className="editions" aria-label="Éditions">
        {LANGS.map((l) => (
          <Link key={l} href={`${basePath}?ed=${l}`} data-ed={l} aria-current={l === lang ? 'page' : undefined} prefetch={false}>
            <b>{T[l].label}</b>
            <span className="mono">{REGION[l]}</span>
          </Link>
        ))}
      </nav>
    </header>
  );
}
```

Fichier `apps/web/components/Banner.tsx` :

```tsx
import type { Lang } from '@daily-brief/schema';
import { shortDate } from '@/lib/dates';
import { T } from '@/lib/i18n';

/** Bandeaux de l'édition (spec §12) : « édition allégée » et « brief de la veille ». */
export function Banner({ kind, lang, date }: { kind: 'light' | 'yesterday'; lang: Lang; date: string }) {
  const t = T[lang];
  return (
    <p className="banner" role="status" data-kind={kind}>
      <b className="mono">{kind === 'light' ? 'Édition allégée' : 'Brief de la veille'}</b>
      {kind === 'light' ? t.light : t.yesterday(shortDate(date, lang))}
    </p>
  );
}
```

Fichier `apps/web/components/TabBar.tsx` :

```tsx
'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { TabArchive, TabBrief, TabThreads, TabVocab } from './icons';

const TABS = [
  { href: '/', label: 'Brief', Icon: TabBrief, match: (p: string) => p === '/' || p.startsWith('/edition/') },
  { href: '/threads', label: 'Threads', Icon: TabThreads, match: (p: string) => p.startsWith('/threads') },
  { href: '/vocab', label: 'Vocab', Icon: TabVocab, match: (p: string) => p.startsWith('/vocab') },
  { href: '/archive', label: 'Archive', Icon: TabArchive, match: (p: string) => p.startsWith('/archive') || p.startsWith('/sante') },
];

/** Barre d'onglets du bas (maquette) : Brief, Threads, Vocab, Archive (la page Santé est rangée sous Archive). */
export function TabBar() {
  const path = usePathname() ?? '/';
  return (
    <nav className="tabbar" aria-label="Navigation principale">
      {TABS.map(({ href, label, Icon, match }) => (
        <Link key={href} href={href} className={match(path) ? 'on' : undefined} aria-current={match(path) ? 'page' : undefined}>
          <Icon />
          {label}
        </Link>
      ))}
    </nav>
  );
}
```

Fichier `apps/web/app/(app)/layout.tsx` :

```tsx
import { cookies } from 'next/headers';
import type { ReactNode } from 'react';
import { TabBar } from '@/components/TabBar';
import { chosenLang, EDITION_COOKIE } from '@/lib/edition-choice';

/** Écrans de l'appli : accent de l'édition choisie et barre d'onglets en bas. */
export default async function AppLayout({ children }: { children: ReactNode }) {
  const lang = chosenLang((await cookies()).get(EDITION_COOKIE)?.value);
  return (
    <div className="app" data-ed={lang}>
      {children}
      <TabBar />
    </div>
  );
}
```

- [ ] **Étape 4 : vérifier le succès**

Commande : `npx vitest run --project web apps/web/test/components/chrome.test.tsx`
Attendu : `Tests  4 passed (4)`.

Commande : `npm test && npm run typecheck`
Attendu : `Test Files  89 passed (89)`, `Tests  888 passed (888)`, typage sans erreur.

- [ ] **Étape 5 : commit**

```bash
git add apps/web/components/TopBar.tsx apps/web/components/Banner.tsx apps/web/components/TabBar.tsx "apps/web/app/(app)/layout.tsx" apps/web/test/components/chrome.test.tsx
git commit -m "feat(web): en-tête collant, bandeaux et barre d'onglets"
```

---

### Tâche 10 : écran d'une édition, lecteur, puces, Vocab du jour et actions serveur

**Fichiers :**
- Créer : `apps/web/app/actions.ts`, `apps/web/components/Player.tsx`, `apps/web/components/MorningBrief.tsx`, `apps/web/components/RubricFilter.tsx`, `apps/web/components/VocabCard.tsx`, `apps/web/components/FollowButton.tsx`, `apps/web/components/EditionScreen.tsx`
- Test : `apps/web/test/components/edition.test.tsx`, `apps/web/test/app/actions.test.ts`

Comportement attendu :
- **Actions serveur.** `setVocabSelected`, `queueAnki` et `setThreadFollowed` valident leur entrée par `z.strictObject` (uuid, 1 à 50 identifiants, booléens ; toute autre clé est refusée), revérifient l'utilisateur, puis écrivent par la `DataSource`. Les résultats : `{ ok: true, count }`, « Demande invalide. », « Session expirée : reconnecte-toi. » ou « Enregistrement impossible, réessaie. ».
- **Morning Brief.** « Morning Brief · 5 infos · 10 min », le titre du jour, le lecteur, puis les cinq infos numérotées avec leur rubrique.
- **Lecteur.** Il n'apparaît que si l'édition a un MP3 ; sinon rien, sans message. Sa source est `/audio/<date>/<langue>`. La durée vient de `loadedmetadata` (« –:–– » avant) ; les 46 barres suivent la lecture ; lecture et pause.
- **Puces.** « Tout » et les neuf rubriques ; une rubrique absente a sa puce grisée et affiche le message vide. Le filtrage est fait en CSS : les rubriques restent rendues côté serveur.
- **Rubriques.** Chacune a son en-tête (titre, « N sujets » en comptant les brèves), ses cartes et « En bref ».
- **Vocab du jour.**
  - **Cases.** Chaque case écrit `selected` ; « Tout cocher » et « Tout décocher » les basculent toutes.
  - **Anki.** « Ajouter N mots à Anki » compte les mots cochés encore à `none`, puis affiche « N mots en file pour Anki ✓ ».
  - **Échec.** La case revient à son état et un message d'alerte s'affiche.
- **Bandeaux et colophon.** « Brief de la veille » s'affiche si l'édition montrée n'est pas celle du jour, « édition allégée » si `light`. Le colophon donne l'heure de génération et le nombre de médias, avec un lien « PDF du jour » si le PDF existe.
- **`FollowButton`.** Il écrit `followed` (`aria-pressed`) ; il est utilisé par la frise de la tâche 11.

- [ ] **Étape 1 : écrire les tests**

Fichier `apps/web/test/app/actions.test.ts` :

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => ({
  user: { email: 'nanigeek@gmail.com' } as { email: string } | null,
  ds: { setSelected: vi.fn(async (ids: string[]) => ids.length), queueAnki: vi.fn(async (ids: string[]) => ids.length), setFollowed: vi.fn(async () => 1) },
}));
vi.mock('@/lib/auth', () => ({ currentUser: async () => m.user }));
vi.mock('@/lib/data', () => ({ getDataSource: async () => m.ds }));

import { queueAnki, setThreadFollowed, setVocabSelected } from '@/app/actions';

const ID = '3f2a1b4c-5d6e-4f70-8a9b-0c1d2e3f4a5b';

beforeEach(() => {
  m.user = { email: 'nanigeek@gmail.com' };
  vi.clearAllMocks();
});

describe('actions serveur', () => {
  it('écrit selected, anki_status et followed après validation', async () => {
    expect(await setVocabSelected({ ids: [ID], selected: true })).toEqual({ ok: true, count: 1 });
    expect(m.ds.setSelected).toHaveBeenCalledWith([ID], true);
    expect(await queueAnki({ ids: [ID, ID] })).toEqual({ ok: true, count: 2 });
    expect(await setThreadFollowed({ id: ID, followed: false })).toEqual({ ok: true, count: 1 });
    expect(m.ds.setFollowed).toHaveBeenCalledWith(ID, false);
  });

  it('refuse toute entrée mal formée ou d’autres colonnes, sans écrire', async () => {
    for (const bad of [null, { ids: ['pas-un-uuid'], selected: true }, { ids: [], selected: true }, { ids: [ID], selected: 'oui' }, { ids: [ID], selected: true, term: 'x' }, { ids: Array(51).fill(ID), selected: true }]) {
      expect(await setVocabSelected(bad)).toEqual({ ok: false, error: 'Demande invalide.' });
    }
    expect(await queueAnki({ ids: [ID], anki_status: 'sent' })).toEqual({ ok: false, error: 'Demande invalide.' });
    expect(await setThreadFollowed({ id: ID, followed: true, title: 'x' })).toEqual({ ok: false, error: 'Demande invalide.' });
    expect(m.ds.setSelected).not.toHaveBeenCalled();
  });

  it('refuse sans utilisateur autorisé', async () => {
    m.user = null;
    expect(await setVocabSelected({ ids: [ID], selected: true })).toEqual({ ok: false, error: 'Session expirée : reconnecte-toi.' });
    expect(m.ds.setSelected).not.toHaveBeenCalled();
  });

  it('rend une erreur sobre quand la base refuse', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    m.ds.setFollowed.mockRejectedValueOnce(new Error('permission denied for table threads'));
    expect(await setThreadFollowed({ id: ID, followed: true })).toEqual({ ok: false, error: 'Enregistrement impossible, réessaie.' });
  });
});
```

Fichier `apps/web/test/components/edition.test.tsx` :

```tsx
import { act, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

vi.mock('next/navigation', () => ({ usePathname: () => '/' }));
const actions = vi.hoisted(() => ({
  setVocabSelected: vi.fn(async (_: unknown) => ({ ok: true, count: 1 }) as { ok: true; count: number } | { ok: false; error: string }),
  queueAnki: vi.fn(async (input: unknown) => ({ ok: true, count: (input as { ids: string[] }).ids.length })),
  setThreadFollowed: vi.fn(async () => ({ ok: true, count: 1 })),
}));
vi.mock('@/app/actions', () => actions);

import { EditionScreen } from '@/components/EditionScreen';
import { formatTime } from '@/components/Player';
import { fixtureView } from './fixture-views';

describe('écran d’une édition', () => {
  it('rend les rubriques, les puces grisées et le colophon', () => {
    const { container } = render(<EditionScreen edition={fixtureView('fr')} basePath="/" />);
    expect([...container.querySelectorAll('.rub')].map((r) => r.getAttribute('data-rub'))).toEqual(['pol', 'int', 'env', 'eco', 'ent', 'dro', 'tec', 'spo']);
    expect([...container.querySelectorAll('.chip.dim')].map((c) => c.textContent)).toEqual(['Culture']);
    expect(screen.getByText(/Édition générée à 05:41 · 15 médias/)).toBeTruthy();
    expect(container.querySelectorAll('.points li')).toHaveLength(5);
    expect(container.querySelector('.banner')).toBeNull();
  });

  it('filtre par rubrique et montre le message vide pour une rubrique absente', async () => {
    const { container } = render(<EditionScreen edition={fixtureView('fr')} basePath="/" />);
    await userEvent.click(screen.getByRole('button', { name: 'Culture' }));
    expect(container.querySelector('.ed-filter')?.getAttribute('data-show')).toBe('cul');
    expect((container.querySelector('.empty') as HTMLElement).hidden).toBe(false);
    await userEvent.click(screen.getByRole('button', { name: 'Tout' }));
    expect((container.querySelector('.empty') as HTMLElement).hidden).toBe(true);
  });

  it('affiche les bandeaux « brief de la veille » et « édition allégée »', () => {
    render(<EditionScreen edition={fixtureView('es', { light: true })} basePath="/" yesterdayOf="2026-11-07" />);
    expect(screen.getAllByRole('status').map((s) => s.getAttribute('data-kind'))).toEqual(['yesterday', 'light']);
  });

  it('montre le lecteur seulement s’il y a un MP3, et lit sa durée dans les métadonnées', () => {
    const { container, unmount } = render(<EditionScreen edition={fixtureView('fr', { hasAudio: false })} basePath="/" />);
    expect(container.querySelector('.player')).toBeNull();
    unmount();
    const withAudio = render(<EditionScreen edition={fixtureView('fr')} basePath="/" />);
    const audio = withAudio.container.querySelector('audio')!;
    expect(audio.getAttribute('src')).toBe('/audio/2026-11-06/fr');
    expect(withAudio.container.querySelector('.ptime')?.textContent).toContain('–:––');
    Object.defineProperty(audio, 'duration', { value: 204 });
    act(() => {
      fireEvent.loadedMetadata(audio);
    });
    expect(withAudio.container.querySelector('.ptime')?.textContent).toContain('3:24');
    expect(formatTime(Number.NaN)).toBe('–:––');
  });

  it('a un lien PDF seulement si le PDF existe', () => {
    render(<EditionScreen edition={fixtureView('fr', { hasPdf: true })} basePath="/" />);
    expect(screen.getByRole('link', { name: 'PDF du jour' }).getAttribute('href')).toBe('/pdf/2026-11-06');
  });
});

describe('Vocab du jour', () => {
  it('coche, met en file Anki et compte les mots', async () => {
    render(<EditionScreen edition={fixtureView('en')} basePath="/" />);
    const boxes = screen.getAllByRole('checkbox');
    expect(boxes).toHaveLength(6);
    expect((screen.getByRole('button', { name: 'Ajouter à Anki' }) as HTMLButtonElement).disabled).toBe(true);
    await userEvent.click(boxes[0]);
    await userEvent.click(boxes[1]);
    expect(actions.setVocabSelected).toHaveBeenLastCalledWith({ ids: [expect.any(String)], selected: true });
    await userEvent.click(screen.getByRole('button', { name: 'Ajouter 2 mots à Anki' }));
    expect(actions.queueAnki).toHaveBeenCalledWith({ ids: [expect.any(String), expect.any(String)] });
    expect(screen.getByText('2 mots en file pour Anki ✓')).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Ajouter à Anki' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('« Tout cocher » coche les six mots d’un coup', async () => {
    render(<EditionScreen edition={fixtureView('es')} basePath="/" />);
    await userEvent.click(screen.getByRole('button', { name: 'Tout cocher' }));
    expect(actions.setVocabSelected).toHaveBeenLastCalledWith({ ids: expect.arrayContaining([expect.any(String)]), selected: true });
    expect((actions.setVocabSelected.mock.lastCall![0] as { ids: string[] }).ids).toHaveLength(6);
    expect(screen.getByRole('button', { name: 'Tout décocher' })).toBeTruthy();
  });

  it('remet la case dans son état et prévient si l’écriture échoue', async () => {
    actions.setVocabSelected.mockResolvedValueOnce({ ok: false, error: 'Session expirée : reconnecte-toi.' });
    render(<EditionScreen edition={fixtureView('en')} basePath="/" />);
    const box = screen.getAllByRole('checkbox')[0] as HTMLInputElement;
    await userEvent.click(box);
    expect(box.checked).toBe(false);
    expect(screen.getByRole('alert').textContent).toBe('Session expirée : reconnecte-toi.');
  });
});
```

- [ ] **Étape 2 : vérifier l'échec**

Commande : `npx vitest run --project web apps/web/test/app/actions.test.ts apps/web/test/components/edition.test.tsx`
Attendu : échec des deux fichiers, `Failed to resolve import "@/app/actions"` et `"@/components/EditionScreen"`.

- [ ] **Étape 3 : implémenter**

Fichier `apps/web/app/actions.ts` :

```ts
'use server';
import { z } from 'zod';
import { currentUser } from '@/lib/auth';
import { getDataSource } from '@/lib/data';

/**
 * Actions serveur de l'appli : les seules écritures, et seulement sur les colonnes que la RLS ouvre
 * (vocab_items.selected, vocab_items.anki_status → queued, threads.followed). Chaque entrée est
 * validée par zod, l'utilisateur est revérifié, et la base refuse de toute façon le reste.
 */

export type ActionResult = { ok: true; count: number } | { ok: false; error: string };

const Ids = z.array(z.uuid()).min(1).max(50);
const SelectInput = z.strictObject({ ids: Ids, selected: z.boolean() });
const AnkiInput = z.strictObject({ ids: Ids });
const FollowInput = z.strictObject({ id: z.uuid(), followed: z.boolean() });

const INVALID: ActionResult = { ok: false, error: 'Demande invalide.' };
const SESSION: ActionResult = { ok: false, error: 'Session expirée : reconnecte-toi.' };
const FAILED: ActionResult = { ok: false, error: 'Enregistrement impossible, réessaie.' };

async function run<T>(schema: z.ZodType<T>, input: unknown, write: (value: T) => Promise<number>): Promise<ActionResult> {
  const parsed = schema.safeParse(input);
  if (!parsed.success) return INVALID;
  if (!(await currentUser())) return SESSION;
  try {
    return { ok: true, count: await write(parsed.data) };
  } catch (e) {
    console.error('[daily-brief] écriture refusée', e instanceof Error ? e.message : e);
    return FAILED;
  }
}

export async function setVocabSelected(input: unknown): Promise<ActionResult> {
  return run(SelectInput, input, async ({ ids, selected }) => (await getDataSource()).setSelected(ids, selected));
}

export async function queueAnki(input: unknown): Promise<ActionResult> {
  return run(AnkiInput, input, async ({ ids }) => (await getDataSource()).queueAnki(ids));
}

export async function setThreadFollowed(input: unknown): Promise<ActionResult> {
  return run(FollowInput, input, async ({ id, followed }) => (await getDataSource()).setFollowed(id, followed));
}
```

Fichier `apps/web/components/Player.tsx` :

```tsx
'use client';
import { useEffect, useRef, useState } from 'react';
import { Pause, Play } from './icons';

const BARS = 46;
/** Hauteurs des barres, déterministes (même formule que design/app.js). */
export const BAR_HEIGHTS = Array.from({ length: BARS }, (_, i) => 6 + Math.round(Math.abs(Math.sin(i * 1.7) * 14 + Math.sin(i * 0.6) * 6)));

export function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '–:––';
  const s = Math.round(seconds);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/**
 * Lecteur du Morning Brief. `src` est une route de l'appli (/audio/<date>/<langue>) qui redirige vers
 * une URL signée de courte durée : l'URL du bucket n'apparaît jamais dans la page. La durée vient des
 * métadonnées du fichier (`loadedmetadata`), comme le demande le lot 5.
 */
export function Player({ src, lang, listenLabel, pauseLabel }: { src: string; lang: string; listenLabel: string; pauseLabel: string }) {
  const audio = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [duration, setDuration] = useState<number | null>(null);
  const [time, setTime] = useState(0);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const a = audio.current;
    if (a && a.readyState >= 1 && Number.isFinite(a.duration)) setDuration(a.duration);
  }, []);

  const toggle = async () => {
    const a = audio.current;
    if (!a) return;
    if (playing) {
      a.pause();
      return;
    }
    try {
      await a.play();
    } catch {
      setFailed(true);
    }
  };

  const progress = duration ? Math.round((time / duration) * BARS) : 0;
  return (
    <div className={playing ? 'player playing' : 'player'} data-lang={lang}>
      <audio
        ref={audio}
        src={src}
        preload="metadata"
        onLoadedMetadata={(e) => setDuration(e.currentTarget.duration)}
        onTimeUpdate={(e) => setTime(e.currentTarget.currentTime)}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => setPlaying(false)}
        onError={() => setFailed(true)}
      />
      <button type="button" className="play" aria-label={playing ? pauseLabel : listenLabel} onClick={toggle} disabled={failed}>
        {playing ? <Pause /> : <Play />}
      </button>
      <div className="wave" aria-hidden="true">
        {BAR_HEIGHTS.map((h, i) => (
          <i key={i} className={i < progress ? 'on' : undefined} style={{ height: `${h}px`, animationDelay: `${(i % 7) * 0.08}s` }} />
        ))}
      </div>
      <div className="ptime mono">
        {failed ? '–:––' : formatTime(duration ?? NaN)}
        <br />
        <span>CHIRP HD</span>
      </div>
    </div>
  );
}
```

Fichier `apps/web/components/MorningBrief.tsx` :

```tsx
import type { EditionView } from '@/lib/data/types';
import { T } from '@/lib/i18n';
import { Player } from './Player';

/** Morning Brief : titre du jour, lecteur (s'il y a un MP3) et cinq infos. Pas de lecteur, pas de message. */
export function MorningBrief({ edition }: { edition: EditionView }) {
  const t = T[edition.lang];
  return (
    <div className="mb">
      <div className="kicker mono">
        <span className="acc">Morning Brief</span>
        <i />
        {edition.morningBrief.length} {t.infos}
        <i />
        10 min
      </div>
      <h1>{edition.headline}</h1>
      {edition.hasAudio && <Player src={`/audio/${edition.date}/${edition.lang}`} lang={edition.lang} listenLabel={t.listen} pauseLabel={t.pause} />}
      <ol className="points">
        {edition.morningBrief.map((m, i) => (
          <li key={i}>
            <span className="n mono">{String(i + 1).padStart(2, '0')}</span>
            <p>
              <b>{m.lead}</b> {m.text}
              <span className="tag mono">{m.rubric}</span>
            </p>
          </li>
        ))}
      </ol>
    </div>
  );
}
```

Fichier `apps/web/components/RubricFilter.tsx` :

```tsx
'use client';
import { useState, type ReactNode } from 'react';
import type { RubricKey } from '@daily-brief/schema';

export type Chip = { key: RubricKey; label: string; present: boolean };

/**
 * Puces de rubriques : « Tout » ou une rubrique. Une rubrique absente de l'édition a sa puce grisée
 * (classe `dim`) et affiche le message vide. Le filtrage est fait en CSS (`.ed-filter[data-show]`) :
 * les rubriques restent rendues côté serveur.
 */
export function RubricFilter({ chips, allLabel, emptyLabel, children }: { chips: Chip[]; allLabel: string; emptyLabel: string; children: ReactNode }) {
  const [show, setShow] = useState<'all' | RubricKey>('all');
  const empty = show !== 'all' && !chips.find((c) => c.key === show)?.present;
  return (
    <>
      <div className="chips" role="toolbar" aria-label="Rubriques">
        <button type="button" className="chip" aria-pressed={show === 'all'} onClick={() => setShow('all')}>
          {allLabel}
        </button>
        {chips.map((c) => (
          <button type="button" key={c.key} className={c.present ? 'chip' : 'chip dim'} aria-pressed={show === c.key} onClick={() => setShow(c.key)}>
            {c.label}
          </button>
        ))}
      </div>
      <p className="empty mono" hidden={!empty}>
        {emptyLabel}
      </p>
      <div className="ed-filter" data-show={show}>
        {children}
      </div>
    </>
  );
}
```

Fichier `apps/web/components/VocabCard.tsx` :

```tsx
'use client';
import { useState } from 'react';
import { queueAnki, setVocabSelected } from '@/app/actions';
import type { AnkiStatus } from '@/lib/data/types';

export type VocabCardWord = { id: string; term: string; pos: string; translation: string; example: string; ankiStatus: AnkiStatus; selected: boolean; meta?: string };

const plural = (n: number) => (n > 1 ? 's' : '');

/**
 * Mots à cocher, « Tout cocher » et « Ajouter N mots à Anki ». Chaque case écrit `selected` par une
 * action serveur ; le bouton Anki passe `anki_status` à `queued` (phase 1 : simple mise en file).
 * En cas d'échec, la case revient à son état et un message s'affiche.
 */
export function VocabCard({ kicker, title, words }: { kicker: string; title: string; words: VocabCardWord[] }) {
  const [checked, setChecked] = useState(() => new Set(words.filter((w) => w.selected).map((w) => w.id)));
  const [status, setStatus] = useState(() => new Map(words.map((w) => [w.id, w.ankiStatus])));
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);
  const [busy, setBusy] = useState(false);

  const toQueue = words.filter((w) => checked.has(w.id) && status.get(w.id) === 'none').map((w) => w.id);
  const allChecked = words.length > 0 && words.every((w) => checked.has(w.id));

  async function select(ids: string[], selected: boolean) {
    const before = new Set(checked);
    const next = new Set(checked);
    for (const id of ids) {
      if (selected) next.add(id);
      else next.delete(id);
    }
    setChecked(next);
    const r = await setVocabSelected({ ids, selected });
    if (!r.ok) {
      setChecked(before);
      setMessage({ text: r.error, error: true });
    }
  }

  async function anki() {
    setBusy(true);
    const r = await queueAnki({ ids: toQueue });
    setBusy(false);
    if (!r.ok) {
      setMessage({ text: r.error, error: true });
      return;
    }
    setStatus(new Map([...status, ...toQueue.map((id) => [id, 'queued' as AnkiStatus] as const)]));
    setMessage({ text: `${r.count} mot${plural(r.count)} en file pour Anki ✓`, error: false });
  }

  return (
    <div className="vocab">
      <header>
        <div>
          <div className="kicker mono">
            <span className="acc">{kicker}</span>
          </div>
          <h3>{title}</h3>
        </div>
        <button type="button" className="selall mono" onClick={() => select(words.map((w) => w.id), !allChecked)}>
          {allChecked ? 'Tout décocher' : 'Tout cocher'}
        </button>
      </header>
      {words.map((w) => (
        <label className="vrow" key={w.id}>
          <input type="checkbox" className="vchk" checked={checked.has(w.id)} onChange={(e) => select([w.id], e.currentTarget.checked)} />
          <span className="box" />
          <span className="vt">
            <b>
              {w.term}
              <em>{w.pos}</em>
            </b>
            <span className="fr">{w.translation}</span>
            <p>{w.example}</p>
            {w.meta && <span className="vmeta mono">{w.meta}{status.get(w.id) !== 'none' ? ` · Anki : ${status.get(w.id)}` : ''}</span>}
          </span>
        </label>
      ))}
      <footer>
        <button type="button" className="anki" disabled={toQueue.length === 0 || busy} onClick={anki}>
          {toQueue.length ? `Ajouter ${toQueue.length} mot${plural(toQueue.length)} à Anki` : 'Ajouter à Anki'}
        </button>
        <span className="soon mono">Synchro Anki · phase 2</span>
      </footer>
      {message && (
        <p className="anki-msg mono" role={message.error ? 'alert' : 'status'}>
          {message.text}
        </p>
      )}
    </div>
  );
}
```

Fichier `apps/web/components/FollowButton.tsx` :

```tsx
'use client';
import { useState } from 'react';
import { setThreadFollowed } from '@/app/actions';
import { Bell } from './icons';

/** « Suivre ce thread » : écrit threads.followed (colonne ouverte par la RLS). */
export function FollowButton({ id, followed, followLabel, followingLabel }: { id: string; followed: boolean; followLabel: string; followingLabel: string }) {
  const [on, setOn] = useState(followed);
  const [error, setError] = useState<string | null>(null);
  async function toggle() {
    const next = !on;
    setOn(next);
    const r = await setThreadFollowed({ id, followed: next });
    if (!r.ok) {
      setOn(!next);
      setError(r.error);
    }
  }
  return (
    <>
      <button type="button" className="follow" aria-pressed={on} onClick={toggle}>
        <Bell />
        {on ? followingLabel : followLabel}
      </button>
      {error && (
        <p className="anki-msg mono" role="alert">
          {error}
        </p>
      )}
    </>
  );
}
```

Fichier `apps/web/components/EditionScreen.tsx` :

```tsx
import { RUBRIC_KEYS } from '@daily-brief/schema';
import { parisTime } from '@/lib/dates';
import type { EditionView } from '@/lib/data/types';
import { CHIP_LABELS, T, uniqueOutlets } from '@/lib/i18n';
import { Banner } from './Banner';
import { Briefs } from './Briefs';
import { MorningBrief } from './MorningBrief';
import { RubricFilter } from './RubricFilter';
import { StoryCard } from './StoryCard';
import { TopBar } from './TopBar';
import { VocabCard } from './VocabCard';

/**
 * Écran d'une édition (spec §8.3) : en-tête, bandeaux, Morning Brief, puces, rubriques et « En bref »,
 * Vocab du jour, colophon. `today` sert au bandeau « brief de la veille » (absent de l'archive).
 */
export function EditionScreen({ edition, basePath, yesterdayOf }: { edition: EditionView; basePath: string; yesterdayOf?: string }) {
  const t = T[edition.lang];
  const present = new Set(edition.sections.map((s) => s.key));
  const outlets = uniqueOutlets(edition.sections.flatMap((s) => [...s.stories.flatMap((x) => x.sources), ...s.briefs]));
  return (
    <>
      <TopBar lang={edition.lang} date={edition.date} generatedAt={edition.generatedAt} basePath={basePath} />
      <section className="edition" data-for={edition.lang}>
        {yesterdayOf && <Banner kind="yesterday" lang={edition.lang} date={edition.date} />}
        {edition.light && <Banner kind="light" lang={edition.lang} date={edition.date} />}
        <MorningBrief edition={edition} />
        <RubricFilter chips={RUBRIC_KEYS.map((key) => ({ key, label: CHIP_LABELS[edition.lang][key], present: present.has(key) }))} allLabel={t.all} emptyLabel={t.empty}>
          {edition.sections.map((s) => (
            <div className="rub" data-rub={s.key} key={s.key}>
              <div className="rubhead">
                <h2>{s.title}</h2>
                <span className="mono">{t.subjects(s.stories.length + s.briefs.length)}</span>
              </div>
              {s.stories.map((st) => (
                <StoryCard story={st} lang={edition.lang} key={st.id} />
              ))}
              <Briefs briefs={s.briefs} lang={edition.lang} />
            </div>
          ))}
          {edition.vocab && (
            <div className="rub" data-rub="vocab">
              <div className="rubhead">
                <h2>Vocab du jour</h2>
                <span className="mono">{edition.vocab.words.length} mots</span>
              </div>
              <VocabCard kicker="Tirés des articles du jour" title={edition.vocab.title} words={edition.vocab.words} />
            </div>
          )}
        </RubricFilter>
        <p className="colophon mono">
          Édition générée à {parisTime(edition.generatedAt)} · {outlets.length} médias
          {edition.hasPdf && (
            <>
              {' · '}
              <a href={`/pdf/${edition.date}`}>PDF du jour</a>
            </>
          )}
        </p>
      </section>
    </>
  );
}
```

- [ ] **Étape 4 : vérifier le succès**

Commande : `npx vitest run --project web apps/web/test/app/actions.test.ts apps/web/test/components/edition.test.tsx`
Attendu : `Test Files  2 passed (2)`, `Tests  12 passed (12)`.

Commande : `npm test && npm run typecheck`
Attendu : `Test Files  91 passed (91)`, `Tests  900 passed (900)`, typage sans erreur.

- [ ] **Étape 5 : commit**

```bash
git add apps/web/app/actions.ts apps/web/components/Player.tsx apps/web/components/MorningBrief.tsx apps/web/components/RubricFilter.tsx apps/web/components/VocabCard.tsx apps/web/components/FollowButton.tsx apps/web/components/EditionScreen.tsx apps/web/test/components/edition.test.tsx apps/web/test/app/actions.test.ts
git commit -m "feat(web): écran d'une édition, lecteur, puces, Vocab du jour et actions serveur"
```

---

### Tâche 11 : pages Brief, édition archivée, Threads, Vocab, Archive et Santé

**Fichiers :**
- Créer : `apps/web/lib/runs.ts`, `apps/web/lib/calendar.ts`, `apps/web/app/(app)/edition/[date]/page.tsx`, `apps/web/app/(app)/threads/page.tsx`, `apps/web/app/(app)/threads/[id]/page.tsx`, `apps/web/app/(app)/vocab/page.tsx`, `apps/web/app/(app)/archive/page.tsx`, `apps/web/app/(app)/sante/page.tsx`
- Modifier : `apps/web/app/(app)/page.tsx` (remplace la page provisoire de la tâche 1)
- Test : `apps/web/test/lib/runs.test.ts`, `apps/web/test/app/pages.test.tsx`

Comportement attendu :
- **Brief (`/`).** Il s'ouvre sur l'édition du cookie `ed` (FR par défaut), à la date du jour de Paris. Sans édition du jour, la dernière publiée s'affiche avec le bandeau « brief de la veille » (spec §12) ; sans aucune édition, « Aucune édition publiée ».
- **Édition archivée (`/edition/AAAA-MM-JJ`).** Elle s'affiche dans la langue choisie, sinon dans la première langue publiée ce jour-là. Une date invalide ou absente donne une 404.
- **Threads.** La liste met les suivis d'abord, puis les ouverts, puis les fermés. La frise (`/threads/<uuid>`) a l'en-tête de la maquette (rubrique, épisodes, « Suivre ce thread » dans la langue du Thread), les épisodes du plus récent au plus ancien, la carte du dernier épisode et un lien vers sa source. Un identifiant qui n'est pas un uuid donne une 404.
- **Vocab.** Tous les mots, filtrés par des paramètres d'URL validés : `langue` (en, es), `date`, `coche` (oui, non). Les dates proposées sont celles des mots trouvés.
- **Archive.** Calendrier du mois (`?m=AAAA-MM`, semaines du lundi au dimanche) ; chaque jour publié est un lien, en pointillés si une édition y est allégée. Un lien mène à Santé.
- **Santé.**
  - **Passages.** Les 14 derniers. Une ligne `running` est « interrompu » au-delà de 6 h depuis `updated_at`, « en cours » avant.
  - **Étapes.** Dans l'ordre de la routine (`context`, `collect`, `verify`, `audio`, `render`, `publish`, `drive`, puis les autres), avec statut, heure, durée, compteurs et erreurs. Une étape illisible est signalée.
  - **Bilan.** Les Threads fermés et les éditions allégées.
  - **Déconnexion.** Un bouton en POST.

- [ ] **Étape 1 : écrire les tests**

Fichier `apps/web/test/lib/runs.test.ts` :

```ts
import { describe, expect, it } from 'vitest';
import { monthBounds, monthGrid, parseMonth, shiftMonth } from '@/lib/calendar';
import { runView } from '@/lib/runs';

const now = new Date('2026-11-06T12:00:00Z');

describe('page Santé', () => {
  it('affiche « interrompu » pour une ligne running de plus de 6 h, « en cours » sinon', () => {
    expect(runView({ date: '2026-11-06', status: 'running', steps: {}, notes: null, updatedAt: '2026-11-06T05:59:00Z' }, now).label).toBe('interrompu');
    expect(runView({ date: '2026-11-06', status: 'running', steps: {}, notes: null, updatedAt: '2026-11-06T06:01:00Z' }, now).label).toBe('en cours');
    expect(runView({ date: '2026-11-06', status: 'degraded', steps: {}, notes: null, updatedAt: '2026-11-01T00:00:00Z' }, now).label).toBe('dégradé');
  });

  it('range les étapes dans l’ordre de la routine, compte les Threads fermés et les éditions allégées', () => {
    const v = runView(
      {
        date: '2026-11-06',
        status: 'ok',
        notes: 'n',
        updatedAt: '2026-11-06T05:00:00Z',
        steps: {
          zeta: { status: 'ok' },
          publish: { status: 'ok', finishedAt: '2026-11-06T04:52:00Z', durationMs: 41000, counters: { editions: 3 }, errors: [] },
          collect: { status: 'degraded', counters: { articles: 10 }, errors: ['webz coupé'], perLang: { fr: { articles: 1, fullTexts: 3, light: true } } },
          audio: 'cassé',
          closedThreads: ['a', 'b'],
        },
      },
      now,
    );
    expect(v.steps.map((s) => s.name)).toEqual(['collect', 'audio', 'publish', 'zeta']);
    expect(v.steps[1].status).toBe('illisible');
    expect(v).toMatchObject({ closedThreads: 2, light: ['fr'], problems: 1 });
    expect(v.steps[2]).toMatchObject({ durationMs: 41000, counters: [['editions', 3]] });
  });
});

describe('calendrier de l’archive', () => {
  it('commence le lundi et complète les semaines', () => {
    const grid = monthGrid('2026-11');
    expect(grid.slice(0, 7)).toEqual([null, null, null, null, null, null, '2026-11-01']);
    expect(grid.length % 7).toBe(0);
    expect(grid.filter(Boolean)).toHaveLength(30);
  });

  it('valide et décale les mois', () => {
    expect(parseMonth('2026-11')).toBe('2026-11');
    expect(parseMonth('2026-13')).toBeNull();
    expect(parseMonth(undefined)).toBeNull();
    expect(shiftMonth('2026-01', -1)).toBe('2025-12');
    expect(monthBounds('2028-02')).toEqual({ first: '2028-02-01', last: '2028-02-29' });
  });
});
```

Fichier `apps/web/test/app/pages.test.tsx` :

```tsx
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FixtureDataSource, resetFixtureState } from '@/lib/data/fixture';

const m = vi.hoisted(() => ({ today: '2026-11-06', light: [] as ('fr' | 'en' | 'es')[], ed: undefined as string | undefined }));
vi.mock('@/lib/data', () => ({ getDataSource: async () => new FixtureDataSource({ today: m.today, light: m.light }) }));
vi.mock('next/headers', () => ({ cookies: async () => ({ get: () => (m.ed ? { value: m.ed } : undefined) }) }));
vi.mock('next/navigation', () => ({
  usePathname: () => '/',
  notFound: () => {
    throw new Error('NOT_FOUND');
  },
}));
vi.mock('@/app/actions', () => ({ setVocabSelected: vi.fn(), queueAnki: vi.fn(), setThreadFollowed: vi.fn() }));

import ArchivePage from '@/app/(app)/archive/page';
import EditionPage from '@/app/(app)/edition/[date]/page';
import BriefPage from '@/app/(app)/page';
import SantePage from '@/app/(app)/sante/page';
import ThreadPage from '@/app/(app)/threads/[id]/page';
import ThreadsPage from '@/app/(app)/threads/page';
import VocabPage from '@/app/(app)/vocab/page';

beforeEach(() => {
  resetFixtureState();
  Object.assign(m, { today: '2026-11-06', light: [], ed: undefined });
});

describe('pages', () => {
  it('le Brief du jour s’ouvre sur l’édition du cookie, sans bandeau', async () => {
    m.ed = 'en';
    const { container } = render(await BriefPage());
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('A blue wave sweeps Congress');
    expect(container.querySelector('.banner')).toBeNull();
  });

  it('sans édition du jour, montre la veille avec son bandeau', async () => {
    m.today = '2026-11-07';
    m.light = ['fr'];
    render(await BriefPage());
    expect(screen.getAllByRole('status').map((s) => s.getAttribute('data-kind'))).toEqual(['yesterday', 'light']);
  });

  it('sans aucune édition, le dit simplement', async () => {
    m.today = '2026-11-01';
    render(await BriefPage());
    expect(screen.getByText('Aucune édition publiée')).toBeTruthy();
  });

  it('une édition archivée s’ouvre par sa date, et une date invalide donne 404', async () => {
    render(await EditionPage({ params: Promise.resolve({ date: '2026-11-06' }) }));
    expect(screen.getByRole('heading', { level: 1 }).textContent).toContain('Lecornu');
    await expect(EditionPage({ params: Promise.resolve({ date: '2026-02-30' }) })).rejects.toThrow('NOT_FOUND');
    await expect(EditionPage({ params: Promise.resolve({ date: '2026-11-05' }) })).rejects.toThrow('NOT_FOUND');
  });

  it('liste les Threads et ouvre une frise', async () => {
    render(await ThreadsPage());
    const link = screen.getByRole('link', { name: /Épisodes méditerranéens 2026/ });
    const id = link.getAttribute('href')!.split('/').pop()!;
    render(await ThreadPage({ params: Promise.resolve({ id }) }));
    expect(screen.getByRole('button', { name: 'Suivre ce thread' })).toBeTruthy();
    expect(screen.getAllByRole('listitem').filter((li) => li.closest('.timeline'))).toHaveLength(2);
    await expect(ThreadPage({ params: Promise.resolve({ id: 'pas-un-uuid' }) })).rejects.toThrow('NOT_FOUND');
  });

  it('filtre le vocabulaire par langue et par date', async () => {
    render(await VocabPage({ searchParams: Promise.resolve({ langue: 'es', date: '2026-11-06' }) }));
    expect(screen.getAllByRole('checkbox')).toHaveLength(6);
    expect(screen.getByRole('link', { name: 'ES' }).getAttribute('aria-current')).toBe('true');
    render(await VocabPage({ searchParams: Promise.resolve({ coche: 'oui' }) }));
    expect(screen.getByText('Aucun mot pour ces filtres.')).toBeTruthy();
  });

  it('l’archive lie les jours publiés du mois, et la page Santé liste les passages', async () => {
    render(await ArchivePage({ searchParams: Promise.resolve({ m: '2026-11' }) }));
    expect(screen.getByRole('link', { name: /Édition du 2026-11-06/ }).getAttribute('href')).toBe('/edition/2026-11-06');
    expect(screen.getByText('novembre 2026')).toBeTruthy();
    const { container } = render(await SantePage());
    expect([...container.querySelectorAll('.run')].map((r) => r.getAttribute('data-status'))).toEqual(['ok', 'degraded', 'interrupted']);
  });
});
```

- [ ] **Étape 2 : vérifier l'échec**

Commande : `npx vitest run --project web apps/web/test/lib/runs.test.ts apps/web/test/app/pages.test.tsx`
Attendu : échec des deux fichiers, `Failed to resolve import "@/lib/calendar"` et `"@/app/(app)/archive/page"`.

- [ ] **Étape 3 : implémenter**

Fichier `apps/web/lib/runs.ts` :

```ts
import { z } from 'zod';
import { LANGS, type Lang } from '@daily-brief/schema';
import type { RunRecord, RunStatus } from './data/types';

/** Au-delà de 6 h, une ligne `runs` restée à `running` est un passage interrompu (consigne du lot 3). */
export const INTERRUPTED_AFTER_MS = 6 * 3600 * 1000;

/** Ordre de la routine (lot 5) : les étapes inconnues suivent, par ordre alphabétique. */
export const STEP_ORDER = ['context', 'collect', 'verify', 'audio', 'render', 'publish', 'drive'];

const StepSchema = z.object({
  status: z.string(),
  finishedAt: z.string().nullable().optional(),
  durationMs: z.number().nullable().optional(),
  counters: z.record(z.string(), z.number()).optional(),
  errors: z.array(z.string()).optional(),
  perLang: z.record(z.string(), z.object({ light: z.boolean() }).loose()).optional(),
});

export type StepView = { name: string; status: string; finishedAt: string | null; durationMs: number | null; counters: [string, number][]; errors: string[] };
export type RunView = {
  date: string;
  status: RunStatus | 'interrupted';
  label: string;
  updatedAt: string;
  steps: StepView[];
  closedThreads: number;
  light: Lang[];
  notes: string | null;
  problems: number;
};

const LABEL: Record<RunView['status'], string> = { ok: 'réussi', degraded: 'dégradé', failed: 'échec', running: 'en cours', interrupted: 'interrompu' };

/** Ligne `runs` → affichage de la page Santé. `steps` est validé étape par étape ; une étape illisible est signalée. */
export function runView(run: RunRecord, now: Date): RunView {
  const raw = run.steps && typeof run.steps === 'object' ? (run.steps as Record<string, unknown>) : {};
  const steps: StepView[] = [];
  let problems = 0;
  for (const [name, value] of Object.entries(raw)) {
    if (name === 'closedThreads') continue;
    const s = StepSchema.safeParse(value);
    if (!s.success) {
      problems++;
      steps.push({ name, status: 'illisible', finishedAt: null, durationMs: null, counters: [], errors: [] });
      continue;
    }
    steps.push({ name, status: s.data.status, finishedAt: s.data.finishedAt ?? null, durationMs: s.data.durationMs ?? null, counters: Object.entries(s.data.counters ?? {}), errors: s.data.errors ?? [] });
  }
  const rank = (n: string) => (STEP_ORDER.includes(n) ? STEP_ORDER.indexOf(n) : STEP_ORDER.length);
  steps.sort((a, b) => rank(a.name) - rank(b.name) || a.name.localeCompare(b.name));
  const closed = Array.isArray(raw.closedThreads) ? raw.closedThreads.length : 0;
  const perLang = StepSchema.safeParse(raw.collect).data?.perLang ?? {};
  const light = LANGS.filter((l) => perLang[l]?.light === true);
  const age = now.getTime() - new Date(run.updatedAt).getTime();
  const status: RunView['status'] = run.status === 'running' && age > INTERRUPTED_AFTER_MS ? 'interrupted' : run.status;
  return { date: run.date, status, label: LABEL[status], updatedAt: run.updatedAt, steps, closedThreads: closed, light, notes: run.notes, problems };
}
```

Fichier `apps/web/lib/calendar.ts` :

```ts
import { addDays } from './dates';

/** « 2026-11 » valide (mois 01 à 12), sinon null. */
export function parseMonth(v: string | undefined): string | null {
  return v && /^\d{4}-(0[1-9]|1[0-2])$/.test(v) ? v : null;
}

export const shiftMonth = (month: string, delta: number): string => {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return d.toISOString().slice(0, 7);
};

export const monthBounds = (month: string) => ({ first: `${month}-01`, last: addDays(`${shiftMonth(month, 1)}-01`, -1) });

/** Cases du calendrier d'un mois, semaines du lundi au dimanche ; null pour une case vide. */
export function monthGrid(month: string): (string | null)[] {
  const { first, last } = monthBounds(month);
  const lead = (new Date(`${first}T12:00:00Z`).getUTCDay() + 6) % 7;
  const cells: (string | null)[] = Array.from({ length: lead }, () => null);
  for (let d = first; d <= last; d = addDays(d, 1)) cells.push(d);
  while (cells.length % 7) cells.push(null);
  return cells;
}
```

Remplacer la page provisoire :

Fichier `apps/web/app/(app)/page.tsx` :

```tsx
import { cookies } from 'next/headers';
import { EditionScreen } from '@/components/EditionScreen';
import { getDataSource } from '@/lib/data';
import { chosenLang, EDITION_COOKIE } from '@/lib/edition-choice';

/**
 * Brief du jour. Sans édition du jour (pipeline pas encore passé, ou échec total : spec §12), la
 * dernière édition publiée s'affiche avec le bandeau « brief de la veille ».
 */
export default async function BriefPage() {
  const lang = chosenLang((await cookies()).get(EDITION_COOKIE)?.value);
  const ds = await getDataSource();
  const today = ds.today();
  const date = await ds.latestDate(lang, today);
  const edition = date ? await ds.edition(date, lang) : null;
  if (!edition) {
    return (
      <div className="page-head">
        <div className="kicker mono">
          <span className="acc">Daily Brief</span>
        </div>
        <h1>Aucune édition publiée</h1>
        <p>Le premier brief apparaîtra ici après le passage de la routine.</p>
      </div>
    );
  }
  return <EditionScreen edition={edition} basePath="/" yesterdayOf={edition.date < today ? today : undefined} />;
}
```

Fichier `apps/web/app/(app)/edition/[date]/page.tsx` :

```tsx
import { cookies } from 'next/headers';
import { notFound } from 'next/navigation';
import { LANGS } from '@daily-brief/schema';
import { EditionScreen } from '@/components/EditionScreen';
import { getDataSource } from '@/lib/data';
import { isIsoDate } from '@/lib/dates';
import { chosenLang, EDITION_COOKIE } from '@/lib/edition-choice';

/** Édition archivée : la langue choisie, sinon la première langue publiée ce jour-là. */
export default async function EditionPage({ params }: { params: Promise<{ date: string }> }) {
  const { date } = await params;
  if (!isIsoDate(date)) notFound();
  const lang = chosenLang((await cookies()).get(EDITION_COOKIE)?.value);
  const ds = await getDataSource();
  for (const l of [lang, ...LANGS.filter((x) => x !== lang)]) {
    const edition = await ds.edition(date, l);
    if (edition) return <EditionScreen edition={edition} basePath={`/edition/${date}`} />;
  }
  notFound();
}
```

Fichier `apps/web/app/(app)/threads/page.tsx` :

```tsx
import Link from 'next/link';
import { getDataSource } from '@/lib/data';
import { shortDate } from '@/lib/dates';

/** Liste des Threads : suivis d'abord, puis ouverts, puis fermés. */
export default async function ThreadsPage() {
  const ds = await getDataSource();
  const rank = (t: { followed: boolean; status: string }) => (t.followed ? 0 : t.status === 'open' ? 1 : 2);
  const threads = (await ds.threads()).sort((a, b) => rank(a) - rank(b) || ((b.lastDate ?? '') > (a.lastDate ?? '') ? 1 : -1));
  return (
    <>
      <div className="page-head">
        <div className="kicker mono">
          <span className="acc">Threads</span>
          <i />
          {threads.length}
        </div>
        <h1>Les histoires suivies</h1>
      </div>
      {threads.length === 0 ? (
        <p className="empty mono">Aucun Thread pour l’instant.</p>
      ) : (
        <ul className="list">
          {threads.map((t) => (
            <li key={t.id} data-ed={t.lang}>
              <Link className="item" href={`/threads/${t.id}`}>
                <b>{t.title}</b>
                {t.lastTitle && <span>{t.lastTitle}</span>}
                <small className="mono">
                  {t.lang.toUpperCase()} · {t.eventCount} épisode{t.eventCount > 1 ? 's' : ''}
                  {t.lastDate ? ` · ${shortDate(t.lastDate, 'fr')}` : ''}
                  {t.followed ? ' · suivi' : ''}
                  {t.status === 'closed' ? ' · fermé' : ''}
                </small>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
```

Fichier `apps/web/app/(app)/threads/[id]/page.tsx` :

```tsx
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { z } from 'zod';
import { FollowButton } from '@/components/FollowButton';
import { MapSvg } from '@/components/MapSvg';
import { getDataSource } from '@/lib/data';
import { shortDate } from '@/lib/dates';
import { CHIP_LABELS, T } from '@/lib/i18n';

const LATEST = { fr: 'Dernier épisode', en: 'Latest', es: 'Último' } as const;

/** Frise d'un Thread (maquette, écran 2) : épisodes du plus récent au plus ancien, « Suivre ce thread ». */
export default async function ThreadPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const thread = await (await getDataSource()).thread(id);
  if (!thread) notFound();
  const t = T[thread.lang];
  const rubric = thread.events.find((e) => e.rubric)?.rubric;
  return (
    <div data-ed={thread.lang}>
      <div className="th-head">
        <Link className="back mono" href="/threads">
          ← THREADS
        </Link>
        <div className="kicker mono" style={{ marginTop: 14 }}>
          <span className="acc">Thread</span>
          {rubric && (
            <>
              <i />
              {CHIP_LABELS[thread.lang][rubric]}
            </>
          )}
          <i />
          {t.episodes(thread.eventCount)}
        </div>
        <h2>{thread.title}</h2>
        {thread.events[0]?.text && <p>{thread.events[0].text}</p>}
        <FollowButton id={thread.id} followed={thread.followed} followLabel={t.follow} followingLabel={t.following} />
      </div>
      <ol className="timeline">
        {thread.events.map((e, i) => (
          <li key={`${e.date}-${i}`} className={i === 0 ? 'now' : undefined}>
            <span className="d mono">
              {shortDate(e.date, thread.lang)}
              {i === 0 ? ` · ${LATEST[thread.lang]}` : ''}
            </span>
            <h4>{e.title}</h4>
            {i > 0 && e.text && <p>{e.text}</p>}
            {i === 0 && e.map && (
              <div className="mini">
                <MapSvg spec={e.map.spec} label={e.map.caption} />
              </div>
            )}
            {e.source && (
              <a className="s mono" href={e.source.url} target="_blank" rel="noopener noreferrer">
                {e.source.outlet} ↗
              </a>
            )}
          </li>
        ))}
      </ol>
    </div>
  );
}
```

Fichier `apps/web/app/(app)/vocab/page.tsx` :

```tsx
import Link from 'next/link';
import { VocabCard } from '@/components/VocabCard';
import { getDataSource } from '@/lib/data';
import { isIsoDate, shortDate } from '@/lib/dates';
import { isLang } from '@/lib/edition-choice';

type Search = { langue?: string; date?: string; coche?: string };

const href = (s: Search) => {
  const q = new URLSearchParams(Object.entries(s).filter((e): e is [string, string] => typeof e[1] === 'string' && e[1] !== ''));
  return q.size ? `/vocab?${q}` : '/vocab';
};

/** Tous les mots, avec filtres langue, date et coché (paramètres d'URL, validés). */
export default async function VocabPage({ searchParams }: { searchParams: Promise<Search> }) {
  const sp = await searchParams;
  const lang = isLang(sp.langue) && sp.langue !== 'fr' ? sp.langue : undefined;
  const date = sp.date && isIsoDate(sp.date) ? sp.date : undefined;
  const coche = sp.coche === 'oui' || sp.coche === 'non' ? sp.coche : undefined;
  const all = await (await getDataSource()).vocab({ lang, selected: coche === undefined ? undefined : coche === 'oui' });
  const dates = [...new Set(all.map((w) => w.date))].slice(0, 14);
  const words = date ? all.filter((w) => w.date === date) : all;
  const cur = { langue: lang, date, coche };
  const chip = (label: string, next: Search, on: boolean) => (
    <Link href={href(next)} aria-current={on ? 'true' : undefined} key={label}>
      {label}
    </Link>
  );
  return (
    <>
      <div className="page-head">
        <div className="kicker mono">
          <span className="acc">Vocab</span>
          <i />
          {words.length} mots
        </div>
        <h1>Tous les mots</h1>
      </div>
      <nav className="filters" aria-label="Langue">
        {chip('Toutes', { ...cur, langue: undefined }, !lang)}
        {chip('EN', { ...cur, langue: 'en' }, lang === 'en')}
        {chip('ES', { ...cur, langue: 'es' }, lang === 'es')}
      </nav>
      <nav className="filters" aria-label="Coché">
        {chip('Tous', { ...cur, coche: undefined }, !coche)}
        {chip('Cochés', { ...cur, coche: 'oui' }, coche === 'oui')}
        {chip('Non cochés', { ...cur, coche: 'non' }, coche === 'non')}
      </nav>
      <nav className="filters" aria-label="Date">
        {chip('Toutes dates', { ...cur, date: undefined }, !date)}
        {dates.map((d) => chip(shortDate(d, 'fr'), { ...cur, date: d }, date === d))}
      </nav>
      {words.length === 0 ? (
        <p className="empty mono">Aucun mot pour ces filtres.</p>
      ) : (
        <div className="rub">
          <VocabCard
            key={href(cur)}
            kicker="Vocabulaire"
            title={lang ? lang.toUpperCase() : 'EN · ES'}
            words={words.map((w) => ({ ...w, meta: `${shortDate(w.date, 'fr')} · ${w.lang.toUpperCase()}` }))}
          />
        </div>
      )}
    </>
  );
}
```

Fichier `apps/web/app/(app)/archive/page.tsx` :

```tsx
import Link from 'next/link';
import { getDataSource } from '@/lib/data';
import { monthFr } from '@/lib/dates';
import { monthBounds, monthGrid, parseMonth, shiftMonth } from '@/lib/calendar';

const DAYS = ['lun', 'mar', 'mer', 'jeu', 'ven', 'sam', 'dim'];

/** Archive : calendrier du mois vers les éditions passées (pointillés : édition allégée). */
export default async function ArchivePage({ searchParams }: { searchParams: Promise<{ m?: string }> }) {
  const ds = await getDataSource();
  const today = ds.today();
  const month = parseMonth((await searchParams).m) ?? today.slice(0, 7);
  const { first, last } = monthBounds(month);
  const days = new Map((await ds.days(first, last)).map((d) => [d.date, d]));
  return (
    <>
      <div className="page-head">
        <div className="kicker mono">
          <span className="acc">Archive</span>
          <i />
          {days.size} jour{days.size > 1 ? 's' : ''}
          <i />
          <Link href="/sante">Santé →</Link>
        </div>
        <h1>Les éditions passées</h1>
      </div>
      <div className="cal">
        <nav aria-label="Mois">
          <Link href={`/archive?m=${shiftMonth(month, -1)}`}>← préc.</Link>
          <b>{monthFr(month)}</b>
          <Link href={`/archive?m=${shiftMonth(month, 1)}`}>suiv. →</Link>
        </nav>
        <ol>
          {DAYS.map((d) => (
            <li className="h mono" key={d}>
              {d}
            </li>
          ))}
          {monthGrid(month).map((d, i) => {
            const day = d ? days.get(d) : undefined;
            return (
              <li key={d ?? `x${i}`}>
                {d && day ? (
                  <Link href={`/edition/${d}`} className={[day.light.length ? 'light' : '', d === today ? 'today' : ''].join(' ').trim() || undefined} aria-label={`Édition du ${d} (${day.langs.join(', ').toUpperCase()})`}>
                    {Number(d.slice(8))}
                  </Link>
                ) : (
                  d && Number(d.slice(8))
                )}
              </li>
            );
          })}
        </ol>
      </div>
    </>
  );
}
```

Fichier `apps/web/app/(app)/sante/page.tsx` :

```tsx
import { getDataSource } from '@/lib/data';
import { longDateFr, parisTime } from '@/lib/dates';
import { runView } from '@/lib/runs';

/** Santé : derniers passages de la routine (table `runs`), étape par étape. */
export default async function SantePage() {
  const now = new Date();
  const runs = (await (await getDataSource()).runs(14)).map((r) => runView(r, now));
  return (
    <>
      <div className="page-head">
        <div className="kicker mono">
          <span className="acc">Santé</span>
          <i />
          {runs.length} passages
        </div>
        <h1>Les derniers passages</h1>
        <p>Une ligne restée « en cours » plus de 6 h est un passage interrompu : la publication n’a pas eu lieu.</p>
      </div>
      {runs.length === 0 ? (
        <p className="empty mono">Aucun passage enregistré.</p>
      ) : (
        <ol className="runs">
          {runs.map((r) => (
            <li className="run" key={r.date} data-status={r.status}>
              <header>
                <b>{longDateFr(r.date)}</b>
                <span className={`st mono ${r.status}`}>{r.label}</span>
              </header>
              <table>
                <tbody>
                  {r.steps.map((s) => (
                    <tr key={s.name}>
                      <td>{s.name}</td>
                      <td>
                        {s.status}
                        {s.finishedAt ? ` · ${parisTime(s.finishedAt)}` : ''}
                        {s.durationMs !== null ? ` · ${Math.round(s.durationMs / 1000)} s` : ''}
                      </td>
                      <td>
                        {s.counters.map(([k, v]) => `${k} ${v}`).join(' · ')}
                        {s.errors.length > 0 && <span className="mono"> — {s.errors.join(' ; ')}</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="mono">
                Mise à jour {parisTime(r.updatedAt)}
                {r.closedThreads ? ` · ${r.closedThreads} Thread(s) fermé(s)` : ''}
                {r.light.length ? ` · allégée : ${r.light.join(', ').toUpperCase()}` : ''}
                {r.notes ? ` · ${r.notes}` : ''}
              </p>
            </li>
          ))}
        </ol>
      )}
      <form className="signout" action="/auth/signout" method="post">
        <button type="submit" className="mono">
          Se déconnecter
        </button>
      </form>
    </>
  );
}
```

- [ ] **Étape 4 : vérifier le succès**

Commande : `npx vitest run --project web apps/web/test/lib/runs.test.ts apps/web/test/app/pages.test.tsx`
Attendu : `Test Files  2 passed (2)`, `Tests  11 passed (11)`.

Commande : `npm test && npm run typecheck`
Attendu : `Test Files  93 passed (93)`, `Tests  911 passed (911)`, typage sans erreur.

Commande : `HTTPS_PROXY=http://127.0.0.1:9 npm run web:build`
Attendu : `✓ Compiled successfully`, avec `ƒ /`, `ƒ /archive`, `ƒ /edition/[date]`, `ƒ /sante`, `ƒ /threads`, `ƒ /threads/[id]` et `ƒ /vocab`.

- [ ] **Étape 5 : commit**

```bash
git add apps/web/lib/runs.ts apps/web/lib/calendar.ts "apps/web/app/(app)" apps/web/test/lib/runs.test.ts apps/web/test/app/pages.test.tsx
git commit -m "feat(web): pages Brief, édition archivée, Threads, Vocab, Archive et Santé"
```

---

### Tâche 12 : fichiers privés par URL signée, manifeste et icônes

**Fichiers :**
- Créer : `apps/web/lib/file-response.ts`, `apps/web/app/audio/[date]/[lang]/route.ts`, `apps/web/app/pdf/[date]/route.ts`, `apps/web/app/manifest.ts`, `apps/web/scripts/make-icons.ts`, `apps/web/public/icons/` (fichiers générés)
- Test : `apps/web/test/app/files.test.ts`, `apps/web/test/app/pwa.test.ts`

Comportement attendu :
- **`/audio/<date>/<langue>` et `/pdf/<date>`.** Paramètres invalides : 404, sans lecture en base. Sans utilisateur autorisé : 401. Fichier absent : 404. Sinon, une redirection 307 vers l'URL signée, ou les octets du mode fixture. Toujours `Cache-Control: private, no-store` et `Referrer-Policy: no-referrer`.
- **Manifeste.** `/manifest.webmanifest` : nom, `start_url: '/'`, `display: standalone`, `lang: fr`, couleurs du thème sombre, icônes 192, 512 et 512 « maskable ».
- **Icônes.** Le logo demi-disque de la maquette (anneau clair, moitié gauche à l'accent FR) sur fond sombre, dessiné par `scripts/make-icons.ts` avec `pngjs`. Il y a aussi l'icône Apple (180 px) et une icône SVG. `design/` n'est pas touché.
- **Service worker.** Aucun (décision 8).

- [ ] **Étape 1 : écrire les tests**

Fichier `apps/web/test/app/files.test.ts` :

```ts
// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { FileTarget } from '@/lib/data/types';

const m = vi.hoisted(() => ({ user: { email: 'x' } as object | null, audio: null as FileTarget | null, pdf: null as FileTarget | null, calls: [] as string[] }));
vi.mock('@/lib/auth', () => ({ currentUser: async () => m.user }));
vi.mock('@/lib/data', () => ({
  getDataSource: async () => ({
    audio: async (d: string, l: string) => (m.calls.push(`audio ${d} ${l}`), m.audio),
    pdf: async (d: string) => (m.calls.push(`pdf ${d}`), m.pdf),
  }),
}));

import { GET as audio } from '@/app/audio/[date]/[lang]/route';
import { GET as pdf } from '@/app/pdf/[date]/route';

const call = (date: string, lang: string) => audio(new Request('http://x'), { params: Promise.resolve({ date, lang }) });

beforeEach(() => Object.assign(m, { user: { email: 'x' }, audio: null, pdf: null, calls: [] }));

describe('routes de fichiers', () => {
  it('redirige vers l’URL signée, sans cache ni Referer', async () => {
    m.audio = { kind: 'redirect', url: 'https://ref.supabase.co/storage/v1/object/sign/audio/2026-11-06/fr.mp3?token=t' };
    const r = await call('2026-11-06', 'fr');
    expect(r.status).toBe(307);
    expect(r.headers.get('location')).toBe(m.audio.url);
    expect(r.headers.get('cache-control')).toBe('private, no-store');
    expect(r.headers.get('referrer-policy')).toBe('no-referrer');
  });

  it('sert les octets du mode fixture', async () => {
    m.audio = { kind: 'bytes', body: new Uint8Array([0xff, 0xf3]), contentType: 'audio/mpeg' };
    const r = await call('2026-11-06', 'en');
    expect(r.headers.get('content-type')).toBe('audio/mpeg');
    expect(new Uint8Array(await r.arrayBuffer())).toEqual(new Uint8Array([0xff, 0xf3]));
  });

  it('404 pour des paramètres invalides ou un fichier absent, 401 sans utilisateur', async () => {
    expect((await call('2026-02-30', 'fr')).status).toBe(404);
    expect((await call('2026-11-06', 'de')).status).toBe(404);
    expect(m.calls).toEqual([]);
    expect((await call('2026-11-06', 'es')).status).toBe(404);
    m.user = null;
    expect((await call('2026-11-06', 'fr')).status).toBe(401);
    expect((await pdf(new Request('http://x'), { params: Promise.resolve({ date: '2026-11-06' }) })).status).toBe(401);
  });
});
```

Fichier `apps/web/test/app/pwa.test.ts` :

```ts
// @vitest-environment node
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PNG } from 'pngjs';
import { describe, expect, it } from 'vitest';
import manifest from '@/app/manifest';
import { ICONS } from '../../scripts/make-icons';

const ICON_DIR = join(process.cwd(), 'apps/web/public/icons');

describe('PWA', () => {
  it('le manifeste rend l’appli installable', () => {
    const m = manifest();
    expect(m).toMatchObject({ name: 'Daily Brief', start_url: '/', display: 'standalone', lang: 'fr' });
    expect(m.icons?.map((i) => [i.sizes, i.purpose])).toEqual([
      ['192x192', 'any'],
      ['512x512', 'any'],
      ['512x512', 'maskable'],
    ]);
  });

  it('chaque icône existe à la bonne taille', () => {
    for (const icon of ICONS) {
      const png = PNG.sync.read(readFileSync(join(ICON_DIR, icon.file)));
      expect([png.width, png.height], icon.file).toEqual([icon.size, icon.size]);
    }
    expect(existsSync(join(ICON_DIR, 'icon.svg'))).toBe(true);
    for (const i of manifest().icons ?? []) expect(existsSync(join(ICON_DIR, i.src.replace('/icons/', '')))).toBe(true);
  });
});
```

- [ ] **Étape 2 : vérifier l'échec**

Commande : `npx vitest run --project web apps/web/test/app/files.test.ts apps/web/test/app/pwa.test.ts`
Attendu : échec des deux fichiers, `Failed to resolve import "@/app/audio/[date]/[lang]/route"` et `"@/app/manifest"`.

- [ ] **Étape 3 : implémenter**

Fichier `apps/web/lib/file-response.ts` :

```ts
import 'server-only';
import type { FileTarget } from './data/types';

/**
 * Réponse d'une route de fichier : redirection 307 vers l'URL signée (jamais mise en cache, jamais
 * transmise en Referer) ou octets servis directement (mode fixture).
 */
export function fileResponse(target: FileTarget | null): Response {
  const base = { 'Cache-Control': 'private, no-store', 'Referrer-Policy': 'no-referrer' };
  if (!target) return new Response('Fichier introuvable', { status: 404, headers: base });
  if (target.kind === 'redirect') return new Response(null, { status: 307, headers: { ...base, Location: target.url } });
  return new Response(target.body as BodyInit, { status: 200, headers: { ...base, 'Content-Type': target.contentType, 'Content-Length': String(target.body.byteLength) } });
}

export const unauthorized = () => new Response('Connexion requise', { status: 401, headers: { 'Cache-Control': 'no-store' } });
```

Fichier `apps/web/app/audio/[date]/[lang]/route.ts` :

```ts
import { currentUser } from '@/lib/auth';
import { getDataSource } from '@/lib/data';
import { isIsoDate } from '@/lib/dates';
import { isLang } from '@/lib/edition-choice';
import { fileResponse, unauthorized } from '@/lib/file-response';

/** MP3 d'une édition : URL signée de 10 minutes créée avec la session (consigne du lot 5). */
export async function GET(_request: Request, { params }: { params: Promise<{ date: string; lang: string }> }) {
  const { date, lang } = await params;
  if (!isIsoDate(date) || !isLang(lang)) return fileResponse(null);
  if (!(await currentUser())) return unauthorized();
  return fileResponse(await (await getDataSource()).audio(date, lang));
}
```

Fichier `apps/web/app/pdf/[date]/route.ts` :

```ts
import { currentUser } from '@/lib/auth';
import { getDataSource } from '@/lib/data';
import { isIsoDate } from '@/lib/dates';
import { fileResponse, unauthorized } from '@/lib/file-response';

/** PDF du jour : URL signée de 10 minutes, en téléchargement (« Daily Brief AAAA-MM-JJ.pdf »). */
export async function GET(_request: Request, { params }: { params: Promise<{ date: string }> }) {
  const { date } = await params;
  if (!isIsoDate(date)) return fileResponse(null);
  if (!(await currentUser())) return unauthorized();
  return fileResponse(await (await getDataSource()).pdf(date));
}
```

Fichier `apps/web/app/manifest.ts` :

```ts
import type { MetadataRoute } from 'next';

/** Manifeste PWA (spec §8.3) : appli installable sur l'écran d'accueil. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Daily Brief',
    short_name: 'Daily Brief',
    description: 'Briefing d’actualité quotidien, privé.',
    lang: 'fr',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    background_color: '#0B0B0C',
    theme_color: '#0B0B0C',
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
}
```

Fichier `apps/web/scripts/make-icons.ts` :

```ts
/**
 * Génère les icônes PWA dans apps/web/public/icons/ : le logo demi-disque de la maquette (cercle cerné,
 * moitié gauche à l'accent FR) sur fond sombre. Déterministe, sans dépendance d'exécution (pngjs est
 * déjà une dépendance de développement du dépôt). Relancer : npx tsx apps/web/scripts/make-icons.ts
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';

const OUT = fileURLToPath(new URL('../public/icons/', import.meta.url));
const BG = [0x0b, 0x0b, 0x0c];
const RING = [0xf3, 0xf3, 0xf1];
const ACCENT = [0x3e, 0x6b, 0xff];

/** Couleur d'un point (coordonnées normalisées -1..1) : fond, anneau, demi-disque gauche. */
function colorAt(x: number, y: number, radius: number): number[] {
  const d = Math.hypot(x, y);
  const ring = radius * 0.09;
  if (d > radius) return BG;
  if (d > radius - ring) return RING;
  return x < 0 ? ACCENT : BG;
}

/** PNG carré de `size` px ; `radius` : rayon du logo (1 = bord), suréchantillonné 4×4. */
export function iconPng(size: number, radius: number): Buffer {
  const png = new PNG({ width: size, height: size });
  const S = 4;
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      const acc = [0, 0, 0];
      for (let sy = 0; sy < S; sy++) {
        for (let sx = 0; sx < S; sx++) {
          const x = ((px + (sx + 0.5) / S) / size) * 2 - 1;
          const y = ((py + (sy + 0.5) / S) / size) * 2 - 1;
          const c = colorAt(x, y, radius);
          for (let k = 0; k < 3; k++) acc[k] += c[k];
        }
      }
      const i = (py * size + px) * 4;
      for (let k = 0; k < 3; k++) png.data[i + k] = Math.round(acc[k] / (S * S));
      png.data[i + 3] = 255;
    }
  }
  return PNG.sync.write(png);
}

export const ICONS: { file: string; size: number; radius: number }[] = [
  { file: 'icon-192.png', size: 192, radius: 0.62 },
  { file: 'icon-512.png', size: 512, radius: 0.62 },
  // Zone sûre d'une icône « maskable » : le cercle central de 80 % du côté.
  { file: 'icon-maskable-512.png', size: 512, radius: 0.5 },
  { file: 'apple-touch-icon.png', size: 180, radius: 0.62 },
];

export const SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="#0B0B0C"/><path d="M32 12a20 20 0 0 0 0 40z" fill="#3E6BFF"/><circle cx="32" cy="32" r="19" fill="none" stroke="#F3F3F1" stroke-width="3"/></svg>\n`;

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  mkdirSync(OUT, { recursive: true });
  for (const i of ICONS) writeFileSync(`${OUT}${i.file}`, iconPng(i.size, i.radius));
  writeFileSync(`${OUT}icon.svg`, SVG);
  console.log(`${ICONS.length + 1} icônes écrites dans ${OUT}`);
}
```

Commande : `npm run web:icons`
Attendu : `5 icônes écrites dans …/apps/web/public/icons/` ; `icon-192.png` (environ 4,5 Ko), `icon-512.png`, `icon-maskable-512.png`, `apple-touch-icon.png` et `icon.svg`. Ouvrir `icon-192.png` pour vérifier le dessin : un cercle clair, moitié gauche bleue, sur fond presque noir.

- [ ] **Étape 4 : vérifier le succès**

Commande : `npx vitest run --project web apps/web/test/app/files.test.ts apps/web/test/app/pwa.test.ts`
Attendu : `Test Files  2 passed (2)`, `Tests  5 passed (5)`.

Commande : `npm test && npm run typecheck`
Attendu : `Test Files  95 passed (95)`, `Tests  916 passed (916)`, typage sans erreur.

- [ ] **Étape 5 : commit**

```bash
git add apps/web/lib/file-response.ts apps/web/app/audio apps/web/app/pdf apps/web/app/manifest.ts apps/web/scripts/make-icons.ts apps/web/public/icons apps/web/test/app/files.test.ts apps/web/test/app/pwa.test.ts
git commit -m "feat(web): audio et PDF par URL signée, manifeste PWA et icônes"
```

---

### Tâche 13 : contrôles de sécurité, Playwright à 390 px et captures de référence

**Fichiers :**
- Créer : `apps/web/scripts/check-bundle.ts`, `apps/web/playwright.config.ts`, `apps/web/e2e/helpers.ts`, `apps/web/e2e/smoke.spec.ts`, `apps/web/e2e/visual.spec.ts`, `apps/web/e2e/visual.spec.ts-snapshots/` (12 captures générées)
- Test : `apps/web/test/security/static.test.ts`, `apps/web/test/security/bundle.test.ts`

Comportement attendu :
- **Règles du code (Vitest).** Elles portent sur le code livré, hors tests et scripts :
  - `dangerouslySetInnerHTML` n'apparaît que dans `components/MapSvg.tsx` ;
  - `service_role`, `SERVICE_ROLE` et `sb_secret` n'apparaissent que dans `lib/env.ts`, qui les refuse ;
  - les seules variables `NEXT_PUBLIC_` sont l'URL et la clé publique de Supabase ;
  - les modules de données et d'authentification commencent par `import 'server-only'`, et aucun composant client ne les importe (sauf des types) ;
  - ni `next/image` ni `remotePatterns` ;
  - `renderMap` échappe un libellé `<script>`.
- **Code du navigateur.** `npm run web:check-bundle` construit l'appli avec des valeurs témoins dans les variables serveur. Il cherche ensuite dans `.next/static` ces valeurs, les noms des variables serveur, `service_role`, `sb_secret_` et le chemin de la fixture. Codes : 0 = propre, 1 = fuite, 2 = build impossible.
- **Playwright (`npm run web:e2e`).** Il tourne sur le build de production en `FIXTURE=1`, à 390 px, en projets `clair` et `sombre`.
  - **Chaque écran.** Statut 200, aucune erreur de console ni violation de CSP, aucun défilement horizontal. Les jetons `--bg` et `--ink` et le fond du `body` sont ceux de `design/app.css` pour le thème.
  - **CSP.** Elle porte un nonce.
  - **Parcours.**
    - **Brief.** Le Brief FR a 7 cartes, dont 5 cartes SVG, et la durée du lecteur `0:03` est lue sur le MP3.
    - **Puces et onglet.** La puce Culture grisée affiche le message vide ; l'onglet ES reste retenu et n'a pas de lecteur.
    - **Écritures.** Un mot coché puis mis en file Anki l'est encore après rechargement ; un Thread suivi aussi.
    - **Santé.** Elle affiche « interrompu ».
    - **Manifeste.** Le manifeste et ses icônes sont servis sans session.
  - **Écritures et thèmes.** Les deux parcours qui écrivent ne tournent qu'en clair : l'état en mémoire du serveur est partagé entre les deux projets.
- **Captures.** Six zones par thème, comparées à 1 % de pixels près. L'en-tête collant et la barre d'onglets sont remis dans le flux pendant la capture, pour ne pas couvrir la zone.

- [ ] **Étape 1 : écrire les tests Vitest**

Fichier `apps/web/test/security/static.test.ts` :

```ts
// @vitest-environment node
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import { renderMap } from '@daily-brief/maps';

const WEB = join(process.cwd(), 'apps/web');
// Code livré seulement : ni les tests, ni les scripts de développement (check-bundle nomme les secrets qu'il cherche).
const SKIP = new Set(['node_modules', '.next', 'test', 'e2e', 'public', 'scripts']);

function sources(dir = WEB): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) return SKIP.has(f) ? [] : sources(p);
    return /\.(ts|tsx)$/.test(f) ? [relative(WEB, p)] : [];
  });
}

const read = (f: string) => readFileSync(join(WEB, f), 'utf8');

describe('règles de sécurité du code de l’appli', () => {
  it('n’utilise dangerouslySetInnerHTML que pour la carte SVG', () => {
    expect(sources().filter((f) => read(f).includes('dangerouslySetInnerHTML'))).toEqual(['components/MapSvg.tsx']);
  });

  it('ne mentionne jamais la clé de service', () => {
    expect(sources().filter((f) => /SERVICE_ROLE|service_role|sb_secret/.test(read(f)) && f !== 'lib/env.ts')).toEqual([]);
  });

  it('n’expose au navigateur que les deux variables publiques de Supabase', () => {
    const names = new Set(sources().flatMap((f) => [...read(f).matchAll(/NEXT_PUBLIC_[A-Z_]+/g)].map((x) => x[0])));
    expect([...names].sort()).toEqual(['NEXT_PUBLIC_SUPABASE_ANON_KEY', 'NEXT_PUBLIC_SUPABASE_URL']);
  });

  it('les modules de données et d’authentification sont réservés au serveur', () => {
    for (const f of ['lib/data/index.ts', 'lib/data/fixture.ts', 'lib/data/supabase.ts', 'lib/supabase/server.ts', 'lib/auth.ts', 'lib/file-response.ts']) {
      expect(read(f), f).toMatch(/^import 'server-only';/);
    }
    const clients = sources().filter((f) => read(f).startsWith("'use client'"));
    // Un import de type (`import type`) disparaît à la compilation : seuls les imports de valeur comptent.
    for (const f of clients) expect(read(f), f).not.toMatch(/^import (?!type )[^;]*'@\/lib\/(data|supabase|auth|env)/m);
  });

  it('n’utilise pas next/image (pas d’optimiseur qui irait chercher des URL côté serveur)', () => {
    expect(sources().filter((f) => /from 'next\/image'/.test(read(f)))).toEqual([]);
    expect(read('next.config.ts')).not.toMatch(/remotePatterns|domains/);
  });

  it('la carte SVG échappe les libellés venus de l’édition', () => {
    const svg = renderMap({ projection: 'conic-france', places: [{ name: '<script>alert(1)</script>', lon: 2.35, lat: 48.86 }] }, '"><img src=x onerror=alert(1)>');
    expect(svg).not.toMatch(/<script|<img/);
    expect(svg).toContain('&lt;script&gt;');
  });
});
```

Fichier `apps/web/test/security/bundle.test.ts` :

```ts
// @vitest-environment node
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CANARIES, NEEDLES, scanBundle } from '../../scripts/check-bundle';

describe('contrôle du code envoyé au navigateur', () => {
  it('trouve une valeur témoin ou un nom de variable serveur, et rien dans un fichier propre', () => {
    const dir = mkdtempSync(join(tmpdir(), 'bundle-'));
    mkdirSync(join(dir, 'chunks'));
    writeFileSync(join(dir, 'chunks/a.js'), 'const x = "propre";');
    writeFileSync(join(dir, 'chunks/b.js'), `const k = "${CANARIES.ALLOWED_EMAIL}"; // service_role, process.env.ALLOWED_EMAIL`);
    expect(scanBundle(dir)).toEqual([
      ['chunks/b.js', 'service_role'],
      ['chunks/b.js', 'ALLOWED_EMAIL'],
      ['chunks/b.js', CANARIES.ALLOWED_EMAIL],
    ]);
    expect(NEEDLES).toContain('SUPABASE_SERVICE_ROLE_KEY');
  });
});
```

- [ ] **Étape 2 : vérifier l'échec**

Commande : `npx vitest run --project web apps/web/test/security`
Attendu : `static.test.ts` passe (le code des tâches 1 à 12 respecte déjà ces règles) ; `bundle.test.ts` échoue, `Failed to load url ../../scripts/check-bundle` (le script n'existe pas encore). Si `static.test.ts` échoue, corriger le fichier qu'il nomme avant de continuer.

- [ ] **Étape 3 : écrire le contrôle du code du navigateur et les tests Playwright**

Fichier `apps/web/scripts/check-bundle.ts` :

```ts
/**
 * Contrôle « aucun secret dans le code envoyé au navigateur » : construit l'appli avec des valeurs
 * témoins dans les variables serveur, puis cherche dans .next/static (seuls fichiers servis au
 * navigateur) ces valeurs, les noms des variables serveur et `service_role`.
 * Commande : npm run web:check-bundle (code 0 : propre ; 1 : fuite ; 2 : build impossible).
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const WEB = fileURLToPath(new URL('..', import.meta.url));

export const CANARIES = {
  SUPABASE_SERVICE_ROLE_KEY: 'canary-service-role-7f3a9c',
  ALLOWED_EMAIL: 'canary-allowed-7f3a9c@example.invalid',
  SITE_URL: 'https://canary-site-7f3a9c.example.invalid',
};

/** Ce qui ne doit jamais apparaître côté navigateur. */
export const NEEDLES = ['service_role', 'sb_secret_', ...Object.keys(CANARIES), ...Object.values(CANARIES), 'fixtures/brief-2026-11-06.json'];

/** Fichiers de `dir` contenant l'une des aiguilles : [fichier, aiguille][]. */
export function scanBundle(dir: string, needles: string[] = NEEDLES): [string, string][] {
  const hits: [string, string][] = [];
  const walk = (d: string) => {
    for (const f of readdirSync(d)) {
      const p = join(d, f);
      if (statSync(p).isDirectory()) walk(p);
      else {
        const text = readFileSync(p, 'latin1');
        for (const n of needles) if (text.includes(n)) hits.push([relative(dir, p), n]);
      }
    }
  };
  walk(dir);
  return hits;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try {
    execFileSync('npx', ['next', 'build'], {
      cwd: WEB,
      stdio: 'inherit',
      env: { ...process.env, ...CANARIES, FIXTURE: '', NEXT_TELEMETRY_DISABLED: '1', NEXT_PUBLIC_SUPABASE_URL: 'https://canary.supabase.co', NEXT_PUBLIC_SUPABASE_ANON_KEY: 'sb_publishable_canary' },
    });
  } catch {
    console.error('Build impossible.');
    process.exit(2);
  }
  const dir = join(WEB, '.next/static');
  if (!existsSync(dir)) {
    console.error('.next/static absent.');
    process.exit(2);
  }
  const hits = scanBundle(dir);
  for (const [file, needle] of hits) console.error(`fuite : « ${needle} » dans .next/static/${file}`);
  console.log(hits.length ? `${hits.length} fuite(s) dans le code du navigateur.` : 'Aucun secret ni nom de variable serveur dans le code du navigateur.');
  process.exit(hits.length ? 1 : 0);
}
```

Fichier `apps/web/playwright.config.ts` :

```ts
import { defineConfig } from '@playwright/test';

const PORT = 3210;

/**
 * Tests de bout en bout en mode FIXTURE=1 (aucun réseau, aucune clé), sur le build de production
 * (`npm run web:build` d'abord), à 390 px, en clair et en sombre.
 */
export default defineConfig({
  testDir: './e2e',
  reporter: 'list',
  fullyParallel: true,
  workers: 2,
  outputDir: '../../out/web-e2e',
  use: { baseURL: `http://127.0.0.1:${PORT}`, viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 },
  projects: [
    { name: 'clair', use: { colorScheme: 'light' } },
    { name: 'sombre', use: { colorScheme: 'dark' } },
  ],
  webServer: {
    command: `npx next start -p ${PORT} -H 127.0.0.1`,
    url: `http://127.0.0.1:${PORT}/login`,
    env: { FIXTURE: '1', NEXT_TELEMETRY_DISABLED: '1' },
    reuseExistingServer: false,
    timeout: 60_000,
  },
  expect: { toHaveScreenshot: { maxDiffPixelRatio: 0.01, animations: 'disabled', caret: 'hide' } },
});
```

Fichier `apps/web/e2e/helpers.ts` :

```ts
import { expect, type Page } from '@playwright/test';

/** Erreurs de la console et de la page (une violation de CSP apparaît ici). */
export function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  page.on('pageerror', (e) => errors.push(String(e)));
  return errors;
}

/** Page chargée, polices prêtes. */
export async function open(page: Page, path: string): Promise<void> {
  const r = await page.goto(path);
  expect(r?.status(), path).toBe(200);
  await page.evaluate(() => document.fonts.ready);
}

/** Aucun défilement horizontal à 390 px. */
export async function expectNoHorizontalOverflow(page: Page): Promise<void> {
  const width = await page.evaluate(() => Math.max(document.documentElement.scrollWidth, document.body.scrollWidth));
  expect(width).toBeLessThanOrEqual(390);
}
```

Fichier `apps/web/e2e/smoke.spec.ts` :

```ts
import { expect, test } from '@playwright/test';
import { collectErrors, expectNoHorizontalOverflow, open } from './helpers';

/** Jetons de design/app.css attendus pour chaque thème. */
const TOKENS = {
  light: { bg: '#F4F4F1', ink: '#0E0E10', fr: '#3E6BFF', body: 'rgb(244, 244, 241)' },
  dark: { bg: '#0B0B0C', ink: '#F3F3F1', fr: '#7B97FF', body: 'rgb(11, 11, 12)' },
};

const PAGES = ['/', '/?ed=en', '/?ed=es', '/edition/2026-11-06', '/threads', '/vocab', '/archive?m=2026-11', '/sante', '/login'];

for (const path of PAGES) {
  test(`${path} s’affiche sans erreur ni débordement`, async ({ page }, info) => {
    const errors = collectErrors(page);
    await open(page, path);
    await expectNoHorizontalOverflow(page);
    const theme = info.project.name === 'sombre' ? TOKENS.dark : TOKENS.light;
    const css = await page.evaluate(() => {
      const s = getComputedStyle(document.documentElement);
      return { bg: s.getPropertyValue('--bg').trim(), ink: s.getPropertyValue('--ink').trim(), fr: s.getPropertyValue('--fr').trim(), body: getComputedStyle(document.body).backgroundColor };
    });
    expect(css.bg.toUpperCase()).toBe(theme.bg);
    expect(css.ink.toUpperCase()).toBe(theme.ink);
    expect(css.body).toBe(theme.body);
    expect(errors).toEqual([]);
  });
}

test('la CSP porte un nonce et n’autorise que Pexels pour les images', async ({ page }) => {
  const r = await page.goto('/');
  const csp = r?.headers()['content-security-policy'] ?? '';
  expect(csp).toMatch(/script-src 'self' 'nonce-[A-Za-z0-9+/=]+' 'strict-dynamic'/);
  expect(csp).toContain("img-src 'self' data: https://images.pexels.com");
  expect(csp).toContain("frame-ancestors 'none'");
  expect(r?.headers()['x-content-type-options']).toBe('nosniff');
});

test('le Brief FR suit la maquette : onglets, cartes, puces, lecteur', async ({ page }) => {
  await open(page, '/?ed=fr');
  await expect(page.locator('.editions a')).toHaveCount(3);
  await expect(page.locator('.editions a[aria-current="page"]')).toHaveAttribute('data-ed', 'fr');
  await expect(page.locator('.card')).toHaveCount(7);
  await expect(page.locator('.card svg.map')).toHaveCount(5);
  await expect(page.locator('.ptime')).toContainText('0:03');
  await page.getByRole('button', { name: 'Culture' }).click();
  await expect(page.locator('.empty')).toBeVisible();
  await expect(page.locator('.rub:visible')).toHaveCount(0);
  await page.getByRole('button', { name: 'Sport' }).click();
  await expect(page.locator('.rub:visible')).toHaveCount(1);
});

test('l’onglet choisi est retenu', async ({ page }) => {
  await open(page, '/?ed=es');
  await open(page, '/');
  await expect(page.locator('.editions a[aria-current="page"]')).toHaveAttribute('data-ed', 'es');
  await expect(page.locator('.player')).toHaveCount(0);
  await open(page, '/?ed=fr');
});

test('cocher un mot et le mettre en file Anki survit au rechargement', async ({ page }, info) => {
  test.skip(info.project.name === 'sombre', 'état partagé du serveur : un seul projet écrit');
  await open(page, '/vocab?langue=es');
  const first = page.locator('.vrow').first();
  await first.locator('.box').click();
  await page.getByRole('button', { name: 'Ajouter 1 mot à Anki' }).click();
  await expect(page.getByRole('status')).toHaveText('1 mot en file pour Anki ✓');
  await open(page, '/vocab?langue=es&coche=oui');
  await expect(page.locator('.vrow')).toHaveCount(1);
  await expect(page.locator('.vrow input').first()).toBeChecked();
});

test('un Thread se suit depuis sa frise', async ({ page }, info) => {
  test.skip(info.project.name === 'sombre', 'état partagé du serveur : un seul projet écrit');
  await open(page, '/threads');
  await page.getByRole('link', { name: /Crisis ferroviaria 2026/ }).click();
  await expect(page.locator('.timeline li')).toHaveCount(3);
  await page.getByRole('button', { name: 'Seguir este hilo' }).click();
  await expect(page.getByRole('button', { name: 'Hilo seguido' })).toHaveAttribute('aria-pressed', 'true');
  await page.reload();
  await expect(page.getByRole('button', { name: 'Hilo seguido' })).toBeVisible();
});

test('la page Santé signale le passage interrompu', async ({ page }) => {
  await open(page, '/sante');
  await expect(page.locator('.run')).toHaveCount(3);
  await expect(page.locator('.run[data-status="interrupted"] .st')).toHaveText('interrompu');
});

test('le manifeste et les icônes sont servis sans session', async ({ request }) => {
  const m = await request.get('/manifest.webmanifest');
  expect(m.status()).toBe(200);
  const manifest = await m.json();
  expect(manifest.display).toBe('standalone');
  for (const icon of manifest.icons) expect((await request.get(icon.src)).headers()['content-type']).toBe('image/png');
});
```

Fichier `apps/web/e2e/visual.spec.ts` :

```ts
import { expect, test } from '@playwright/test';
import { open } from './helpers';

/**
 * Captures de référence (spec §13) : zones clés à 390 px, en clair et en sombre, comparées aux images
 * de e2e/visual.spec.ts-snapshots/ (écart toléré : 1 % des pixels). Après un changement voulu :
 * npm run web:e2e -- --update-snapshots, puis regarder les images avant de les commiter.
 */
const SHOTS: { name: string; path: string; selector: string; click?: string }[] = [
  { name: 'brief-fr-entete', path: '/?ed=fr', selector: '.mb' },
  { name: 'brief-fr-carte', path: '/?ed=fr', selector: '.card >> nth=0' },
  { name: 'brief-en-vocab', path: '/?ed=en', selector: '.vocab' },
  { name: 'thread-fr', path: '/threads', click: 'Épisodes méditerranéens 2026', selector: '.th-head' },
  { name: 'archive', path: '/archive?m=2026-11', selector: '.cal' },
  { name: 'sante', path: '/sante', selector: '.run >> nth=0' },
];

for (const shot of SHOTS) {
  test(`capture ${shot.name}`, async ({ page }) => {
    await open(page, shot.path);
    if (shot.click) {
      await page.getByRole('link', { name: shot.click }).click();
      await page.waitForURL(/\/threads\/[0-9a-f-]{36}$/);
    }
    // En-tête collant et barre d'onglets fixe : remis dans le flux, pour ne pas couvrir la zone capturée.
    await page.addStyleTag({ content: '.topbar,.tabbar{position:static!important}' });
    await expect(page.locator(shot.selector)).toHaveScreenshot(`${shot.name}.png`);
  });
}
```

- [ ] **Étape 4 : vérifier**

Commande : `npx vitest run --project web apps/web/test/security`
Attendu : `Test Files  2 passed (2)`, `Tests  7 passed (7)`.

Commande : `npm test && npm run typecheck`
Attendu : `Test Files  97 passed (97)`, `Tests  923 passed (923)`, typage sans erreur.

Commande : `HTTPS_PROXY=http://127.0.0.1:9 npm run web:check-bundle`
Attendu : le build, puis `Aucun secret ni nom de variable serveur dans le code du navigateur.`, code 0.

Commande : `HTTPS_PROXY=http://127.0.0.1:9 npm run web:build && npm run web:e2e -- e2e/smoke.spec.ts`
Attendu : `30 passed`, `2 skipped`.

Les captures n'existent pas encore : les créer, puis **les regarder** (au moins `brief-fr-carte-clair-linux.png`, `brief-en-vocab-sombre-linux.png` et `sante-clair-linux.png`), et les comparer à `design/maquette-v2.html` avant de les commiter.

Commande : `npm run web:e2e -- e2e/visual.spec.ts --update-snapshots`
Attendu : `12 passed` et douze fichiers `*-clair-linux.png` / `*-sombre-linux.png` dans `apps/web/e2e/visual.spec.ts-snapshots/` (15 à 125 Ko chacun).

Commande : `npm run web:e2e`
Attendu : `42 passed`, `2 skipped`.

- [ ] **Étape 5 : commit**

```bash
git add apps/web/scripts/check-bundle.ts apps/web/playwright.config.ts apps/web/e2e apps/web/test/security
git commit -m "test(web): contrôles de sécurité, Playwright à 390 px en clair et sombre, captures de référence"
```

---

### Tâche 14 : documentation, mise en place Vercel et consignes

**Fichiers :**
- Créer : `docs/setup-web.md`
- Modifier : `README.md`, `docs/superpowers/plans/2026-11-06-phase-1-roadmap.md` (lot 6 et consignes issues du lot 6)

Rien n'est déployé dans ce lot : la création du projet Vercel, les variables et les réglages d'authentification de Supabase dépendent de Naïm et se font en suivant ce guide.

- [ ] **Étape 1 : écrire le guide de mise en place**

Fichier `docs/setup-web.md` :

````markdown
# Mise en place de l'application web (Vercel)

Ce guide met en ligne l'appli du Daily Brief (spec §5, §8.3 et §14, étape 5). Il se suit une fois, en 15 minutes environ, **après** `docs/setup-supabase.md` (projet, migrations, email autorisé). Rien ici n'est fait par les tests : ils tournent en mode `FIXTURE=1`, sans réseau ni Supabase.

Deux règles valent pour tout le guide :

- **L'appli n'utilise que la clé publique** de Supabase (`anon` ou `sb_publishable_…`). La clé de service (`service_role` ou `sb_secret_…`) ne doit jamais entrer dans Vercel : l'appli refuse de démarrer si on la lui donne par erreur.
- **`FIXTURE=1` n'existe qu'en local.** Ce mode ouvre l'appli sans connexion ; il est refusé sur Vercel.

## 1. Créer le projet Vercel

1. Sur <https://vercel.com/new>, importer le dépôt GitHub `daily-brief`.
2. *Root Directory* : `apps/web`. Laisser cochée l'option qui inclut les fichiers hors de ce dossier : l'appli importe `packages/schema` et `packages/maps`.
3. *Framework Preset* : Next.js. Laisser les commandes par défaut : Vercel installe depuis la racine (`package-lock.json` des workspaces npm) puis lance `next build`.
4. *Node.js Version* (*Settings* → *Build and Deployment*) : 22.x.
5. Ne pas déployer tout de suite : renseigner d'abord les variables (§2).

## 2. Variables d'environnement

*Settings* → *Environment Variables*, pour *Production* (et *Preview* si besoin) :

| Nom | Valeur | Secret ? |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | `https://<référence>.supabase.co` | non (envoyée au navigateur) |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | clé publique du projet (*Project Settings* → *API Keys* : `anon` ou `sb_publishable_…`) | non (publique par nature, protégée par la RLS) |
| `ALLOWED_EMAIL` | la **même** adresse que `private.app_settings` (`docs/setup-supabase.md` §3) | non, mais jamais envoyée au navigateur |
| `SITE_URL` | l'adresse publique du site, en https (`https://daily-brief-xxx.vercel.app` ou le domaine choisi) | non |

C'est la RLS de la base qui protège les données. `ALLOWED_EMAIL` est une défense en profondeur : l'appli n'envoie aucun lien magique à une autre adresse (pas d'abus du quota d'envoi de Supabase) et renvoie vers la connexion toute session d'une autre adresse. Si les deux adresses diffèrent, personne ne lit rien : corriger l'une ou l'autre.

`SITE_URL` fixe l'adresse du lien envoyé par courriel : sans elle, un lien n'est envoyé que depuis `localhost`.

## 3. Réglages d'authentification Supabase

Dans le tableau de bord Supabase, *Authentication* :

1. *URL Configuration* :
   - *Site URL* : la valeur de `SITE_URL` ;
   - *Redirect URLs* : `https://<SITE_URL>/auth/confirm` (et `http://localhost:3000/auth/confirm` pour le développement local).
2. *Emails* → *Magic Link* : remplacer le modèle par celui-ci, qui donne à la fois un lien et un code :

   ```html
   <h2>Daily Brief</h2>
   <p><a href="{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=email">Se connecter</a></p>
   <p>Ou saisir ce code dans l'appli : <strong>{{ .Token }}</strong></p>
   ```

   Le lien `token_hash` marche même s'il s'ouvre dans un autre navigateur que celui de la demande. Le **code** sert à l'appli installée sur l'écran d'accueil : sur iPhone, le lien du courriel s'ouvre dans Safari, pas dans l'appli installée, qui garde ses propres cookies.
3. *Sign In / Providers* → *Email* : activé, *Confirm email* activé (déjà fait au guide Supabase). Après la première connexion, désactiver *Allow new users to sign up*.

## 4. Déployer et se connecter

1. *Deployments* → *Redeploy* (ou pousser sur la branche de production).
2. Ouvrir le site : il renvoie vers `/login`. Saisir l'adresse autorisée, puis ouvrir le lien reçu (ou saisir le code).
3. Le Brief du jour s'affiche. Avant le premier passage de la routine, la page indique « Aucune édition publiée ».
4. Installer sur l'écran d'accueil : Safari → *Partager* → *Sur l'écran d'accueil* ; Chrome Android → *Installer l'application*. Dans l'appli installée, se connecter avec le **code** du courriel.

## 5. Développement local

```bash
npm install
FIXTURE=1 npm run web:dev          # http://localhost:3000, données de fixtures/, sans connexion
FIXTURE=1 FIXTURE_TODAY=2026-11-07 npm run web:dev   # bandeau « brief de la veille »
FIXTURE=1 FIXTURE_LIGHT=fr npm run web:dev           # bandeau « édition allégée » sur FR
```

Avec le vrai projet Supabase, créer `apps/web/.env.local` (ignoré par git) avec `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` et `ALLOWED_EMAIL`, puis `npm run web:dev`.

Contrôles avant un déploiement :

```bash
npm test && npm run typecheck
npm run web:build && npm run web:e2e   # captures à 390 px, clair et sombre (FIXTURE=1)
npm run web:check-bundle               # aucun secret ni nom de variable serveur côté navigateur
```

## 6. À contrôler sur le vrai service

Ces points ne peuvent pas être vérifiés hors ligne. Ils sont à cocher au premier essai.

- [ ] **Build Vercel.** Le build Turbopack réussit depuis `apps/web` avec les paquets du dépôt (`transpilePackages`) ; la carte du monde (world-atlas 50m) tient dans la fonction serveur.
- [ ] **Jeton.** `getClaims()` renvoie bien `email` pour une session ouverte par lien magique (le proxy et la RLS en dépendent).
- [ ] **Lien et code.** Le lien du courriel ouvre une session (`/auth/confirm?token_hash=…`) ; le code à 6 chiffres aussi, depuis l'appli installée.
- [ ] **Autre adresse.** Une autre adresse ne reçoit aucun courriel ; une session d'une autre adresse est renvoyée vers `/login?erreur=refuse`.
- [ ] **Écritures.** Cocher un mot, « Ajouter à Anki » et « Suivre ce thread » écrivent en base ; aucune autre écriture n'est possible (RLS).
- [ ] **Audio.** Le lecteur joue le MP3 par l'URL signée (redirection de `/audio/<date>/<langue>`) et affiche sa durée ; la console ne montre aucune violation de CSP (`media-src` contient l'origine Supabase). Vérifier aussi un MP3 concaténé sans ffmpeg (consigne du lot 5).
- [ ] **PDF.** « PDF du jour » télécharge `Daily Brief AAAA-MM-JJ.pdf`.
- [ ] **Photos.** Une photo Pexels s'affiche (CSP `img-src https://images.pexels.com`).
- [ ] **CSP.** Aucune violation dans la console, sur chaque écran, en production.
- [ ] **Cookies.** Les cookies de session et `ed` portent `Secure` en https.
- [ ] **PWA.** L'installation fonctionne sur iPhone et Android ; l'icône et la couleur de fond sont correctes.
````

- [ ] **Étape 2 : compléter le README**

Dans `README.md`, section « Développement », ajouter ces lignes à la fin du bloc de commandes (après `npm run maps:preview …`) :

```bash
npm run web:dev        # appli web (FIXTURE=1 : données de fixtures/, sans connexion)
npm run web:build      # build de production de apps/web (hors ligne)
npm run web:e2e        # Playwright à 390 px, clair et sombre, en FIXTURE=1 (après web:build)
npm run web:check-bundle   # aucun secret ni nom de variable serveur dans le code du navigateur
npm run web:icons      # régénère les icônes PWA de apps/web/public/icons/
```

Puis, juste avant la ligne `Plans d'implémentation : docs/superpowers/plans/.`, ajouter ce paragraphe :

```markdown
L'application web (`apps/web`, Next.js 16) lit Supabase avec la clé publique et la session de l'utilisateur : la RLS ne laisse lire que l'adresse autorisée, et l'appli n'écrit que `vocab_items.selected`, `vocab_items.anki_status` (mise en file Anki) et `threads.followed`. La connexion se fait par lien magique, ou par le code du même courriel, envoyé seulement à `ALLOWED_EMAIL`. Le MP3 et le PDF passent par des URL signées de 10 minutes. Avec `FIXTURE=1`, l'appli lit `fixtures/` sans connexion ni réseau : c'est le mode des tests (Vitest et Testing Library dans `npm test`, Playwright dans `npm run web:e2e`), interdit sur Vercel. Mise en ligne : `docs/setup-web.md`.
```

- [ ] **Étape 3 : mettre à jour la feuille de route**

Dans `docs/superpowers/plans/2026-11-06-phase-1-roadmap.md` :

1. Remplacer le titre `### Lot 6 — Application web` par :

```markdown
### Lot 6 — Application web ✅ plan détaillé

Plan : `docs/superpowers/plans/2026-11-06-phase-1-lot-6-appli-web.md`
```

2. À la fin de la section « Consignes issues du lot 5 » (après sa dernière puce, quelle qu'elle soit au moment de l'exécution), ajouter :

```markdown
### Consignes issues du lot 6

- **Lot 7 (routine et lancement)** :
  - **Mise en place.** Suivre `docs/setup-web.md` : projet Vercel (dossier `apps/web`, Node 22), variables `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `ALLOWED_EMAIL` (la même adresse que `private.app_settings`) et `SITE_URL`, puis réglages *URL Configuration* et modèle de courriel *Magic Link* de Supabase (lien `token_hash` et code). Cocher sa section 6 au premier passage réel.
  - **Interdits sur Vercel.** Jamais la clé de service (l'appli refuse de démarrer avec une clé `service_role` ou `sb_secret_…`), jamais `FIXTURE` (refusé quand `VERCEL` est présent).
  - **Contrôle du site au lancement.** `npm run web:build && npm run web:e2e` et `npm run web:check-bundle` avant le déploiement, puis, sur le site réel, connexion, lecture du MP3, PDF du jour, case cochée, Thread suivi, page Santé.
  - **Types de la base.** Générer les types TypeScript depuis le projet réel une fois les migrations appliquées, et les comparer aux schémas zod de `apps/web/lib/data/rows.ts` (ce lot n'a pas eu accès au projet).
  - **Étape `audio` dans `runs`.** La page Santé affiche toute étape présente dans `runs.steps`, dans l'ordre `context`, `collect`, `verify`, `audio`, `render`, `publish`, `drive` : l'étape `audio` apparaîtra dès que `pipeline/publish/run-summary.ts` l'écrira (consigne du lot 5). Une ligne `running` de plus de 6 h (depuis `updated_at`) s'affiche « interrompu ».
  - **Notification.** Le site affiche de lui-même la veille avec un bandeau quand l'édition du jour manque, et le bandeau « édition allégée » quand `editions.status = 'light'` : la routine n'a rien à faire de plus pour eux.
- **Phase 2** :
  - **Anki.** La synchro lit `vocab_items` à `anki_status = 'queued'` et les passe à `sent` avec la clé de service ; l'appli ne rétrograde jamais un mot `sent`.
  - **Hors ligne.** Pas de service worker en phase 1 : la lecture hors ligne demandera un cache qui se vide à la déconnexion.
```

- [ ] **Étape 4 : vérification finale**

Commande : `npm test && npm run typecheck`
Attendu : `Test Files  97 passed (97)`, `Tests  923 passed (923)`, typage sans erreur.

Commande : `HTTPS_PROXY=http://127.0.0.1:9 npm run web:build && npm run web:e2e`
Attendu : `42 passed`, `2 skipped`.

Commande : `git status --short fixtures/brief-2026-11-06.json design reference packages pipeline supabase apps-script`
Attendu : aucune sortie (rien de modifié hors du lot).

- [ ] **Étape 5 : commit**

```bash
git add docs/setup-web.md README.md docs/superpowers/plans/2026-11-06-phase-1-roadmap.md
git commit -m "docs: mise en place de l'appli web (Vercel, Supabase Auth), commandes et consignes du lot 6"
```

---

## Couverture du lot (auto-revue)

| Exigence (spec, feuille de route, consignes) | Tâche |
|---|---|
| §5 `apps/web` : Next.js App Router, Vercel ; workspace `apps/*`, versions figées, `transpilePackages` (consigne du lot 1), TypeScript strict | 1 |
| §8.1 Geist auto-hébergé (`next/font/local` du paquet `geist`), thème automatique clair/sombre, accents FR/EN/ES, jetons de `design/app.css` | 1, 9, 13 |
| §3 libellés des rubriques et de l'édition traduits ; rubrique sans actualité : puce grisée et message vide | 2, 10 |
| §8.2 anatomie d'une carte (ordre, éléments absents sans trou, « Résumé IA », traduction de citation, divergences, Thread, lien prépa, « N sources », « Lire ») | 8 |
| §8.3 Brief : en-tête collant, logo demi-disque, onglets FR/EN/ES retenus (cookie), Morning Brief et lecteur, puces, rubriques et « En bref », Vocab du jour avec « Tout cocher » et « Ajouter N mots à Anki » (mise en file) | 9, 10, 11 |
| §8.3 Threads (liste puis frise, « Suivre ce thread »), Vocab (filtres langue, date, coché), Archive (calendrier), Santé (passages de la routine), barre d'onglets | 9, 11 |
| §8.3 manifeste PWA et icônes ; service worker non retenu (justifié) | 12 |
| §8.4 cartes rendues côté serveur avec `@daily-brief/maps` ; seul `dangerouslySetInnerHTML`, justifié et testé | 8, 13 |
| §6.2 lecture réservée à l'utilisateur autorisé (RLS), écriture limitée à `selected`, `anki_status`, `followed` ; buckets privés | 3, 5, 10 |
| Authentification : lien magique, `ALLOWED_EMAIL` vérifié avant l'envoi, proxy vers `/login`, route de retour, déconnexion ; `ALLOWED_EMAIL` en défense en profondeur | 6, 7 |
| §12 bandeau « édition allégée » (`editions.status`) et « brief de la veille » | 9, 10, 11 |
| Lot 3 : `running` de plus de 6 h affiché « interrompu » | 11 |
| Lot 4 : forme des données (`sections`, positions, brèves, `thread_subtitle`), équivalence vérifiée sur PGlite avec la vraie `publish_edition` | 3 |
| Lot 4 et 5 : MP3 et PDF par URL signée créée avec la session ; `audio_path` nul = pas de lecteur ; durée par `loadedmetadata` | 5, 10, 12 |
| Mode `FIXTURE=1` : `DataSource` fixture / Supabase, toutes les pages testables hors ligne, interdit sur Vercel | 3, 4, 5, 1 |
| Écritures par actions serveur validées par zod | 10 |
| Sécurité : CSP à nonce, en-têtes, aucune clé de service, aucun secret ni nom de variable serveur dans `.next/static`, échappement des textes du modèle, URL http(s) seulement, photos Pexels par `<img>` et CSP `img-src` (leçon SSRF du lot 2) | 5, 6, 8, 13 |
| §13 tests visuels de l'appli à 390 px, clair et sombre, à partir de la fixture | 13 |
| Tests de composants avec Vitest, Testing Library et jsdom, dans `npm test` | 1 à 13 |
| Mise en place Vercel (projet, variables, URL de redirection Supabase), sans déploiement | 14 |
| Feuille de route : lot 6 et consignes pour le lot 7 | 14 |
| Hors lot : déploiement réel (Naïm, `docs/setup-web.md`), génération des types depuis le vrai projet (lot 7), étape `audio` dans `runs` (lot 7), synchro Anki et lecture hors ligne (phase 2) | — |

## Ce qui n'a pas pu être vérifié hors ligne

Ces points sont repris, à cocher, dans la section 6 de `docs/setup-web.md`. Rien ici n'a touché Supabase, Vercel ni Google.

- **Jeton Supabase.** `getClaims()` doit renvoyer `email` pour une session ouverte par lien magique, sur un projet avec ou sans clés de signature asymétriques. Avec une clé symétrique historique, `getClaims()` interroge le serveur d'authentification à chaque requête : le proxy reste correct, un peu plus lent.
- **Courriel.** Il faut vérifier le modèle *Magic Link* modifié (lien `token_hash` et code), la longueur réelle du code (6 chiffres par défaut, accepté de 6 à 10) et le plafond d'envoi du SMTP intégré de Supabase.
- **iOS.** L'installation sur l'écran d'accueil est à essayer, ainsi que la connexion par code dans l'appli installée et la persistance des cookies de session dans ce mode.
- **URL signées.** Il reste à confirmer :
  - la forme réelle de l'URL de `createSignedUrl` (même origine que `NEXT_PUBLIC_SUPABASE_URL`, condition de la CSP `media-src`) ;
  - la lecture et le déplacement dans le MP3 après la redirection 307 (requêtes `Range`) ;
  - l'option `download` du PDF.
- **Build Vercel.** Il faut confirmer l'installation des workspaces depuis la racine avec *Root Directory* `apps/web`, Turbopack sur Vercel, la taille de la fonction serveur qui embarque l'atlas mondial (`world-atlas` 50m), et la présence de `VERCEL` à l'exécution comme au build (garde-fou de `FIXTURE`).
- **CSP en production.** Il faut vérifier l'absence de violation avec le nonce derrière le CDN de Vercel (pages dynamiques, donc jamais mises en cache avec un nonce périmé), puis `upgrade-insecure-requests` et l'en-tête `x-forwarded-proto`.
- **RLS réelle.** Les écritures de l'appli sont vérifiées contre la vraie RLS sur PGlite (lot 4) et contre un faux client ici. L'appel réel `update(...).in('id', …).select('id')` de PostgREST avec les droits de colonne reste à essayer : il demande le droit de lecture sur `id`, que la migration accorde.
- **Rendu sur appareil.** Les captures viennent de Chromium sous Linux, avec un rapport de pixels de 1. Le rendu sur iPhone (Safari, polices, `env(safe-area-inset-*)`, `backdrop-filter`) est à regarder à l'œil au lancement.

## Écarts après exécution (revues de code)

Le lot a été exécuté par sous-agents, avec une revue après chaque moitié du lot puis une revue finale. Les revues ont durci le code au-delà du texte ci-dessus. **Le dépôt fait foi** ; ce plan reste la trace de la conception initiale. Résultat final : 99 fichiers de test, 944 tests Vitest (2 fichiers et 21 tests de plus que prévu, ajoutés par les revues), typage strict propre ; 44 tests Playwright réussis et 2 ignorés (un test de plus que prévu, dans chaque thème).

| Zone | Écart par rapport au plan | Raison |
|---|---|---|
| Source Supabase | Uuid, dates et langues validés avant toute requête (réponse `null`, liste vide ou 0, comme la fixture) ; lignes de l'archive validées par zod ; une liste d'identifiants mêlée n'écrit que les uuid valides ; test d'équivalence `parity.test.ts` | Un paramètre invalide ne déclenche plus une erreur 22P02 de Postgres puis une page 500 ; même comportement dans les deux modes |
| Écritures | 1 à 500 identifiants au lieu de 50 (`lib/data/limits.ts` : `MAX_IDS = VOCAB_LIMIT`) | « Tout cocher » de /vocab (jusqu'à 500 mots affichés) passe en un seul appel d'action ; la source découpe ensuite l'écriture en lots (ligne suivante) |
| Écritures (lots de 100) | `setSelected` et `queueAnki` envoient au plus 100 identifiants par requête (`WRITE_BATCH`) et additionnent les comptes | 500 uuid dans un seul `?id=in.(…)` donnaient une URL d'environ 20 Ko, au-delà des limites des passerelles (Cloudflare, Kong) |
| Actions serveur | Utilisateur vérifié avant la validation de l'entrée ; `revalidatePath` des pages concernées (`/`, `/edition/[date]`, `/threads`, `/threads/[id]`, et `/vocab` après « Ajouter à Anki » seulement) | Une requête sans session n'apprend rien de la validation ; le cache client de Next ne montre plus d'état périmé ; sur /vocab filtré « Non cochés », un mot coché ne disparaît plus aussitôt |
| Actions côté client | `VocabCard` et `FollowButton` attrapent l'échec d'une action (rejet ou réponse en erreur), remettent l'état précédent, affichent le message et réactivent le bouton (`finally`) ; le proxy ne redirige plus une action serveur (POST avec `Next-Action`) sans session : l'action vérifie `currentUser()` en premier et répond « Session expirée » | Avant, le rejet n'était pas traité : l'interface gardait l'état optimiste, le bouton Anki restait désactivé, et « Session expirée » n'était jamais affiché. Vérifié sur `next start` : une action sans session ne rend que `{ ok: false, error }`, un identifiant d'action inconnu donne 400, une page reste redirigée (303) |
| Proxy | Redirection 303 au lieu de 307 ; exclusions du `matcher` ancrées (`manifest\.webmanifest$`, `favicon\.ico$`) | Le POST d'une action n'est pas rejoué vers /login ; `/favicon.icoX` ne contourne plus le proxy |
| Mode fixture | Refusé aussi en production (`next start`), sauf `FIXTURE_ALLOW_START=1`, que seul `playwright.config.ts` pose | Ce mode ouvre l'appli sans connexion |
| Connexion | `SITE_URL` contrôlée avant l'adresse ; un échec d'envoi donne la même réponse qu'une autre adresse, journalisé côté serveur sans l'adresse ; déconnexion `scope: 'local'` | La page ne révèle jamais si l'adresse est autorisée ; se déconnecter du navigateur ne ferme pas l'appli installée |
| Bandeaux | Troisième bandeau « Dernier brief » quand l'édition affichée a plus d'un jour ; libellés dans la langue de l'édition | « Brief de la veille » aurait été faux après plusieurs jours sans édition |
| Frise d'un Thread | Titre en `h1`, description du Thread (fixture seulement, `null` en base), retour « ← BRIEF » vers `/` comme la maquette, texte de chaque épisode, « Aujourd'hui » sur l'épisode du jour ; tri commun `lib/threads.ts` | Fidélité à la maquette (écran 2) et accessibilité ; comparateur de tri cohérent |
| Langue | Attribut `lang` sur l'édition, les mots du Vocab et leur traduction ; `lang="fr"` sur les libellés d'interface restés en français dans les éditions EN et ES (« Vocab du jour », « N mots », carte Vocab), comme la maquette | Lecteurs d'écran et césure |
| Styles | `backdrop-filter` redéclaré sous `@supports` ; contour de focus des cases du Vocab | Lightning CSS retirait le flou sans préfixe (test Playwright ajouté) ; navigation au clavier |
| Lecteur | Après une erreur, le bouton relance le chargement (URL signée neuve) au lieu de rester désactivé | Une URL signée expirée après une longue pause ne bloque plus l'écoute |
| PWA | `id: '/'` dans le manifeste | Identité stable de l'appli installée |
| Captures | `brief-fr-carte` (flou) et `thread-fr` (h1, description) refaites | Changements visuels voulus ci-dessus |
| Documentation | `docs/setup-web.md` : modèle *Confirm signup* remplacé aussi, forme exacte des *Redirect URLs*, code du courriel en développement local, portée de `web:check-bundle`, en-têtes de sécurité et HSTS de Vercel, règle `FIXTURE_ALLOW_START`, variables saisies dans l'écran d'import de Vercel | La toute première connexion envoie le modèle *Confirm signup* ; guide suivable sans connaître Next |

Points laissés ouverts (mineurs) : la base n'a pas de description de Thread (colonne à ajouter au lot 7 si elle est voulue) ; date de la frise au format « VEN. 6 NOV. » au lieu de « VEN 06 NOV ».
