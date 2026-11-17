# Mise en place de l'audio (Google Cloud Text-to-Speech)

Ce guide met en service la lecture audio du Daily Brief (spec §9, §14 et §16). Il se suit une seule fois, en 15 minutes environ. Les tests n'appellent jamais Google : ils utilisent un faux service.

Deux règles valent pour tout le guide :

- **Aucun secret dans une conversation, un prompt, un commit ou un ticket.** La clé se colle dans Vault (Supabase) et, pour l'étape 5 seulement, dans un `.env` local.
- **L'audio ne bloque jamais le Brief.** Sans clé, ou si Google refuse, les éditions sont publiées sans lecteur.

## 1. Créer le projet Google Cloud

1. Ouvrir la console Google Cloud et créer un projet, par exemple `daily-brief`.
2. *APIs & Services* → *Library* → **Cloud Text-to-Speech API** → *Enable*.
3. *Billing* : rattacher un compte de facturation. Google l'exige même pour rester dans le palier gratuit des voix Chirp 3 HD (1 million de caractères par mois, à confirmer sur la page des tarifs).
4. Conseillé : *Billing* → *Budgets & alerts* → un budget de 1 € avec une alerte à 50 %. Le pipeline plafonne déjà les envois à 15 000 caractères par passage, soit 465 000 par mois au pire.

## 2. Créer une clé restreinte à Text-to-Speech

1. *APIs & Services* → *Credentials* → *Create credentials* → *API key*.
2. *Edit API key* → *API restrictions* → *Restrict key* → cocher seulement **Cloud Text-to-Speech API** → *Save*.
3. *Application restrictions* : laisser *None*. La routine tourne dans un conteneur cloud dont l'adresse IP change.
4. Renommer la clé, par exemple `daily-brief-tts`.

## 3. Ranger la clé dans Vault

Dans Supabase : *Project Settings* → *Vault* → *Add new secret*, nom **`GOOGLE_TTS_API_KEY`** (voir `docs/setup-supabase.md`, section 4). La routine la recopie dans `.env` à chaque passage. Le pipeline l'envoie dans l'en-tête `x-goog-api-key`, jamais dans une URL, et la masque dans tous ses messages et rapports.

## 4. Vérifier ffmpeg (facultatif)

`brief:audio` utilise ffmpeg s'il le trouve (`ffmpeg -version`, ou le chemin de `FFMPEG_PATH`) : les morceaux sont alors réencodés en un MP3 de 64 kb/s mono. Sinon, il met les trames MP3 bout à bout, au débit renvoyé par Google : le fichier reste lisible, mais il n'est pas réencodé. Le rapport `audio-report.json` dit ce qui a servi (`ffmpeg`, puis `method` pour chaque édition).

## 5. Choisir les voix sur des échantillons

**Prérequis.**

- Node 22 ou plus (`node --version`).
- Le dépôt cloné sur la machine, puis `npm install` à la racine.
- Un fichier `.env` **à la racine du dépôt** (jamais commité), d'une seule ligne : `GOOGLE_TTS_API_KEY=<la clé>`. Le créer avec un éditeur, sans coller la clé dans une conversation.

Sur cette machine de confiance, depuis la racine du dépôt :

```bash
npm run audio:samples              # 3 échantillons par langue
npm run audio:samples -- --count 5 # pour en entendre plus (1 à 10, entier)
```

Chaque passage réussi remplace entièrement `out/voice-samples/`. Un passage où rien n'a pu être écrit (clé refusée, service muet) laisse intacts les échantillons du passage précédent.

La commande liste les voix Chirp 3 HD de fr-FR, en-US, en-GB et es-ES (`voices.list` filtré sur « Chirp3-HD »). Elle écrit les échantillons dans `out/voice-samples/` et la liste complète des voix dans `out/voice-samples/index.json`. Elle envoie environ 200 caractères par échantillon.

Écouter les échantillons, puis reporter les voix choisies dans `pipeline/config/voices.json` :

```json
{
  "confirmed": true,
  "fr": { "languageCode": "fr-FR", "name": "fr-FR-Chirp3-HD-…" },
  "en": { "languageCode": "en-GB", "name": "en-GB-Chirp3-HD-…", "speakingRate": 1.0 },
  "es": { "languageCode": "es-ES", "name": "es-ES-Chirp3-HD-…" }
}
```

- `languageCode` vaut `fr-FR`, `en-US` ou `en-GB`, `es-ES`, et le nom de la voix commence par lui.
- `speakingRate` est facultatif, entre 0,25 et 2.
- `confirmed: true` fait taire l'avertissement « voix par défaut non confirmées ».

Commiter ce fichier : il ne contient aucun secret. Supprimer ensuite le `.env` local s'il ne sert plus.

## 6. Premier essai

Sur un dossier du jour qui contient des `{lang}.verified.json` :

```bash
npm run brief:audio -- --date AAAA-MM-JJ
npm run brief:render -- --date AAAA-MM-JJ   # l'encart audio du PDF porte la durée
```

Écouter les trois MP3 (`out/<date>/Daily Brief <date> FR.mp3`, `EN`, `ES`) et lire `audio-report.json` : `status`, caractères envoyés, méthode de concaténation.

## 7. À contrôler sur le vrai service

À cocher au premier passage réel :

- [ ] Les noms des voix de `voices.json` existent dans `voices.list` (sinon : HTTP 400, édition sans lecteur).
- [ ] `text:synthesize` accepte la clé en en-tête `x-goog-api-key` (sinon : 403).
- [ ] La réponse est bien un MP3 (`audioEncoding: MP3`) : fréquence (24 kHz attendus) et débit, notés dans le rapport par la durée et la taille.
- [ ] Un morceau de 4 500 octets passe. Si Google refuse des phrases trop longues pour Chirp 3 HD (« sentences too long »), réduire `MAX_CHUNK_BYTES` ou découper plus finement (`pipeline/audio/chunk.ts`).
- [ ] La durée de `audio.json` correspond à l'écoute, à la seconde près.
- [ ] La concaténation sans ffmpeg (`--no-ffmpeg`) se lit sans craquement entre les morceaux.
- [ ] La consommation du mois apparaît dans la console (*APIs & Services* → *Text-to-Speech* → *Metrics*) : environ 10 000 caractères par jour.
- [ ] Le palier gratuit et le tarif des voix Chirp 3 HD sont bien ceux supposés par la spec (§15).
