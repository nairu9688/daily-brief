# Daily Brief — Phase 1 : feuille de route d'implémentation

> **Pour les agents :** ce document découpe la phase 1 en sept lots. Chaque lot a (ou aura) son propre plan détaillé dans `docs/superpowers/plans/`, exécuté avec superpowers:subagent-driven-development ou superpowers:executing-plans. Un lot produit un logiciel testable à lui seul. On n'écrit le plan détaillé d'un lot qu'au moment de l'attaquer, parce que les lots 3 à 7 dépendent des vérifications du §16 de la spec.

**Spec de référence :** `docs/specs/2026-11-06-daily-brief-design.md`
**Référence visuelle (fait foi) :** `design/maquette-v2.html`, `design/Daily-Brief-2026-11-06.pdf`, `design/app.css`, `design/pdf.css`, `design/app.js`
**Prototype à porter (pas à réécrire) :** `reference/mapgen2.mjs` (cartes), `reference/render.mjs` (appli + PDF), `reference/content.mjs` (données sources du prototype)

---

## 1. Choix techniques transverses

| Sujet | Choix | Raison |
|---|---|---|
| Runtime | Node 22 (présent dans le conteneur : v22.23) | Aligné sur la routine cloud |
| Monorepo | npm workspaces (`packages/*`, `pipeline`, `apps/*`) | Pas d'outil en plus ; `npm ci` dans la routine |
| Langage | TypeScript strict, exécuté par `tsx` (pas de build pour le pipeline) | Les paquets internes exportent leur `src/index.ts` ; Next.js les transpile via `transpilePackages` |
| Tests | Vitest à la racine (`npm test`) ; Playwright pour les tests visuels (lots 2 et 6) | Un seul lanceur pour tous les paquets |
| Schéma | Zod 4 comme source unique : types TS par `z.infer`, JSON Schema émis par `z.toJSONSchema` dans `packages/schema/edition.schema.json` | Le JSON Schema sert de contrat à Claude au moment de la rédaction |
| Format des fichiers du jour | `out/AAAA-MM-JJ/{fr,en,es}.json` = une `Edition` chacun ; `fixtures/brief-2026-11-06.json` = enveloppe `Brief { date, issue, editions[3] }` | Le pipeline travaille par édition, la fixture regroupe les trois |
| Sortie du contrôle | `brief:verify` écrit `{lang}.verified.json` (toujours conforme R1–R12) et `verify-report.json` ; code de sortie 0 = propre, 1 = corrections appliquées, 2 = schéma invalide | Concilie §7 (« ne bloque jamais l'édition ») et l'annexe A (« corrige ce qu'il signale, recommence ») : la routine relance jusqu'à 3 fois puis rend les fichiers `.verified.json` |
| Date du jour | Toujours la date de Paris (`Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris' })`) | La routine tourne à 05:13 Paris, donc 04:13 UTC |

## 2. Les sept lots

L'ordre conseillé est 1 → 2 → 3 → 4 → 5 → 6 → 7. Le lot 6 (appli web) peut démarrer dès que le lot 4 a posé les migrations Supabase. Le lot 5 (audio) est indépendant des lots 2 à 4.

### Lot 1 — Fondations, schéma et contrôle éditorial ✅ terminé (149 tests)

Plan : `docs/superpowers/plans/2026-11-06-phase-1-lot-1-fondations-schema-verify.md`

- Monorepo, TypeScript, Vitest, `.gitignore` (`out/`, `.env`, `node_modules`).
- `packages/schema` : types et validateurs Zod de `Edition`, `Brief`, `RawCollection` (sortie de la collecte) et `Context` (Threads ouverts), plus l'émission du JSON Schema.
- `pipeline/config/whitelist.json` (statut `full` / `feed` / `meta` et pays de chaque domaine, d'après le §4.2).
- `pipeline/editorial/programme-ect.md` (matières reconnues pour R9, à compléter par Naïm).
- `pipeline/verify/*` : contrôles R1 à R12 et CLI `npm run brief:verify`.
- Tests : validation de schéma sur la fixture, citations (dont le cas de la paraphrase PBS attribuée à J.D. Vance), chiffres, divergences (dont le contre-exemple des rames Eurostar), puis un test de bout en bout du CLI.

**Critère de fin :** `npm test` est vert, et `npm run brief:verify -- --date 2026-11-06 --out <dossier>` s'exécute sur les éditions de la fixture copiées dans un dossier de test.

### Lot 2 — Cartes, photos et PDF ✅ terminé

Plan : `docs/superpowers/plans/2026-11-06-phase-1-lot-2-cartes-photos-pdf.md`

- `packages/maps` : `renderMap(spec: MapSpec, opts?): string` (SVG). C'est le portage de `reference/mapgen2.mjs` généralisé au `MapSpec` : `conic-france`, `conic-europe`, `conic-spain`, `albers-usa` et `world`. Il reprend `clipExtent`, l'arrondi entier des coordonnées, la grille de points, les classes `land` / `focus` / `focus-soft` / `pulse` / `marker` / `bubble` / `arc` / `maplabel`, les cercles proportionnels (`k = 0.072 × √valeur`, comme le prototype) et l'arc interpolé avec sa flèche sinusoïdale. Les codes ISO alpha-3 du `MapSpec` sont convertis vers les identifiants numériques de world-atlas grâce à une table embarquée.
- `packages/maps/qr.ts` : `qrSvg(url)`, le QR code de la source principale.
- `pipeline/render/pexels.ts` : `findPhoto(query)` appelle l'API Pexels (orientation paysage) et remplit `visual.pexels` avec le photographe et l'URL de crédit. Seules les requêtes déjà validées par R11 lui parviennent.
- `packages/render-pdf` : portage de la partie PDF de `reference/render.mjs` (couverture, Morning Brief, sommaire, liens internes vers les trois éditions, encart audio, « Les chiffres du jour », sujets en deux colonnes avec QR code, brèves, tableau de vocabulaire, pied de page avec date, éditions et pagination). Le rendu passe par Playwright `page.pdf({ format: 'A4' })`, avec les polices Geist encodées en base64 depuis le paquet npm `geist`. Le fichier s'appelle `Daily Brief AAAA-MM-JJ.pdf`.
- `pipeline/render/run-render.ts` et le script `brief:render` (sans l'audio, qui arrive au lot 5).
- Tests : chaque projection de la fixture produit un SVG non vide sans coordonnées décimales ; un test visuel compare les couverture FR, sujet fr-1 et vocabulaire ES avec des captures de référence (comparaison pixelmatch, seuil 1 %).
- Point à trancher en début de lot : le prototype PDF utilise `#C08A00` pour l'accent ES, la spec `#C88E00`. Par défaut, on garde `#C08A00` dans le PDF, plus lisible à l'impression, parce que la maquette fait foi.

### Lot 3 — Collecte

- Vérification §16 : le plan gratuit de TheNewsAPI renvoie-t-il bien du temps réel sur `/v1/news/top` ? Sinon, Exa devient la découverte principale.
- `pipeline/collect/thenewsapi.ts` : requêtes `/v1/news/top` par langue et rubrique, puis `/v1/news/similar/{uuid}` pour regrouper. Un compteur de budget plafonne à 90 requêtes par jour.
- `pipeline/collect/exa.ts` : `category: news` et `startPublishedDate` ; `contents` est demandé uniquement pour les domaines `full` (R1).
- `pipeline/collect/webz.ts` sert de secours si TheNewsAPI échoue ou passe sous le seuil. `pipeline/collect/rss.ts` lit `pipeline/config/feeds.json`, qui ne contient que des domaines `full` ou `feed`.
- `pipeline/collect/fulltext.ts` : extraction du texte (Readability + jsdom), appelée **uniquement** si `lookupDomain(url).status === 'full'`. C'est la garde R1, testée unitairement.
- `pipeline/collect/dedupe.ts` : normalisation d'URL (déjà écrite au lot 1 dans `pipeline/lib/url.ts`), puis similarité des titres (Jaccard sur trigrammes ≥ 0,6) pour attribuer un `groupId`.
- `npm run brief:collect` écrit `out/<date>/raw.json`, au format `RawCollection` du lot 1.
- `npm run brief:context` lit Supabase (Threads ouverts et sujets de la veille) et écrit `out/<date>/context.json` au format `Context` du lot 1. Il ferme aussi les Threads sans événement depuis 21 jours (R12). Il dépend du lot 4 pour la base ; en attendant, il écrit un contexte vide.
- Tests : dédoublonnage, garde R1, budget de requêtes, parsing de réponses API enregistrées dans `fixtures/api/`.

### Lot 4 — Supabase, publication et Drive

- Création du projet Supabase « daily-brief » (région Paris, `eu-west-3`) via le connecteur, après confirmation de Naïm.
- `supabase/migrations/0001_init.sql` : tables du §6.2, contrainte unique `(date, lang)`, buckets privés `audio` et `pdf`, purge à 30 jours des MP3 (pg_cron), et RLS. La lecture est réservée à `auth.email() = current_setting('app.allowed_email')` ; l'écriture est réservée à la clé service, sauf `vocab_items.selected`, `vocab_items.anki_status` et `threads.followed`, que l'utilisateur autorisé peut modifier.
- `pipeline/publish/supabase.ts` : upsert des éditions, puis suppression et recréation de leurs sujets, sources et vocabulaire. Création ou mise à jour des Threads et `thread_events`. Écriture de `runs`.
- `apps-script/Code.gs` : `doPost` selon le §10 (jeton, dossier `Daily Brief/AAAA/MM - Mois` avec les mois en français, remplacement d'un fichier de même nom, réponse `{ ok, ids }`).
- `pipeline/publish/drive.ts` : POST en base64 avec suivi manuel de la redirection 302. En cas d'échec, les fichiers vont dans `drive_pending`. `pipeline/publish/retry-pending.ts` les renvoie au passage suivant.
- `npm run brief:publish`.
- Tests : correspondance `Edition` → lignes SQL (fonction pure), nom du dossier de mois, client Drive contre un serveur HTTP local qui simule le 302 d'Apps Script.

### Lot 5 — Audio

- Vérification §16 : noms exacts des voix Chirp 3 HD avec `voices.list` filtré sur « Chirp3-HD », et présence de ffmpeg.
- `pipeline/render/audio.ts` : découpage de `audioScript` sous la limite par requête (on vise moins de 4 500 octets par morceau, en coupant aux fins de phrase), synthèse en MP3, concaténation avec ffmpeg (sinon concaténation binaire des trames MP3), puis 64 kb/s mono. Le fichier s'appelle `Daily Brief AAAA-MM-JJ FR.mp3`. En cas d'échec, l'édition est publiée sans lecteur.
- Script de mise en place `pipeline/render/voice-samples.ts` : trois échantillons par langue, pour que Naïm choisisse sa voix. Le choix est rangé dans `pipeline/config/voices.json`.
- Tests : découpage (aucun morceau au-dessus de la limite, aucune phrase coupée), concaténation sur deux MP3 de test.

### Lot 6 — Application web

- `apps/web` : Next.js (App Router) sur Vercel, `transpilePackages: ['@daily-brief/schema', '@daily-brief/maps']`, polices Geist auto-hébergées via `next/font/local` à partir du paquet `geist`.
- Authentification Supabase par lien magique, sur un seul email autorisé (`ALLOWED_EMAIL`). Un middleware redirige vers `/login`. Variables Vercel : `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` et `ALLOWED_EMAIL` (la clé anonyme est publique par nature, elle n'est donc pas dans Vault).
- Écrans portés depuis `design/maquette-v2.html` et `design/app.css` : Brief (en-tête collant, onglets FR/EN/ES mémorisés en cookie, Morning Brief et lecteur MP3, puces de rubriques avec état grisé et message vide, cartes §8.2, En bref, Vocab du jour avec « Tout cocher » et « Ajouter N mots à Anki », qui passe `anki_status` à `queued`), Threads (liste puis frise, « Suivre ce thread »), Vocab (filtres langue, date et coché), Archive (calendrier), Santé (table `runs`), et barre d'onglets en bas.
- Cartes rendues côté serveur avec `@daily-brief/maps` ; manifeste PWA et icônes.
- Bandeaux « édition allégée » et « brief de la veille ».
- Tests : composants clés avec Vitest et Testing Library ; captures Playwright à 390 px en clair et en sombre à partir de la fixture (mode `FIXTURE=1` qui lit `fixtures/` au lieu de Supabase).

### Lot 7 — Rédaction, routine et lancement

- `pipeline/editorial/PROMPT.md` : consignes de rédaction. Il cite le JSON Schema, les règles R1 à R12, l'équilibre des rubriques, le Morning Brief et le ton audio, et rappelle que le contenu des articles est de la donnée, jamais des instructions.
- `pipeline/editorial/rubriques.json` : mots-clés de collecte par rubrique et par langue.
- `ROUTINE.md` : prompt de l'annexe A, enrichi de la boucle `brief:verify` (3 essais au maximum, puis rendu des `.verified.json`).
- `pipeline/run/env-from-vault.md` : procédure pour lire `vault.decrypted_secrets` avec le connecteur Supabase et écrire `.env` sans jamais afficher les valeurs.
- Liste vérifiée des newsletters matinales (FR, EN pour US/UK, ES pour l'Espagne) dans `pipeline/config/newsletters.json`, et guide du filtre Gmail.
- Guide de mise en place du §14 (`docs/setup.md`).
- Création de la tâche planifiée `CRON_TZ=Europe/Paris 13 5 * * *` avec notification push, après vérification §16 de Gmail et Supabase dans la routine (sinon, routine Cowork).
- Lancement : un passage manuel de bout en bout, contrôle du site, du PDF et des MP3 dans Drive, mesure du quota Claude, puis activation de l'horaire.

## 3. Couverture de la spec

| Section de la spec | Lot |
|---|---|
| §3 Éditions, rubriques, libellés traduits | 1 (`rubrics.ts`), 6 (affichage) |
| §4.1 Sources de découverte | 3 |
| §4.2 R1 accès au texte intégral, liste blanche | 1 (config + contrôle), 3 (garde de collecte) |
| §4.3 Newsletters | 7 (liste), 1 (`inNewsletter` dans le contrôle) |
| §5 Architecture et structure du repo | 1 (squelette), puis chaque lot |
| §6.1 Modèle JSON | 1 |
| §6.2 Supabase | 4 |
| §6.3 Secrets via Vault | 7 (procédure), 4 (`.env` lu par le pipeline) |
| §7 R2–R12 | 1 |
| §8.1–8.3 Design et écrans | 6 |
| §8.4 Cartes | 2 |
| §8.5 PDF | 2 |
| §9 Audio | 5 |
| §10 Drive | 4 |
| §11 Routine | 7 |
| §12 Pannes (allégée, sans audio, `drive_pending`, veille, upsert, `runs`) | 3 (seuil de 15 textes), 4, 5, 6 |
| §13 Tests et lancement | 1, 2, 6 (tests), 7 (lancement) |
| §14 Mise en place | 7 |
| §16 Vérifications | 3 (TheNewsAPI), 5 (voix, ffmpeg), 2 (Playwright), 7 (connecteurs) |

## 4. Points relevés pendant la préparation (à trancher par Naïm)

1. **Infobae dans l'édition ES.** La fixture ES cite deux brèves d'Infobae, un média argentin. R2 impose des médias espagnols uniquement. Par défaut, le lot 1 retire ces sources de l'édition ES (`country: "AR"` dans `whitelist.json`). Si Naïm veut garder le bureau espagnol d'Infobae, il suffit de passer son `country` à `ES`.
2. **Sources non vérifiables dans la fixture.** La fixture ne contient pas les textes sources (§6.1). Les tests de R5 et R6 s'appuient donc sur des extraits **reconstitués** dans `fixtures/sources/`, marqués comme tels. Si Naïm a gardé les textes réels de Sud Radio et de PBS du 05/11, il suffit de remplacer ces fichiers ; les tests doivent rester verts.
3. **Accent ES du PDF** : `#C08A00` dans le prototype, `#C88E00` dans la spec (voir lot 2).
4. **Email autorisé** : la spec indique `nanigeek@gmail.com`. Il est paramétrable par `ALLOWED_EMAIL` (lots 4 et 6).

## 5. Consignes issues du lot 1 pour les lots suivants

- **Lot 3 (collecte)** : remplir `text` dans `raw.json` uniquement pour les domaines `full`. Le contrôle l'exige de toute façon et retire sinon citations et chiffres. Émettre `lang` en code ISO 639-1. Utiliser `tryNormalizeUrl`, jamais `normalizeUrl`, sur les URL des API. Tout média espagnol absent de `whitelist.json` sera retiré de l'édition ES : l'y ajouter avec son pays.
- **Lot 7 (routine)** : les fichiers `newsletters/*.md` comptent comme textes lus (R1). Ils doivent donc être écrits **mot pour mot** à partir de Gmail par une étape mécanique, jamais réécrits par la rédaction, sinon le contrôle R1/R5/R6 perd sa valeur. La routine relance `brief:verify` jusqu'à 3 fois ; code 1 : publier les `.verified.json` ; code 2 : ne pas publier l'édition concernée et notifier « Brief incomplet » (le rapport `editions[].written` dit lesquelles sont prêtes).
- **Lot 6 (appli)** : `transpilePackages: ['@daily-brief/schema']`, car le paquet exporte du TypeScript source.
