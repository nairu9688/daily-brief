# Écrire `.env` à partir de Supabase Vault

Procédure suivie par la routine (`ROUTINE.md`, étape 2) et, au besoin, à la main. Elle lit les secrets rangés dans Vault (spec §6.3, `docs/setup-supabase.md` §4) avec le **connecteur Supabase** et les écrit dans `.env`, à la racine du clone. Le pipeline lit ensuite `.env` tout seul ; il n'utilise jamais le connecteur.

## Règles

- **Ne jamais afficher une valeur** : ni dans un message, ni dans une commande, ni dans un journal. Ne jamais lancer `cat .env`, `env`, `printenv` ni `echo $…` sur une variable secrète. La seule exception est la commande de clonage de la routine Cowork (dernière section), qui porte `GITHUB_READ_TOKEN` dans son URL : elle apparaît dans le journal de la session, et le jeton est retiré de la configuration git juste après.
- **Limite connue : les valeurs passent par le transcript de la session.** Le connecteur Supabase rend les valeurs déchiffrées à Claude, puis Claude les écrit dans `.env` : elles figurent donc dans le transcript de la session de la routine, même si elles ne sont jamais affichées dans une réponse. Ne jamais partager une session de la routine (lien, export, capture). Si une session a été partagée, ou peut l'avoir été, faire tourner (régénérer) toutes les clés de Vault, puis les y remplacer.
- **`.env` ne quitte pas le conteneur** : il est dans `.gitignore` ; on ne le commite pas et on ne le copie nulle part.
- Seuls les noms ci-dessous sont lus. Un autre secret de Vault n'est jamais demandé.

| Nom | Obligatoire | Utilisé par |
|---|---|---|
| `SUPABASE_URL` | oui | `brief:context`, `brief:publish` (pas un secret ; rangé dans Vault par commodité) |
| `SUPABASE_SERVICE_ROLE_KEY` | oui | `brief:context`, `brief:publish` |
| `THENEWSAPI_KEY`, `EXA_API_KEY`, `WEBZ_TOKEN` | non (source coupée sans clé) | `brief:collect` |
| `PEXELS_API_KEY` | non (photos sans image) | `brief:render` |
| `GOOGLE_TTS_API_KEY` | non (éditions sans lecteur) | `brief:audio` |
| `APPS_SCRIPT_URL`, `APPS_SCRIPT_TOKEN` | non (pas de dépôt Drive) | `brief:publish` |
| `GITHUB_READ_TOKEN` | routine Cowork seulement, jamais écrit dans `.env` | clonage du dépôt privé (voir la dernière section) |

## Étapes

1. **Vérifier les noms présents**, sans les valeurs, avec l'outil SQL du connecteur Supabase sur le projet `daily-brief` :

   ```sql
   select name from vault.decrypted_secrets
   where name = any (array['SUPABASE_URL','SUPABASE_SERVICE_ROLE_KEY','THENEWSAPI_KEY','EXA_API_KEY','WEBZ_TOKEN','PEXELS_API_KEY','GOOGLE_TTS_API_KEY','APPS_SCRIPT_URL','APPS_SCRIPT_TOKEN'])
   order by name;
   ```

   Si `SUPABASE_URL` manque, prendre l'URL du projet avec l'outil « URL du projet » du connecteur (ce n'est pas un secret).
2. **Lire les valeurs** avec la même requête, en remplaçant `select name` par `select name, decrypted_secret`. Ne rien reformuler ni commenter du résultat.
3. **Écrire `.env`** à la racine du clone, en une seule écriture de fichier (outil d'écriture de fichier, jamais une commande `echo` ou `cat <<` : la commande apparaîtrait dans le journal), une ligne `NOM='valeur'` par secret, sans espace autour de `=`. Les guillemets simples gardent la valeur telle quelle pour `util.parseEnv` (un `#` n'y commence pas un commentaire). `parseEnv` ne connaît pas d'échappement : une valeur qui contient une apostrophe s'écrit entre guillemets doubles (`NOM="valeur"`) ; une valeur qui contient les deux, ou un saut de ligne, ne peut pas être écrite : s'arrêter et le signaler (« secret illisible : NOM »), sans afficher la valeur.
   Le fichier est créé avec les droits par défaut (0644) puis restreint à l'étape 4 : cette courte fenêtre est acceptable dans le conteneur de la routine, qui n'a qu'un seul compte.
4. **Restreindre et contrôler** :

   ```bash
   chmod 600 .env
   git check-ignore -v .env
   npm run env:check
   ```

   `git check-ignore -v .env` doit afficher la règle de `.gitignore` qui ignore `.env` ; pas de sortie de `git check-ignore` : s’arrêter (le fichier pourrait être commité), supprimer `.env` et terminer par « Brief incomplet : secrets indisponibles ».

   `npm run env:check` affiche chaque nom avec « présente », « vide » ou « absente », jamais une valeur. Code 0 : `.env` prêt. Code 2 : une variable obligatoire manque ; la routine s'arrête sur « Brief incomplet : secrets indisponibles ».

## Si le connecteur Supabase ne répond pas

La routine s'arrête : sans `SUPABASE_URL` et `SUPABASE_SERVICE_ROLE_KEY`, ni le contexte ni la publication ne sont possibles, et aucune ligne `runs` ne peut être écrite. La page Santé montrera la ligne `runs` du jour absente ; relancer la routine à la main quand le connecteur répond.

## Routine Cowork : jeton GitHub en lecture seule

En routine Cowork (`docs/setup.md`, étape 13), le dépôt privé se clone avec `GITHUB_READ_TOKEN`, un jeton GitHub *fine-grained* limité au dépôt `daily-brief`, droit *Contents : Read-only*, rangé dans Vault comme les autres secrets. Il se lit avant le clonage, par une requête de même forme limitée à ce nom (`where name = 'GITHUB_READ_TOKEN'`), et ne s'écrit **jamais** dans `.env`. Clonage (la seule commande autorisée à porter une valeur, voir les règles), puis retrait du jeton de la configuration git. `<compte>` est le compte GitHub écrit dans le prompt de la routine Cowork (`docs/setup.md`, étape 13) ; ne jamais le deviner :

```bash
git clone "https://x-access-token:<jeton>@github.com/<compte>/daily-brief.git" daily-brief
git -C daily-brief remote set-url origin "https://github.com/<compte>/daily-brief.git"
```

Le jeton passe lui aussi par le transcript (voir les règles) : même consigne, ne jamais partager la session, régénérer le jeton si elle l'a été.
