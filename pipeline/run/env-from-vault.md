# Écrire `.env` à partir de Supabase Vault

Procédure suivie par la routine (`ROUTINE.md`, étape 2) et, au besoin, à la main. Elle lit les secrets rangés dans Vault (spec §6.3, `docs/setup-supabase.md` §4) avec le **connecteur Supabase** et les écrit dans `.env`, à la racine du clone. Le pipeline lit ensuite `.env` tout seul ; il n'utilise jamais le connecteur.

## Règles

- **Ne jamais afficher une valeur** : ni dans un message, ni dans une commande, ni dans un journal. Ne jamais lancer `cat .env`, `env`, `printenv` ni `echo $…` sur une variable secrète.
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

## Étapes

1. **Vérifier les noms présents**, sans les valeurs, avec l'outil SQL du connecteur Supabase sur le projet `daily-brief` :

   ```sql
   select name from vault.decrypted_secrets
   where name = any (array['SUPABASE_URL','SUPABASE_SERVICE_ROLE_KEY','THENEWSAPI_KEY','EXA_API_KEY','WEBZ_TOKEN','PEXELS_API_KEY','GOOGLE_TTS_API_KEY','APPS_SCRIPT_URL','APPS_SCRIPT_TOKEN'])
   order by name;
   ```

   Si `SUPABASE_URL` manque, prendre l'URL du projet avec l'outil « URL du projet » du connecteur (ce n'est pas un secret).
2. **Lire les valeurs** avec la même requête, en remplaçant `select name` par `select name, decrypted_secret`. Ne rien reformuler ni commenter du résultat.
3. **Écrire `.env`** à la racine du clone, en une seule écriture de fichier, une ligne `NOM=valeur` par secret, sans guillemets ni espaces autour de `=`. Ne pas passer par une commande `echo` : la commande apparaîtrait dans le journal.
4. **Restreindre et contrôler** :

   ```bash
   chmod 600 .env
   git check-ignore -q .env && echo ".env ignoré par git"
   npm run env:check
   ```

   `npm run env:check` affiche chaque nom avec « présente », « vide » ou « absente », jamais une valeur. Code 0 : `.env` prêt. Code 2 : une variable obligatoire manque ; la routine s'arrête sur « Brief incomplet : secrets indisponibles ».

## Si le connecteur Supabase ne répond pas

La routine s'arrête : sans `SUPABASE_URL` et `SUPABASE_SERVICE_ROLE_KEY`, ni le contexte ni la publication ne sont possibles. La page Santé montrera la ligne `runs` du jour absente ; relancer la routine à la main quand le connecteur répond.
