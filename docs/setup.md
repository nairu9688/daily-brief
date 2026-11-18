# Mise en place du Daily Brief : la liste complète

Ce guide ordonne toute la mise en place (spec §14) en une seule liste à cocher, à suivre dans l'ordre, sans connaître le code. Chaque étape renvoie au guide détaillé qui l'explique. Compter une heure et demie en tout, en plusieurs fois si besoin.

**Qui fait quoi.** « Naïm » : une action dans un compte personnel (création de compte, clé, paiement, choix). « Claude, avec ton accord » : Claude le fait par un connecteur ou une commande, après t'avoir dit exactement quoi et obtenu ton accord.

**Règle d'or.** Aucune clé ni aucun mot de passe ne se colle dans une conversation, un prompt, un commit ou un ticket. Les secrets se saisissent dans Supabase Vault (étape 6) et nulle part ailleurs, sauf le `.env` local de l'étape 7.

## Avant de commencer

- [ ] Un compte GitHub qui héberge le dépôt `daily-brief` (spec §14, étape 5).
- [ ] La boîte Gmail du Daily Brief (spec : nanigeek@gmail.com).
- [ ] Un compte Google (Drive et Google Cloud), un compte Supabase et un compte Vercel.

## Étapes

1. **Projet Supabase** — *Claude, avec ton accord* (connecteur Supabase), sinon Naïm dans le tableau de bord. Projet `daily-brief`, région Paris (`eu-west-3`), puis les quatre migrations dans l'ordre et l'email autorisé. Guide : [setup-supabase.md](setup-supabase.md), §1 à §3. *Débloque* : la base, Vault, l'appli.
2. **Newsletters et filtre Gmail** — *Naïm*, dès le début : les premiers envois mettent quelques jours à arriver, et l'étape 12 vérifie qu'aucun n'est ignoré. S'abonner aux sept newsletters actives, confirmer chaque inscription, puis créer le filtre vers le libellé `Daily Brief`. Guide : [setup-newsletters.md](setup-newsletters.md). *Débloque* : les textes lus des newsletters.
3. **Clés de collecte et de photos** — *Naïm*. Créer les clés gratuites TheNewsAPI (<https://www.thenewsapi.com>), Exa (<https://exa.ai>), Webz.io News API Lite (<https://webz.io>) et Pexels (<https://www.pexels.com/api/>). Les garder pour l'étape 6. *Débloque* : la collecte et les photos.
4. **Clé Text-to-Speech** — *Naïm*. Projet Google Cloud, API Text-to-Speech activée, facturation enregistrée, clé restreinte à cette API. Guide : [setup-audio.md](setup-audio.md), §1 et §2. *Débloque* : l'audio.
5. **Dépôt Drive (Apps Script)** — *Naïm*. Coller `apps-script/Code.gs`, choisir le jeton, déployer en application web. Guide : [setup-supabase.md](setup-supabase.md), §5. *Débloque* : l'archive PDF et MP3 dans Drive.
6. **Secrets dans Vault** — *Naïm*, dans le tableau de bord Supabase (*Project Settings* → *Vault*). Saisir `SUPABASE_URL` (l'URL du projet, pas un secret mais rangée là pour la routine), `SUPABASE_SERVICE_ROLE_KEY`, `THENEWSAPI_KEY`, `EXA_API_KEY`, `WEBZ_TOKEN`, `PEXELS_API_KEY`, `GOOGLE_TTS_API_KEY`, `APPS_SCRIPT_URL` et `APPS_SCRIPT_TOKEN` (et `GITHUB_READ_TOKEN` seulement pour une routine Cowork, étape 13). Guide : [setup-supabase.md](setup-supabase.md), §4 ; lecture par la routine : [pipeline/run/env-from-vault.md](../pipeline/run/env-from-vault.md). *Débloque* : la routine.
7. **TheNewsAPI en temps réel ?** — *Claude, avec ton accord* (vérification §16, une seule fois). Avec un `.env` écrit depuis Vault : `npm run check:thenewsapi`. Code 1 : passer `"primary": "exa"` dans `pipeline/config/collect.json` et commiter. *Débloque* : le choix de la découverte principale.
8. **Choix des voix** — *Claude, avec ton accord*, lance `npm run audio:samples` ; *Naïm* écoute `out/voice-samples/` et choisit une voix par langue ; Claude reporte le choix dans `pipeline/config/voices.json` (`confirmed: true`) et commite. Guide : [setup-audio.md](setup-audio.md), §5. *Débloque* : un audio sans avertissement.
9. **Appli web sur Vercel** — Avant le déploiement, `npm run web:build && npm run web:e2e` et `npm run web:check-bundle` — *Claude, avec ton accord*. Puis *Naïm* importe le dépôt dans Vercel et saisit les variables ; *Claude, avec ton accord*, peut vérifier le déploiement par le connecteur Vercel. Guide : [setup-web.md](setup-web.md). *Débloque* : la lecture du brief.
10. **Types de la base** — *Claude, avec ton accord* (connecteur Supabase, génération des types TypeScript du projet). Les comparer aux schémas zod de `apps/web/lib/data/rows.ts` et signaler tout écart (aucun commit si tout concorde). *Débloque* : la confiance dans la lecture de l'appli.
11. **Vérifications de la routine (§16)** — *Claude, avec ton accord*. Dans une session Claude Code cloud sur ce dépôt : Gmail et Supabase sont-ils disponibles comme connecteurs d'une tâche planifiée ? Chromium (`npx playwright --version`, rendu du PDF) et ffmpeg (`ffmpeg -version`, facultatif) sont-ils présents ? *Débloque* : le choix entre routine Claude Code et routine Cowork.
12. **Premier passage manuel de bout en bout** — *Claude, avec ton accord*, en suivant [ROUTINE.md](../ROUTINE.md) pour la date du jour ; *Naïm* contrôle. À contrôler :
    - [ ] le site : connexion, Brief du jour dans les trois langues, lecteur MP3, PDF du jour, une case cochée, un Thread suivi, la page Santé (étapes `context` à `drive`, dont `audio`) ;
    - [ ] Drive : `Daily Brief/AAAA/MM - Mois/` contient le PDF et les trois MP3 ;
    - [ ] les sections « À contrôler » de [setup-supabase.md](setup-supabase.md) (§7), [setup-audio.md](setup-audio.md) (§7) et [setup-web.md](setup-web.md) (§6) ;
    - [ ] la collecte : dans `collect-report.json`, des textes lus pour chacun des 10 domaines `full` (redirection de l'adresse sans `www.` vers `www.` acceptée) ;
    - [ ] les newsletters : `newsletters-report.json` liste les messages du jour, aucun n'est ignoré pour « expéditeur hors liste », et dit si l'en-tête `Authentication-Results` a été enregistré ([setup-newsletters.md](setup-newsletters.md), §3 : `requireDmarc`) ;
    - [ ] **le quota Claude** : noter la part du quota consommée par ce passage (page d'usage de Claude, avant et après). Trop élevée : réduire `maxPerDay` dans `pipeline/config/newsletters.json`, puis le nombre de sujets par rubrique (`pipeline/editorial/PROMPT.md`, §8).
13. **Tâche planifiée** — *Claude, avec ton accord*. Tâche `CRON_TZ=Europe/Paris 13 5 * * *`, notification push activée, prompt : la section « Prompt » de [ROUTINE.md](../ROUTINE.md), connecteurs Gmail et Supabase. Si l'étape 11 a montré que Gmail ou Supabase manque dans une tâche Claude Code : créer la routine dans **Cowork**, où ces connecteurs sont confirmés. Le dépôt reste privé : *Naïm* crée un jeton GitHub *fine-grained* en lecture seule sur le seul dépôt `daily-brief` (*Contents : Read-only*) et le range dans Vault sous `GITHUB_READ_TOKEN` ; la routine Cowork le lit dans Vault et clone le dépôt comme le décrit [pipeline/run/env-from-vault.md](../pipeline/run/env-from-vault.md) (« Routine Cowork »). *Débloque* : le brief de chaque matin.
14. **Le lendemain** — *Naïm*. À 6 h, la notification « Brief du jour prêt » est arrivée ; la page Santé montre le passage. Sinon, lire la raison dans la notification et `out/<date>/routine-report.json` dans la session de la routine.
15. **Après les premiers passages** — *Claude, avec ton accord*. Affiner les rubriques (`pipeline/editorial/rubriques.json` : mots-clés et requêtes Exa) d'après ce que la collecte a ramené pendant une ou deux semaines, et resserrer le filtre Gmail aux adresses exactes ([setup-newsletters.md](setup-newsletters.md), §3). *Débloque* : un brief mieux ciblé.

## Chaque mois

- [ ] Revérifier la liste blanche (`pipeline/config/whitelist.json`, `checkedAt`) et les newsletters (`newsletters.json`, `checkedAt`).
- [ ] Jeter un œil à la consommation de Text-to-Speech et d'Exa (crédits du mois).
