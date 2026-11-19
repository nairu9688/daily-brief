# Mise en place de l'application web (Vercel)

Ce guide met en ligne l'appli du Daily Brief (spec §5, §8.3 et §14, étape 5). Il se suit une fois, en 15 minutes environ, **après** `docs/setup-supabase.md` (projet, migrations, email autorisé). Rien ici n'est fait par les tests : ils tournent en mode `FIXTURE=1`, sans réseau ni Supabase.

Deux règles valent pour tout le guide :

- **L'appli n'utilise que la clé publique** de Supabase (`anon` ou `sb_publishable_…`). La clé de service (`service_role` ou `sb_secret_…`) ne doit jamais entrer dans Vercel : l'appli refuse de démarrer si on la lui donne par erreur.
- **`FIXTURE=1` n'existe qu'en local.** Ce mode ouvre l'appli sans connexion ; il est refusé sur Vercel, et en production (`next start`) sauf `FIXTURE_ALLOW_START=1`, que seuls les tests de bout en bout posent. Ne jamais définir ces deux variables dans Vercel.

## 1. Créer le projet Vercel

1. Sur <https://vercel.com/new>, importer le dépôt GitHub `daily-brief`.
2. *Root Directory* : `apps/web`. Laisser cochée l'option qui inclut les fichiers hors de ce dossier : l'appli importe `packages/schema` et `packages/maps`.
3. *Framework Preset* : Next.js. Laisser les commandes par défaut : Vercel installe depuis la racine (`package-lock.json` des workspaces npm) puis lance `next build`.
4. L'écran d'import n'offre que le bouton *Deploy* : avant de cliquer, ouvrir son panneau *Environment Variables* et y saisir les variables du §2. Si le projet a été déployé sans elles, ce n'est pas grave : ce premier déploiement échoue (ou refuse toute page), et le §4 redéploie une fois les variables renseignées dans *Settings* → *Environment Variables*.
5. Une fois le projet créé : *Settings* → *Build and Deployment* → *Node.js Version* : 22.x (ce réglage n'existe pas sur l'écran d'import), puis redéployer si le premier déploiement a utilisé une autre version.

## 2. Variables d'environnement

Dans le panneau *Environment Variables* de l'écran d'import (§1, étape 4), ou plus tard dans *Settings* → *Environment Variables*, pour *Production* (et *Preview* si besoin) :

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
   - *Redirect URLs* : `<SITE_URL>/auth/confirm`, par exemple `https://daily-brief-xxx.vercel.app/auth/confirm` (`SITE_URL` contient déjà `https://`), et `http://localhost:3000/auth/confirm` pour le développement local.

   En développement local, le lien du courriel pointe quand même vers la *Site URL* de production (le modèle utilise `{{ .SiteURL }}`) : saisir alors le **code** du courriel sur `http://localhost:3000/login`.
2. *Emails* → *Magic Link* **et** *Emails* → *Confirm signup* : remplacer les deux modèles par celui-ci, qui donne à la fois un lien et un code. La toute première connexion crée le compte et envoie le modèle *Confirm signup*, pas *Magic Link* : sans ce second remplacement, le premier courriel n'a ni lien `token_hash` ni code.

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

`web:check-bundle` ne fouille que `.next/static`, le code JavaScript envoyé au navigateur. Il ne voit pas les données que les composants serveur passent en props aux composants clients (elles voyagent dans le HTML et le flux RSC de chaque page) : ce cas est couvert par la règle statique de `apps/web/test/security/static.test.ts` (aucun composant client n'importe les modules de données ou d'authentification) et par la relecture, qui vérifie qu'aucune prop ne porte un secret.

**En-têtes de sécurité.** `next.config.ts` pose `X-Content-Type-Options`, `Referrer-Policy`, `X-Frame-Options` et `Permissions-Policy`, et `proxy.ts` la CSP. HSTS (`Strict-Transport-Security`) n'est pas ajouté par l'appli : Vercel l'envoie déjà sur tous ses domaines en https.

## 6. À contrôler sur le vrai service

Ces points ne peuvent pas être vérifiés hors ligne. Ils sont à cocher au premier essai.

- [ ] **Build Vercel.** Le build Turbopack réussit depuis `apps/web` avec les paquets du dépôt (`transpilePackages`) ; la carte du monde (world-atlas 50m) tient dans la fonction serveur.
- [ ] **Jeton.** `getClaims()` renvoie bien `email` pour une session ouverte par lien magique (le proxy et la RLS en dépendent).
- [ ] **Lien et code.** Le lien du courriel ouvre une session (`/auth/confirm?token_hash=…`) ; le code à 6 chiffres aussi, depuis l'appli installée.
- [ ] **Autre adresse.** Une autre adresse ne reçoit aucun courriel ; une session d'une autre adresse est renvoyée vers `/login?erreur=refuse`.
- [ ] **Écritures.** Cocher un mot, « Ajouter à Anki » et « Suivre ce thread » écrivent en base ; aucune autre écriture n'est possible (RLS).
- [ ] **Audio.** Le lecteur joue le MP3 par l'URL signée (redirection de `/audio/<date>/<langue>`) et affiche sa durée ; la console ne montre aucune violation de CSP (`media-src` contient l'origine Supabase). Vérifier aussi un MP3 concaténé sans ffmpeg (consigne du lot 5).
- [ ] **PDF.** « PDF du jour » télécharge `Daily Brief AAAA-MM-JJ.pdf`.
- [ ] **Photos.** Une photo Wikimedia Commons s'affiche, avec « Photo : auteur — licence · Wikimedia Commons » (CSP `img-src https://upload.wikimedia.org https://thumb.wikimedia.org`).
- [ ] **CSP.** Aucune violation dans la console, sur chaque écran, en production.
- [ ] **Cookies.** Les cookies de session et `ed` portent `Secure` en https.
- [ ] **PWA.** L'installation fonctionne sur iPhone et Android ; l'icône et la couleur de fond sont correctes.
