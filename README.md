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
npm run brief:context -- --date AAAA-MM-JJ [--out out]
npm run brief:collect -- --date AAAA-MM-JJ [--out out]
npm run check:thenewsapi   # vérification §16 : TheNewsAPI est-elle en temps réel ?
npm run brief:verify -- --date AAAA-MM-JJ [--out out]
npm run brief:render -- --date AAAA-MM-JJ [--out out]
npm run maps:preview   # aperçu des cartes de la fixture (out/maps-preview.html)
```

`brief:context` ferme les Threads sans événement depuis 21 jours (R12), puis écrit `out/<date>/context.json` (Threads ouverts et sujets de la veille) et `context-report.json`. Tant que le store Supabase n'existe pas (lot 4), il écrit un contexte vide avec un avertissement. Une erreur ou un délai dépassé du store donne le code 2, sans `context.json`.

`brief:collect` interroge, chacune indépendamment, la découverte principale (TheNewsAPI, ou Exa selon `primary` dans `pipeline/config/collect.json`), Exa, les flux de `pipeline/config/feeds.json` et, en secours, Webz.io. Il dédoublonne les articles, ne télécharge le texte intégral que pour les domaines `full` de la liste blanche (R1), puis écrit `out/<date>/raw.json` et `collect-report.json` : requêtes par source, budget TheNewsAPI, erreurs sans secret et textes lus par langue, avec `light: true` sous 15 textes (édition allégée, §12). Les clés `THENEWSAPI_KEY`, `EXA_API_KEY` et `WEBZ_TOKEN` viennent de l'environnement ou de `.env` ; sans clé, la source est ignorée avec un avertissement. Le plafond de 90 requêtes TheNewsAPI par jour est suivi dans `out/thenewsapi-usage.json`. Ce registre est `<out>/thenewsapi-usage.json` ; il compte par jour UTC et il est écrit à chaque requête. Un fichier illisible daté d'un jour UTC antérieur remet le compte à zéro avec un avertissement ; illisible le même jour, il rend TheNewsAPI épuisé jusqu'à sa suppression. Code de sortie : 0 si au moins un article est collecté, 2 sinon.

`check:thenewsapi` (vérification §16) appelle une fois `/v1/news/top` par langue avec `THENEWSAPI_KEY` et affiche l'âge de l'article le plus récent. Si une langue dépasse 2 h, il conseille de passer `"primary": "exa"` dans `pipeline/config/collect.json`. Code 0 : temps réel ; 1 : passer à Exa ; 2 : vérification impossible. Il consomme 3 requêtes, hors du budget de 90.

`brief:verify` contrôle `out/<date>/{fr,en,es}.json` selon les règles R1 à R12 de la spec. Il écrit `{lang}.verified.json` (conforme aux règles R1 à R12 détectables automatiquement) et `verify-report.json`. Code de sortie : 0 si propre, 1 si des corrections ont été appliquées, 2 en cas d’erreur : édition invalide ou absente, fichier d’entrée illisible, ou date incorrecte (l’édition doit alors être corrigée avant publication).

`brief:render` lit les `{lang}.verified.json` du jour et complète les photos Pexels si `PEXELS_API_KEY` est définie (variable d'environnement ou `.env`). Il écrit `{lang}.final.json`, `Daily Brief <date>.pdf` (A4, FR puis EN puis ES) et `render-report.json`. Une édition absente est omise ; sans aucune édition, il n'y a pas de PDF et le code de sortie vaut 2. Le code 2 peut accompagner des `{lang}.final.json` valides (PDF impossible) : la publication s'appuie sur `finals` du rapport. Le test visuel du PDF compare trois captures à `packages/render-pdf/test/__screens__/`. Après un changement voulu du gabarit, régénère-les avec `UPDATE_VISUAL=1 npx vitest run packages/render-pdf/test/visual.test.ts` et vérifie les images avant de les commiter.

`brief:render` imprime avec Chromium (Playwright 1.63.0) : il est préinstallé via `PLAYWRIGHT_BROWSERS_PATH` ; sinon, lance `npx playwright install chromium`. Le code 0 peut s'accompagner d'entrées de niveau `error` dans le rapport (une édition invalide est omise et le PDF contient les autres). Le fichier facultatif `audio.json`, écrit par le lot 5, a la forme `{ "fr": { "duration": "3:24" }, "en": { "duration": "3:10" }, "es": { "duration": "3:31" } }` ; chaque langue est facultative et les autres clés sont ignorées.

`context.json`, `raw.json` et `newsletters/` sont facultatifs. Sans textes sources, toutes les citations et tous les chiffres sont retirés.

Plans d'implémentation : `docs/superpowers/plans/`.
