# Diversité des médias et photos pertinentes (20/11/2026)

**Objectif :** corriger les deux défauts relevés sur le passage réel du 20/11/2026 : trop peu de médias différents en FR et en ES, et des photos Wikimedia Commons hors sujet (pancartes électorales de l'Iowa pour un débat Sánchez–Feijóo).

**Périmètre :** `pipeline/**`, `pipeline/config/**`, `PROMPT.md`, `ROUTINE.md`, la spec (notes datées de R3 et R11), `fixtures/api/` (nouvelles réponses enregistrées), une ligne de `package.json` (script `brief:collect`). Aucun changement de `packages/schema` : l'appli web n'est pas touchée.

## Constat du 20/11/2026 (table `sources`)

- FR, lus en entier : franceinfo 7 + franceinfo.fr 2, Euronews 5, Sud Radio 2 + sudradio.fr 1, 20minutes.fr 1. Cités sans être lus : rfi.fr 4, france24.com 3, lalibre.be 2, et quatre autres.
- ES, lus en entier : elDiario.es 5 (+ 1 non lu) + eldiario.es 3, 20minutos.es 5, europapress.es 5, El Salto 5, elconfidencial.com 2, Alicante Plaza 2.
- EN : theguardian.com 9, bbc.co.uk 5 + bbc.com 2, PBS NewsHour 4 + pbs.org 1, NPR 4, Al Jazeera 2 + aljazeera.com 1, Euronews / euronews.com.
- Collecte : FR 205 articles (139 textes), ES 148 (125), EN 234 (126). Webz : HTTP 401 (nouvelle clé probablement fausse).

Le même média apparaît sous deux noms (« elDiario.es » et « eldiario.es »), et parfois sous deux domaines (bbc.com et bbc.co.uk, franceinfo.fr et francetvinfo.fr) : l'affichage est brouillé, R3 compte deux médias là où il n'y en a qu'un, et la notification « N sujets, M médias » compte des noms.

## Tâches

- [x] **1. Identité normalisée des médias.** `whitelist.json` : `outlet` (nom affiché) et `sameAs` (domaine canonique du même média). `outletOf(wl, url)` donne `{ key, name, known }` ; la clé est le domaine canonique, hors liste le domaine enregistrable. `sameAs` n'agit jamais sur le statut R1 (bbci.co.uk reste `feed`). Schéma : `sameAs` doit désigner une entrée canonique de la liste, pas de domaine en double.
- [x] **2. Collecte.** `makeArticle` écrit le nom de la liste blanche (sinon celui de la source, sinon le domaine) : `raw.json` n'a plus qu'un nom par média.
- [x] **3. Contrôle (R3).** `storyOutletCount` et `outletShares` comptent par clé ; le champ `outlet` des sources est réécrit avec le nom canonique (complément « · AFP » gardé) ; bilan par édition dans `verify-report.json` (`editions[].diversity` : sources, médias, trois médias en tête, médias au-delà de 30 %, sujets à un seul média) et une ligne par édition dans la sortie de `brief:verify`.
- [x] **4. Notification.** « M médias » compte les clés normalisées.
- [x] **5. Plus de médias lisibles en entier**, essai public (voir ci-dessous) ; flux ajoutés à `feeds.json`, domaines ajoutés aux recherches Exa ; `fulltext.maxFetches` de 180 à 240 (huit flux de plus).
- [x] **6. Proxy.** `brief:collect` passe par le proxy HTTPS du conteneur (`NODE_USE_ENV_PROXY=1`).
- [x] **7. Rapport de collecte.** Une clé refusée (401/403) ou un quota épuisé (402) est nommé en tête des erreurs : « WEBZ_TOKEN refusée par Webz (HTTP 401) : clé invalide, expirée ou mal copiée, à corriger dans Vault ». La notification reprend les deux premières erreurs : ce message en est la première.
- [x] **8. Photos pertinentes** (`pipeline/render/relevance.ts`, `pipeline/lib/places.ts`), voir l'algorithme ci-dessous.
- [x] **9. R11 au contrôle.** Avertissement pour une requête photo qui ne nomme aucun lieu.
- [x] **10. Consignes.** `PROMPT.md` (R3 et R11), `ROUTINE.md` (avertissement du proxy, clé refusée), notes datées de la spec.

## Essai des médias (20/11/2026)

Méthode : pour chaque candidat, au plus deux requêtes publiques avec l'agent du dépôt (`Mozilla/5.0 (compatible; DailyBrief/1.0)`, sans donnée personnelle) : le flux (`fetchFeed`), puis un article du flux lu par `fetchFullText` (Readability, garde R1 « isAccessibleForFree false », 400 caractères au moins). Une quarantaine de candidats, environ 60 requêtes en tout.

**Découverte :** la plupart des « 403 » viennent du conteneur, pas des médias. Le `fetch` de Node sort directement, sans le proxy HTTPS, et le filtre de sortie répond `403 Blocked by egress policy` (Le Monde, France 24, RFI, TF1info, BFMTV…). Avec le proxy (`NODE_USE_ENV_PROXY=1`, comme curl), ces flux répondent 200. Les refus du 19/11/2026 (France 24, RFI, Ouest-France « 403 à notre agent ») étaient donc des artefacts.

| Média | Flux | Article | Verdict |
|---|---|---|---|
| France 24 | `/fr/rss`, 24 articles | 3 186 caractères, pas de marque payante | **full** |
| RFI | `/fr/rss`, 23 articles | 2 975, `isAccessibleForFree: true` | **full** |
| Public Sénat | `/feed`, 60 articles | 2 637 | **full** (l'URL du 19/11 renvoyait 404) |
| TF1info | `/feeds/rss-une.xml`, 100 articles | 7 775, `isAccessibleForFree: true` | **full** |
| Basta! | `spip.php?page=backend`, 11 articles | 23 818, média gratuit | **full** |
| La Vanguardia | `/rss/home.xml`, 153 articles | 4 338, `isAccessibleForFree: true` | **full** (paywall partiel : les pages marquées `false` sont refusées) |
| Newtral | `/feed/`, 10 articles | 4 068 | **full** |
| Cadena SER | `arc/outboundfeeds/rss`, 100 articles | 1 338 | **full** |
| Le Monde | 16 articles | 402 | meta |
| Libération | 50 articles | 403 sur l'article | meta |
| La Croix | flux 403 | — | meta |
| Le Parisien, L'Humanité, Ouest-France | flux lu | article déclaré payant | meta |
| BFMTV | 30 articles | 216 caractères (vidéo) | meta |
| Reporterre | 60 articles | 403 sur l'article | meta |
| El País | 156 articles | 403 sur l'article | meta |
| El Mundo, ABC | flux lu | article déclaré payant | meta |
| infoLibre | 54 articles | 633 caractères seulement (extrait probable) | meta |
| Público | flux `/rss/` 404 | — | meta |
| El Periódico | flux 406 | — | meta |
| RTVE | flux figé en 2022 | — | meta |

Médias full distincts (flux ou Exa, identité normalisée) : FR 6 → 11, ES 7 → 10.

## Algorithme de pertinence des photos

Pour chaque candidate qui passe déjà le format, le cadrage et la licence, dans l'ordre :

1. **Personne identifiable** : catégorie « Politicians », « Portraits »…, ou titre identique à une catégorie et de la forme d'un nom propre de personne → refusée (R11).
2. **Lieux d'ancrage** : chaque lieu nommé par la requête (pays, adjectif de pays, région, ville, État américain ; répertoire `pipeline/lib/places.ts`) doit apparaître dans le titre, les catégories ou la description ; un pays est satisfait par l'une de ses villes ou régions.
3. **Géographie** : pays attendus = ceux de la requête, sinon celui de l'édition (ES : Espagne ; EN : États-Unis, Royaume-Uni ; FR : aucun). Un autre lieu dans le titre ou les catégories → refusée ; dans la description → refusée sauf si la photo nomme aussi un pays attendu. Sans pays attendu (FR sans lieu), toute photo située est refusée.
4. **Schéma, carte ou logo** dans le titre ou les catégories → refusée.
5. **Pertinence** : au moins un mot significatif de la requête (mots vides anglais, espagnols, français retirés, pluriels ramenés au singulier) ou un lieu d'ancrage dans le titre ou les catégories, et au moins la moitié des mots de la requête, description comprise.

Score des photos retenues : mots dans le titre ou les catégories ×3, dans la description ×1, lieux d'ancrage dans le titre ou les catégories ×2, vue neutre (building, palace, parliament, flag, skyline…) +1, scène d'événement (rally, campaign, protest, signs…) −2. Puis JPEG avant PNG, puis l'ordre du moteur. Sans candidate retenue : **pas de photo** (aplat), avertissement « aucune photo libre et pertinente ». La recherche demande 20 résultats au lieu de 10 et les métadonnées `ObjectName`, `ImageDescription` et `Categories`.

**Cas de l'Iowa** (réponse réelle enregistrée, `fixtures/api/commons-debate-iowa.json`) : `television studio cameras debate` ne renvoie qu'un fichier, « 10.26.2010 -scenes from a rally- », catégorie « Roxanne Conlin Senate campaign, 2010 », description « … The debate was aired by WHO Radio and broadcast from their studios by Iowa Public Television… ».

- Avant : `pickPhoto` prenait le premier JPEG libre, donc ces pancartes.
- Après : refusée dans les trois éditions. ES : « lieu hors du pays attendu dans la description : iowa » ; FR : même motif (requête sans lieu, photo située) ; avec une requête qui nomme l'Espagne : « lieu de la requête absent de la photo : spain ». Sans la description, elle tomberait encore sur « aucun mot de la requête dans le titre ni les catégories ».
- `spain parliament building madrid` (`fixtures/api/commons-spain-parliament.json`) retient « Spanish Parliament building » (score 9) ; les portraits d'élus, l'ambassade d'Irlande, les cartes de localisation et la stéréophotographie du Rijksmuseum (catégorie Amsterdam) sont écartés.

## Vérifications

- `npm test` : 117 fichiers, 1193 tests, tous verts (avec le travail en cours sur `apps/web`). `npm run typecheck` : propre.
- Pas de `web:build` : `packages/schema` n'a pas changé.
- Aucun appel aux API payantes, à Supabase ni à Drive ; quatre appels à l'API de Commons pour enregistrer les réponses (dont un refusé pour excès de requêtes, par curl via le proxy partagé).

## Écarts

- **`package.json`, hors du périmètre prévu** : une ligne (`brief:collect` préfixé de `NODE_USE_ENV_PROXY=1`). Sans elle, France 24, RFI et TF1info, passés en full, resteraient bloqués par le filtre de sortie du conteneur. Sans variable `HTTPS_PROXY`, rien ne change. Node affiche un avertissement « EnvHttpProxyAgent is experimental ».
- **Requêtes photo en minuscules** : la consigne demandait « Congreso de los Diputados Madrid ». Le contrôle R11 refuse toute majuscule (soupçon de nom propre de personne) ; je l'ai gardé et les exemples de `PROMPT.md` sont en minuscules et en anglais (« madrid congress of deputies »), la langue dans laquelle Commons décrit et catégorise.
- **Pas de personnalité publique** : la spec R11 interdit « nom de personne » et « personnalité publique ». « Pedro Sánchez » n'est donc pas une requête permise ; `PROMPT.md` le dit, et le rendu écarte aussi les portraits trouvés par une requête de lieu.
- **Repli sur la carte** : un sujet `photo` n'a pas de carte (le visuel est l'un ou l'autre) ; sans photo pertinente, il garde l'aplat. La consigne pousse la rédaction à choisir `type: map` pour les élections, conflits et sujets géographiques.
- **Faux positifs acceptés** : un monument au nom propre identique à sa catégorie (« Eiffel Tower ») est refusé comme un portrait ; un fichier sans catégorie ni description pertinente aussi (le TGV de la réponse du 19/11, enregistrée sans catégories, ne passe plus pour « high-speed train »). Une photo manquante vaut mieux qu'une photo trompeuse.
- **Répertoire de lieux court et sans noms ambigus** (georgia, nevada, colorado, montana, maine, jordan, turkey exclus). Un lieu absent du répertoire n'ancre rien et ne fait rien refuser.
- **Bilan R3 sans correction** : il informe (rapport, sortie de `brief:verify`) et garde les avertissements R3 existants ; il ne change pas le code de sortie.
- **Noms réécrits sans entrée de rapport** : la réécriture du champ `outlet` par `brief:verify` est silencieuse, pour ne pas forcer une relance (code 1) à chaque passage.
- **`fulltext.maxFetches`** porté de 180 à 240 pour les huit flux de plus ; l'échéance de la phase (240 s) est inchangée.
- **Fixtures d'essai** : `pipeline/test/render/run-render.test.ts` ajoute des catégories à la réponse du 19/11 pour que le TGV reste retenu ; la répétition (`rehearsal.test.ts`) prend lemonde.fr au lieu de publicsenat.fr, devenu full, pour le cas « lu par la newsletter ».

## À surveiller au prochain passage

- Le proxy : la collecte passe désormais par lui ; vérifier dans `collect-report.json` que TheNewsAPI, Exa et les flux répondent comme avant, et que France 24, RFI, TF1info, Public Sénat donnent des textes.
- La part de franceinfo en FR et la ligne « R3 FR : … » de `brief:verify`.
- Le nombre de sujets sans photo (avertissements « aucune photo libre et pertinente ») : s'il est élevé, la rédaction doit nommer le lieu ou passer à la carte.
- Webz : corriger `WEBZ_TOKEN` dans Vault ; le message l'indique désormais en tête.
- La Vanguardia (paywall partiel) : surveiller les refus « article payant » dans `collect-report.json`.
