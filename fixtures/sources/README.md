# Textes sources de test (R5, R6)

Ces extraits sont **reconstitués** à partir de la fixture du 06/11/2026 pour tester les contrôles de citations et de chiffres. Ce ne sont pas les articles originaux. Si les textes réels sont disponibles, remplace le contenu des fichiers sans changer leur nom : les tests doivent rester verts.

- `sudradio-grogne-sociale.txt` : la dépêche AFP reprise par Sud Radio (sujet `2026-11-06-fr-1`). Elle utilise volontairement des apostrophes et guillemets droits, pour tester la normalisation face aux guillemets typographiques de la fixture.
- `pbs-vance.txt` : article PBS où un journaliste **paraphrase** J.D. Vance. La paraphrase présentée comme une citation doit être rejetée (§13 de la spec).

`index.json` associe chaque URL à son fichier, au format `{ url, file }`.
