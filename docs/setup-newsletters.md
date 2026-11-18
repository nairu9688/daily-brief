# Mise en place des newsletters (Gmail)

Ce guide abonne la boîte Gmail du Daily Brief aux newsletters matinales et crée le filtre qui les range sous le libellé `Daily Brief` (spec §4.3 et §14, étape 3). Il se suit une fois, en 10 minutes environ. La liste vient de `pipeline/config/newsletters.json`, vérifiée sur des pages publiques le 18/11/2026, sans inscription.

Deux règles :

- **Seules les newsletters actives de `newsletters.json` sont lues.** Un message d'un autre expéditeur, même rangé sous le libellé, est ignoré par `brief:newsletters`.
- **Plafond : 8 par jour** (`maxPerDay`), pour maîtriser le quota Claude. En ajouter une demande d'en désactiver une autre.
- **Heure limite : 05:13.** La routine lit les messages reçus dans les 24 h qui précèdent son passage de 05:13 (heure de Paris). Une newsletter qui arrive après 05:13 est lue le lendemain, avec un jour de retard : ce décalage est accepté. Heures d'envoi connues (`schedule` de `newsletters.json`) : La Quotidienne (Public Sénat) 7 h 30, Kloshletter 7 h, Axios AM vers 6 h à New York, soit midi à Paris ; First Edition, Morning Headlines, La quotidienne (The Conversation) et Al día : « le matin », heure exacte à noter au premier envoi. Les newsletters du matin servent donc surtout au brief du lendemain ; Axios AM, envoyée la veille à midi, est la seule lue le jour même.
- **Confiance dans les messages.** `brief:newsletters` ne garde que les expéditeurs de la liste et contrôle l'en-tête `Authentication-Results` quand la routine l'a enregistré (DMARC). Voir le §3 pour l'activer en mode strict.

## 1. S'abonner

Avec l'adresse de la boîte du Daily Brief (spec : nanigeek@gmail.com), s'inscrire sur chaque page, puis **confirmer chaque inscription** (cliquer le lien de l'e-mail de confirmation, quand il y en a un) avant de créer le filtre du §2 : un e-mail de confirmation archivé par le filtre passerait inaperçu. Les niveaux de confiance : **vérifiée** (nom, éditeur et page d'inscription confirmés), **probable** (newsletter confirmée, détail d'inscription à vérifier), **incertaine** (gratuité ou adresse à confirmer avant de s'abonner).

| Édition | Newsletter | Éditeur | Envoi | Inscription | Confiance |
|---|---|---|---|---|---|
| FR | La Quotidienne | Public Sénat | mardi au samedi, 7 h 30 | <https://www.publicsenat.fr/newsletters> | vérifiée |
| FR | La quotidienne | The Conversation France | quotidienne | <https://theconversation.com/fr/newsletters> | probable |
| EN (UK) | First Edition | The Guardian | lundi au vendredi, matin | <https://www.theguardian.com/email-newsletters> | probable |
| EN (UK) | Morning Headlines | The Independent | lundi au vendredi, matin | <https://www.independent.co.uk/newsletters> | probable |
| EN (US) | Axios AM | Axios | chaque jour, vers midi à Paris | <https://www.axios.com/newsletters/axios-am> | probable |
| ES | Al día | elDiario.es | chaque matin | <https://www.eldiario.es/newsletters/> | probable |
| ES | Kloshletter | Kloshletter | lundi au vendredi, 7 h | <https://kloshletter.com/> | probable |

En réserve (désactivées, confiance incertaine) :

