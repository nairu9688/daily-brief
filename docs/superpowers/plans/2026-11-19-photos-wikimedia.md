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
- **Appli :** même texte, en bas de la photo, sur une ligne tronquée ; l'auteur mène à la page du fichier. Sans photo, l'aplat neutre n'affiche plus de crédit (il n'y a rien à créditer).
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

- [ ] **1. Schéma.** Tests d'abord : hôtes acceptés et refusés (http, autre hôte, sous-domaine piège, identifiants, port), licences admises et refusées, lecture de l'ancienne forme `pexels`, `sanitizeVisual`. Puis `PhotoSchema` et les aides, `npm run schema:emit`.
- [ ] **2. Client Commons.** Enregistrer la réponse (un seul appel réel), puis tests sur la fixture : paramètres et agent, choix de la photo, filtres (portrait, carré, svg, NC, ND, licence inconnue, `personality`, auteur vide), HTML de l'auteur, statut HTTP, corps trop lourd, délai.
- [ ] **3. Bascule.** `fillPhotos`, `images.ts`, `runRender` (disjoncteur, `photoLookup`, retrait), `brief:verify`, PDF, appli (CSP, `photoSrc`, carte, CSS), avec leurs tests.
- [ ] **4. Environnement.** `env:check`, `brief:finish` (répétition sans recherche), `brief:render` sans `.env`.
- [ ] **5. Documentation.** Spec (R11), `PROMPT.md`, `ROUTINE.md`, README, `docs/setup*.md`, `env-from-vault.md`, feuille de route, `fixtures/api/README.md`.
- [ ] **6. Vérification finale.** `npm test`, `npm run typecheck`, `npm run web:build`, `npm run web:e2e -- --trace off`, `npm run web:check-bundle` ; regarder les captures régénérées.

## Écarts après exécution

À compléter à la fin de l'exécution.
