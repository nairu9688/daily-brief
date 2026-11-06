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
