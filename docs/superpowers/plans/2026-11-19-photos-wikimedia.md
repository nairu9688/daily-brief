# Photos — Wikimedia Commons à la place de Pexels : plan d'implémentation

> **Pour les agents :** sous-skill requis : superpowers:executing-plans, tâche par tâche, en commençant chaque tâche par ses tests. Les étapes utilisent des cases à cocher (`- [ ]`) pour le suivi.

**Objectif :** illustrer les sujets `{ type: 'photo', query }` par une photo libre de **Wikimedia Commons**, créditée « Photo : <auteur> — <licence> · Wikimedia Commons ». Pexels a suspendu la délivrance de clés d'API : le projet ne peut pas en obtenir. Commons ne demande aucune clé, ses licences sont libres, mais l'auteur et la licence doivent être affichés (spec R11, §8.5).

**Architecture :** le découpage du lot 2 est gardé.
- `packages/schema` : `visual.pexels` devient `visual.photo`, un objet indépendant du fournisseur (`provider: 'wikimedia'`). Le schéma porte lui-même les hôtes de confiance et la liste des licences admises.
- `pipeline/render/commons.ts` remplace `pexels.ts` : une recherche dans l'API de Commons par requête, le tri des résultats, puis la photo validée par le schéma.
- `brief:render`, `brief:verify`, le PDF et l'appli lisent `visual.photo`. Le tout passe par le `fetch` injecté, donc les tests n'appellent jamais le réseau.

**Spec :** `docs/specs/2026-11-06-daily-brief-design.md` (R11, §8.2, §8.5, §12). **Lot d'origine :** `docs/superpowers/plans/2026-11-06-phase-1-lot-2-cartes-photos-pdf.md` (tâches 7 et 8, et ses écarts : leçon SSRF).

---

## Contexte pour l'exécutant

- **Fichiers à ne pas modifier :** `fixtures/brief-2026-11-06.json`, `design/` et `reference/`. Le `.env` du dépôt contient de vraies clés : ne jamais le lire ni l'afficher.
- **Réseau.** Aucun test n'appelle le réseau. Un seul appel manuel à `https://commons.wikimedia.org/w/api.php` est permis, pour enregistrer la réponse servant de fixture (`fixtures/api/commons-search.json`) et vérifier la forme des champs.
- **Leçon SSRF du lot 2.** Une URL `pexels.src` écrite par le modèle avait été téléchargée par le rendu. La règle reste la même : l'URL d'image ne vient **que** de la réponse de l'API, jamais du modèle. La seule entrée du modèle est le texte de `query`.

## Conception

### Recherche

`GET https://commons.wikimedia.org/w/api.php` avec :

| Paramètre | Valeur | Raison |
|---|---|---|
| `action`, `format`, `formatversion` | `query`, `json`, `2` | `pages` en tableau, booléens natifs |
| `generator`, `gsrsearch`, `gsrnamespace`, `gsrlimit` | `search`, `<query> filetype:bitmap`, `6`, `10` | Fichiers seulement (espace 6), images matricielles seulement |
| `prop`, `iiprop`, `iiurlwidth` | `imageinfo`, `url\|extmetadata\|mime\|size`, `1600` | Vignette de 1600 px au lieu de l'original (souvent plus de 3 Mo) |
| `iiextmetadatafilter`, `iiextmetadatalanguage` | `Artist\|LicenseShortName\|LicenseUrl\|License\|Restrictions\|NonFree\|AttributionRequired`, `en` | Réponse courte (environ 20 Ko pour 10 fichiers) |

En-têtes : `User-Agent: DailyBrief/1.0 (personal news digest)` et `Api-User-Agent` identique, comme l'exige la politique de Wikimedia. Ils sont génériques : jamais de nom ni d'adresse. Le même agent est envoyé au téléchargement des images. Le corps est lu par `readCapped` (1 Mo au plus) avec un délai de 10 s. Une erreur HTTP lève `HttpError`, dont le message ne contient que l'URL masquée.