- « La Matinale du Monde » (<https://www.lemonde.fr/newsletters/>) : gratuité avec un simple compte non confirmée. Si l'inscription gratuite est confirmée, passer `lemonde-matinale` à `enabled: true` et `confidence: "verified"`, et ajouter `lemonde.fr` au filtre ; sinon, prendre « Les Actus du jour » d'HugoDécrypte (<https://www.hugodecrypte.com/>, `hugodecrypte-actus`) de la même façon ;
- « EL PAÍS de la mañana » (<https://elpais.com/newsletters/>, compte gratuit probablement demandé), à activer à la place d'une autre si l'édition ES manque de textes.

Ne pas s'abonner à une newsletter payante : la spec exige des newsletters gratuites (`free: true`).

## 2. Créer le filtre Gmail

1. Dans Gmail, *Paramètres* (roue dentée) → *Voir tous les paramètres* → *Filtres et adresses bloquées* → *Créer un filtre*.
2. Dans le champ **De**, coller exactement cette chaîne (le champ **De** n'attend pas le préfixe `from:`) :

   ```
   publicsenat.fr OR theconversation.com OR theguardian.com OR independent.co.uk OR axios.com OR eldiario.es OR kloshletter.com
   ```

   C'est la requête `from:(publicsenat.fr OR theconversation.com OR theguardian.com OR independent.co.uk OR axios.com OR eldiario.es OR kloshletter.com)`, celle que calcule `gmailFilterQuery` ; on peut aussi la coller telle quelle dans le champ **Contient les mots**, à la place du champ **De**.
3. *Créer un filtre*, puis cocher :
   - **Ignorer la boîte de réception (Archiver)** ;
   - **Appliquer le libellé** → *Nouveau libellé* → `Daily Brief` (exactement, avec la majuscule et l'espace) ;
   - **Appliquer également le filtre aux conversations correspondantes**.
4. *Créer un filtre*.

Cette requête couvre aussi les messages des autres newsletters de ces médias (theconversation.com expédie aussi des newsletters en anglais) : `brief:newsletters` n'en garde qu'une par newsletter active et par jour (la plus récente). Pour limiter le bruit, ne s'abonner qu'aux newsletters du tableau. Un message classé en spam n'est pas lu (la routine cherche hors spam) : s'il en arrive un, le sortir du spam à la main, ce qui apprend à Gmail l'expéditeur.

## 3. Après le premier envoi de chacune

Ouvrir un message reçu, *Afficher l'original*, et lire l'adresse **From** :

- [ ] Son domaine (ou un domaine parent) figure dans `senders` de la newsletter dans `pipeline/config/newsletters.json`. Sinon, remplacer `senders` par ce domaine exact et ajouter ce domaine à la requête du filtre.
- [ ] Le message porte bien le libellé `Daily Brief` et n'est pas dans la boîte de réception.
- [ ] Les liens vers les articles sont lisibles : `brief:newsletters` remplace un lien de suivi qui porte sa destination (`?u=https%3A…`), mais un lien de suivi opaque ne désigne aucun article ; l'information reste alors citable seulement depuis le texte de la newsletter, sans source « lue ».
- [ ] Puis passer `confidence` à `verified` et commiter `newsletters.json` (aucun secret).
- [ ] **Resserrer le filtre aux adresses exactes.** Une fois l'adresse From de chaque newsletter connue, remplacer dans le filtre chaque domaine par l'adresse exacte (par exemple `newsletter@info.publicsenat.fr` au lieu de `publicsenat.fr`), et `senders` par le sous-domaine exact dans `newsletters.json` : les autres envois de ces médias ne sont alors plus rangés sous le libellé.
- [ ] **Recherche du libellé (premier passage).** La routine cherche `label:"Daily Brief" newer_than:1d -in:spam`. Au premier passage, vérifier dans `newsletters-report.json` que les messages du jour sont bien trouvés ; si Gmail attend une autre forme du libellé (par exemple `label:daily-brief`), corriger l'étape 5 de `ROUTINE.md`.
- [ ] **DMARC.** Si `newsletters-report.json` ne signale plus « expéditeur non authentifié (pas d’Authentication-Results enregistré) » (la routine enregistre l'en-tête), passer `requireDmarc` à `true` dans `newsletters.json` : un message sans authentification sera alors refusé.

Le test `pipeline/test/newsletters/config.test.ts` recalcule la requête du filtre à partir de `newsletters.json` : après un changement de `senders`, mettre à jour ce guide avec la requête qu'il attend.