**Tri des résultats**, dans l'ordre du moteur (`index`) :
1. type `image/jpeg`, `image/png` ou `image/webp` (ni svg, ni gif, ni tiff) ;
2. paysage raisonnable : largeur d'origine d'au moins 1000 px, rapport largeur / hauteur entre 1,2 et 2,2 (ni portrait, ni carré, ni panorama ou « line scan ») ;
3. licence admise, d'après `LicenseShortName` : `CC0`, `Public domain`, `CC BY x.y` et `CC BY-SA x.y` (avec ou sans version ou suffixe de pays). Tout le reste est refusé : NC, ND, GFDL seule, licence inconnue, usage loyal, `NonFree` ;
4. pas de restriction `personality` (personne identifiable, R11) ;
5. auteur non vide après nettoyage ;
6. URL d'image, de page et de licence conformes au schéma (ci-dessous).

Le premier JPEG retenu l'emporte, sinon le premier PNG ou WebP : une vignette PNG d'une photo dépasse vite la limite de 3 Mo du téléchargement.

**Auteur.** `Artist` est du HTML (`<a href="//commons…">Kabelleger</a> / David Gubler (…)`) : balises retirées, entités décodées, caractères de contrôle et espaces multiples ramenés à un espace, puis tronqué à 80 caractères avec « … ».

### Schéma

```ts
visual: { type: 'photo'; query: string; photo?: Photo }
Photo = { provider: 'wikimedia'; src; width; height; author; license; licenseUrl?; pageUrl }
```

- `src` : https, hôte `upload.wikimedia.org` ou `thumb.wikimedia.org`, sans identifiants ni port, sans paramètres (les `utm_*` de l'API sont retirés).
- `pageUrl` : https sur `commons.wikimedia.org`, chemin `/wiki/File:…`.
- `licenseUrl` : facultatif (le domaine public n'en a souvent pas), https sur `creativecommons.org` (`http://` est réécrit en `https://`).
- `license` : passe le même filtre de licences que la recherche.
- `author` : 1 à 80 caractères.

`isHttpsUrlOn`, `isFreeLicense`, `PHOTO_IMAGE_HOSTS` et `sanitizeVisual` sont exportés par `@daily-brief/schema` : le client, le rendu et l'appli appliquent la même règle.

**Compatibilité.** `VisualSchema` est précédé d'un `z.preprocess` qui retire l'ancien champ `pexels` : un fichier ou une ligne `stories.visual` (jsonb) de l'ancienne forme se lit encore, comme une photo sans image. Aucune migration : aucune clé Pexels n'a jamais été obtenue, donc aucune ligne ne porte de vraie photo Pexels. La fixture `fixtures/brief-2026-11-06.json` n'a pas de photo renseignée : elle passe telle quelle. Le JSON Schema n'expose que la nouvelle forme.

**Photo invalide.** Le schéma refusant désormais un hôte inconnu, une photo invalide rendrait tout le sujet invalide. Elle est donc retirée **avant** l'analyse : par `brief:verify` (toute photo ou ancien `pexels` écrit par la rédaction, avec une correction R11), par `brief:render` (photo pré-remplie invalide, avec un avertissement) et par l'appli (`sanitizeVisual`, le sujet reste affiché avec un aplat).

### Crédit

- **PDF :** `Photo : <a href=pageUrl>auteur</a> — <a href=licenseUrl>licence</a> · Wikimedia Commons` (licence sans lien si pas d'URL).
- **Appli :** même texte, en pastille en bas de la photo ; seul l’auteur est tronqué au besoin et mène à la page du fichier. Sans photo, l'aplat neutre n'affiche plus de crédit (il n'y a rien à créditer).
- Pour CC BY-SA, l'attribution et le lien vers la licence suffisent à notre usage (pas d'œuvre dérivée).

### Appli web

- CSP `img-src 'self' data: https://upload.wikimedia.org https://thumb.wikimedia.org` ; `images.pexels.com` disparaît (la fixture n'en a pas besoin).
- `photoSrc` remplace `pexelsSrc` avec la même règle d'hôtes que le schéma.

### Environnement, répétition, repli

- `PEXELS_API_KEY` disparaît de `env:check`, de `brief:finish`, des docs et de la liste Vault. S'il reste dans un `.env`, `env:check` dit qu'il n'est plus utilisé.
- `brief:render` cherche toujours les photos (pas de clé). L'option `photoLookup: false` coupe la recherche : `brief:finish --dry-run` l'utilise, et ne fait donc toujours aucun appel extérieur.
- Disjoncteur : celui de la collecte (`Breaker`) — 401, 402, 403 (agent refusé), 429 ou délai dépassé coupent Commons pour le reste du passage, avec un seul avertissement ; trois échecs de suite aussi.
- Aucune photo convenable : le sujet garde l'aplat neutre, avec un avertissement, jamais un échec.

## Structure des fichiers

```
packages/schema/src/edition.ts       PhotoSchema, isHttpsUrlOn, isFreeLicense, sanitizeVisual, VisualSchema
packages/schema/edition.schema.json  régénéré
pipeline/render/commons.ts           findCommonsPhoto, pickPhoto, cleanAuthor (remplace pexels.ts)
pipeline/render/photos.ts            fillPhotos → visual.photo
pipeline/render/images.ts            hôtes Wikimedia, agent, readCapped
pipeline/render/run-render.ts        Breaker, photoLookup, retrait des photos invalides
pipeline/verify/verify-edition.ts    retrait des photos écrites par la rédaction
packages/render-pdf/src/html.ts      crédit
apps/web/lib/csp.ts, lib/data/rows.ts, components/StoryCard.tsx, app/globals.css
pipeline/run/{env-check,finish,finish-cli}.ts
fixtures/api/commons-search.json     réponse enregistrée (remplace pexels-search.json)
```

## Tâches

- [x] **1. Schéma.** Tests d'abord : hôtes acceptés et refusés (http, autre hôte, sous-domaine piège, identifiants, port), licences admises et refusées, lecture de l'ancienne forme `pexels`, `sanitizeVisual`. Puis `PhotoSchema` et les aides, `npm run schema:emit`.
- [x] **2. Client Commons.** Enregistrer la réponse (un seul appel réel), puis tests sur la fixture : paramètres et agent, choix de la photo, filtres (portrait, carré, svg, NC, ND, licence inconnue, `personality`, auteur vide), HTML de l'auteur, statut HTTP, corps trop lourd, délai.
- [x] **3. Bascule.** `fillPhotos`, `images.ts`, `runRender` (disjoncteur, `photoLookup`, retrait), `brief:verify`, PDF, appli (CSP, `photoSrc`, carte, CSS), avec leurs tests.
- [x] **4. Environnement.** `env:check`, `brief:finish` (répétition sans recherche), `brief:render` sans `.env`.
- [x] **5. Documentation.** Spec (R11), `PROMPT.md`, `ROUTINE.md`, README, `docs/setup*.md`, `env-from-vault.md`, feuille de route, `fixtures/api/README.md`.
- [x] **6. Vérification finale.** `npm test`, `npm run typecheck`, `npm run web:build`, `npm run web:e2e -- --trace off`, `npm run web:check-bundle` ; regarder les captures régénérées.

## Écarts après exécution

Le plan a été exécuté d'une traite, tests d'abord. **Le dépôt fait foi** ; ce plan reste la trace de la conception. Résultat après la revue : 110 fichiers de test et 1104 tests Vitest (contre 109 et 1069 : `pexels.test.ts` retiré, `commons.test.ts` et `packages/schema/test/photo.test.ts` ajoutés), typage strict propre, `web:build` et `web:check-bundle` propres, 44 tests Playwright réussis et 2 ignorés.

| Zone | Écart par rapport à la demande ou au lot 2 | Raison |
|---|---|---|
| Hôtes d'image | `thumb.wikimedia.org` admis en plus de `upload.wikimedia.org` (schéma, téléchargement, CSP) | L'appel réel montre que `thumburl` est désormais sur `thumb.wikimedia.org` ; seul un original plus étroit que 1600 px reste sur `upload.wikimedia.org`. Les deux hôtes sont à Wikimedia et fixés dans le schéma |
| Image | Original pris tel quel (dimensions d'origine) quand il n'y a pas de vignette plus petite, et seulement s'il pèse au plus 3 Mo ; paramètres `utm_*` retirés de l'URL | L'API renvoie alors l'original avec des `thumbwidth`/`thumbheight` agrandis ; au-delà de 3 Mo il ne serait pas téléchargé |
| Objet `photo` | Ni `query` (déjà dans `visual.query`, qui sert aussi d'`alt`) ni `alt` | Pas de doublon ; la description de Commons est du HTML long |
| Choix | Premier JPEG convenable avant les PNG ou WebP ; rapport largeur / hauteur entre 1,2 et 2,2 ; largeur d'origine d'au moins 1000 px | La réponse réelle contient un « line scan » de 5836 × 1640, un schéma presque carré et des PNG de plus de 3 Mo |
| Licence | Filtre sur `LicenseShortName` ; `NonFree` et la restriction `personality` refusés ; lien de licence gardé seulement sur `creativecommons.org` (`http` réécrit en `https`) | Liste blanche stricte ; R11 (personne identifiable) ; un lien de crédit ne mène jamais ailleurs |
| Disjoncteur | Celui de la collecte (`Breaker`) au lieu du code propre au lot 2 : 403 et 402 coupent aussi, ainsi que trois échecs de suite | Wikimedia répond 403 à un agent refusé ; même règle que les autres clients |
| Lecture bornée | `readCapped` pour la recherche (1 Mo) et les images (3 Mo, en flux) ; le faux `fetch` des tests sert le JSON par `arrayBuffer` | Plus de `res.json()` ni de tampon non borné |
| `brief:verify` | Photo et ancien `pexels` retirés de l'entrée **avant** l'analyse (correction R11), même s'ils sont conformes | Avec des hôtes vérifiés par le schéma, une photo du modèle rendait sinon l'édition entière invalide |
| Appli | Crédit en pastille sombre en bas à gauche (comme la légende), auteur seul tronqué ; l'aplat n'affiche plus « Pexels » | Le badge en haut à droite chevauchait la légende ; la licence et la source doivent rester lisibles ; rien à créditer sans photo |
| Captures | Aucune capture de référence régénérée : aucune ne montre un sujet illustré par une photo | La fixture n'a pas de photo renseignée ; le crédit a été regardé sur une page statique (clair, auteur long) |
| Revue | Licences : versions 1.0, 2.0, 2.5, 3.0 et 4.0 seulement, suffixe de portage jamais `nc`, `nd` ni `sa` (« CC BY » sans version refusé) ; lien de licence CC BY / CC BY-SA **dérivé du nom** (`/licenses/by-sa/2.5/nl/`), jamais pris de `LicenseUrl`, et exigé par le schéma (sinon pas de photo) ; `cleanAuthor` retire les commentaires, lit les attributs entre guillemets, remplace les demi-paires isolées et tronque sans couper un caractère ; URL stockées normalisées, contrôlées sur la chaîne brute (port écrit même `:443`, tabulation, saut de ligne ; ni `?` ni `#` dans `pageUrl`) — d'où `z.string()` plutôt que `z.url()`, qui normalise la chaîne avant tout contrôle (le JSON Schema perd `format: uri` sur ces trois champs), et `.overwrite()` plutôt que `.transform()`, qui garde un type représentable dans le JSON Schema ; images sans redirection (`redirect: 'error'`, URL finale recontrôlée) et signature JPEG / PNG / WebP vérifiée ; `photo` et `pexels` retirés quel que soit le type de visuel ; `title` sur l'auteur tronqué de l'appli | Revue de code du changement |
| `env:check` | `PEXELS_API_KEY` restée dans un `.env` est signalée « plus utilisée …, à retirer de Vault » plutôt que « variable inconnue » | Message utile pendant la transition |

**Non vérifié hors ligne** (à contrôler au premier passage, `docs/setup.md` étape 12) : le téléchargement réel d'une vignette sur `thumb.wikimedia.org` avec l'agent générique (un 403 couperait les photos) ; l'accès réseau de la session de la routine à `commons.wikimedia.org`, `upload.wikimedia.org` et `thumb.wikimedia.org` ; la pertinence des résultats de Commons pour les requêtes du modèle (ce n'est pas une banque d'images : schémas, affiches ou personnes non marquées `personality` restent possibles).
