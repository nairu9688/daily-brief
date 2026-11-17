# Lot 5 — Audio : plan d'implémentation

> **Pour les agents :** sous-skill requis : superpowers:subagent-driven-development (recommandé) ou superpowers:executing-plans, tâche par tâche. Les étapes utilisent des cases à cocher (`- [ ]`) pour le suivi.

**Objectif :** livrer `npm run brief:audio`, qui fait lire l'`audioScript` de chaque édition vérifiée par une voix Google Cloud Text-to-Speech Chirp 3 HD, écrit `Daily Brief AAAA-MM-JJ FR.mp3` (et `EN`, `ES`), `audio.json` (durées pour l'encart du PDF) et `audio-report.json`, sans jamais bloquer la routine ; plus `npm run audio:samples`, qui produit les échantillons de voix de la mise en place. Spec : §3, §9, §12, §14 et §16.

**Architecture :** un dossier `pipeline/audio/`, un fichier par responsabilité.
- **Format.** `mp3.ts` lit les trames MPEG couche III (en-têtes, ID3, trame Xing/Info, durée) sans dépendance.
- **Texte.** `chunk.ts` découpe le script sous 4 500 octets UTF-8, aux fins de phrase, puis aux virgules, puis entre les mots.
- **Service.** `tts.ts` est le client REST de Text-to-Speech (synthèse et liste des voix) sur le transport borné du lot 3 ; `voices.ts` lit `pipeline/config/voices.json`.
- **Assemblage.** `concat.ts` concatène avec ffmpeg (64 kb/s mono) ou, sans ffmpeg, trame par trame ; `voice-edition.ts` lit une édition (budget, disjoncteur, seconde tentative) ; `budget.ts` plafonne les caractères.
- **Commandes.** `run-audio.ts` orchestre le passage et écrit les fichiers ; `cli.ts` est `brief:audio` ; `samples.ts` et `samples-cli.ts` sont `audio:samples`.

Aucun test n'appelle Google ni Internet : Text-to-Speech est simulé par un faux `fetch`. Les MP3 de test sont des trames synthétiques valides ; quand ffmpeg est présent, des tests supplémentaires fabriquent de vrais MP3 et vérifient le réencodage (ils sont ignorés sans ffmpeg).

**Pile :** `fetch` de Node 22, zod 4 (validation de toute réponse), `node:child_process` (ffmpeg facultatif). Aucune dépendance npm nouvelle.

**Feuille de route :** `docs/superpowers/plans/2026-11-06-phase-1-roadmap.md` (lot 5 et « Consignes issues du lot 4 »). **Spec :** `docs/specs/2026-11-06-daily-brief-design.md`.

---

## Contexte pour l'exécutant

- **Point de départ.** Les lots 1 à 4 sont en place. Sur `HEAD` (`b645fae`, dont le code est celui de `d002a3d`), `npm test` donne `Test Files  67 passed (67)` et `Tests  716 passed (716)`, et `npm run typecheck` ne sort rien. Si la base a bougé depuis (corrections du lot 4), ajouter la différence aux totaux attendus de chaque tâche : ce lot ajoute 11 fichiers de test et 93 tests.
- **ffmpeg.** Il est présent dans ce conteneur (`/usr/bin/ffmpeg`, avec `libmp3lame` et le filtre `sine`), peut-être pas dans celui de la routine. Les totaux ci-dessous supposent ffmpeg présent. Sans ffmpeg, 5 tests sont ignorés (4 dans `concat.test.ts`, 1 dans `run-audio.test.ts`) : vitest affiche alors `Tests  N passed | 5 skipped`, pour le même total.
- **Fichiers existants modifiés, et seulement ceux-là :**
  - `pipeline/lib/fs.ts` (tâche 7) : `writeAtomic` accepte aussi des octets, simple élargissement de type ;
  - `pipeline/test/run-cli.ts` (tâche 8) : `GOOGLE_TTS_API_KEY` retirée des CLI testés ;
  - `package.json` (tâches 8 et 9) : scripts `brief:audio` et `audio:samples` ;
  - `fixtures/api/README.md` (tâche 4), `README.md` et la feuille de route (tâche 10).
- **Fichiers à ne pas modifier :** `packages/`, `pipeline/render/`, `pipeline/publish/`, `pipeline/collect/`, `pipeline/supabase/`, `supabase/`, `apps-script/`. Le lot les **importe** en lecture seule :
  - `pipeline/publish/files.ts` : `mp3FileName` (noms des MP3) et `looksLikeMp3` (contrôle strict des trames) ;
  - `pipeline/publish/inputs.ts` : `MAX_MP3_BYTES` (15 Mo) et `MAX_JSON_BYTES` ;
  - `pipeline/collect/http.ts` : `fetchJson` (délai, signal, taille bornée), `HttpError`, `BodyError`, `isTimeout` ;
  - `pipeline/collect/breaker.ts` : `Breaker` (coupure sur 401, 402, 403, 429, délai, 3 échecs consécutifs) et `describeError` ;
  - `pipeline/lib/` : `loadEnv`, `writeAtomic`, `redactText`, `stripSecrets`, `parisToday`.
- **Consignes du lot 4, toutes tenues :**
  - **Noms.** Chaque MP3 est écrit dans `out/<date>/` sous le nom `Daily Brief AAAA-MM-JJ FR.mp3` (`EN`, `ES`) par `mp3FileName`, **avant** `brief:publish`, qui le dépose au chemin `AAAA-MM-JJ/<langue>.mp3` du bucket `audio` (tâche 7, testé avec `loadPublishInputs`).
  - **Contrôle.** Chaque MP3 passe `looksLikeMp3` et pèse moins de 15 Mo avant d'être écrit (tâche 7).
  - **Anciens MP3.** Ils sont supprimés d'abord, avec `audio.json` et le rapport, même sans clé (tâche 7).
  - **`audio.json`.** Sa forme est `{ "fr": { "duration": "3:24" } }`, avec seulement les langues qui ont un MP3. `brief:render` la lit avec `z.object({ fr, en, es }).partial()` (tâche 7, testé contre ce schéma et contre le vrai `runRender`).
- **Leçons des lots 1 à 4, appliquées dès le départ :**
  - **Réseau.** Chaque requête a un délai (60 s pour une synthèse, 20 s pour une liste) et un `AbortSignal` ; une échéance globale borne le passage (10 min). Le disjoncteur coupe sur 401, 403, 429, délai dépassé et 3 échecs consécutifs ; seule une erreur 5xx ou réseau a droit à une seconde tentative.
  - **Secrets.** La clé part dans l'en-tête `x-goog-api-key`, jamais dans l'URL ; elle est masquée dans tout message, rapport et `index.json`, et des tests le vérifient, y compris quand une erreur réseau la cite.
  - **Entrées.** Toute réponse de Google est validée par zod et bornée en taille ; l'audio décodé doit être un MP3. Chaque édition est contrôlée contre sa langue et sa date.
  - **Sorties.** Les anciennes sorties sont supprimées d'abord ; le rapport est toujours écrit, de façon atomique ; un MP3 est écrit par fichier temporaire puis renommage.
  - **Code.** Les sorties sont déterministes (mêmes entrées, mêmes MP3), et chaque fichier a une responsabilité.
- **Réseau et clés.** Aucune clé n'est disponible ni à demander. Les tests de CLI tournent dans un dossier vide, sans variables secrètes (`pipeline/test/run-cli.ts`), avec un faux `fetch` préchargé (`pipeline/test/audio/fake-tts-preload.ts`).
- **Commandes.** Elles se lancent depuis la racine du dépôt. Un échec « Failed to load url ../../audio/… » ou « Cannot find module » signifie que le module n'existe pas encore : c'est l'échec attendu de l'étape « vérifier l'échec ».

### Décisions de conception

1. **Limite d'un morceau : 4 500 octets UTF-8.**
   - **Limite documentée.** La page « Quotas et limites » de Text-to-Speech fixe 5 000 octets de texte par requête `text:synthesize` (chiffre connu de la documentation, pas consulté depuis ce conteneur sans réseau : à confirmer). La feuille de route vise moins de 4 500 octets, soit 10 % de marge.
   - **Octets, pas caractères.** Une lettre accentuée ou une espace insécable compte deux octets : un script français de 4 500 caractères dépasse la limite.
   - **Points de coupe.** Les phrases entières sont regroupées tant qu'elles tiennent ; une phrase trop longue est coupée aux virgules, points-virgules, deux-points ou tirets, puis entre les mots. Un mot n'est jamais coupé : un « mot » de plus de 4 500 octets est une erreur.
   - **Ponctuation.** Les guillemets français, `¿`, `¡` et la ponctuation précédée d'une espace (` ?`, ` !`, ` :`) restent collés à leur mot. Les abréviations courantes (`M.`, `Dr.`, `EE. UU.`) et les initiales (`J. D.`) ne terminent pas une phrase.
   - **Invariant testé.** Les morceaux recollés par une espace redonnent exactement le texte normalisé : rien n'est perdu ni ajouté.
   - **En pratique.** Un script de 350 à 450 mots fait environ 2 500 à 3 000 caractères, donc un seul morceau ; le découpage ne sert que pour un script long. Une éventuelle limite de longueur de **phrase** propre à Chirp 3 HD n'est pas documentée à notre connaissance : elle est à vérifier avec la vraie API (dernière section).
2. **ffmpeg si présent, sinon concaténation des trames.**
   - **Avec ffmpeg.** Le démultiplexeur `concat` réencode les morceaux en un MP3 `libmp3lame` de 64 kb/s mono, sans métadonnées ni étiquette ID3 (spec §9). La durée est relue sur les trames du fichier produit, sans `ffprobe`. Délai : 2 minutes ; l'échéance globale interrompt aussi ffmpeg.
   - **Sans ffmpeg.** On retire les étiquettes ID3v2 et ID3v1 et la trame d'information Xing/Info/VBRI de chaque morceau, puis on met les trames audio bout à bout. La durée est **exacte** : nombre de trames × échantillons par trame / fréquence.
   - **Limite sans ffmpeg.** Sans encodeur, pas de réencodage : le débit reste celui de Google (la documentation de `AudioEncoding.MP3` annonce 32 kb/s, à confirmer). L'écart avec les 64 kb/s de la spec est assumé et signalé par un avertissement. Les morceaux doivent avoir le même format (version, fréquence, mono), sinon l'édition échoue.
   - **Échec de ffmpeg.** Programme introuvable, `libmp3lame` absent ou délai dépassé : on se replie sur la concaténation des trames, avec un avertissement.
   - **Détection.** `FFMPEG_PATH` s'il est défini, sinon `ffmpeg -version` dans le PATH. L'option `--no-ffmpeg` force la concaténation des trames.
3. **Ordre dans la routine : `brief:audio` avant `brief:render`.**
   - **Pourquoi avant.** L'encart audio du PDF a besoin de la durée, que `brief:render` lit dans `audio.json` (déjà en place depuis le lot 2). La spec (§5) range l'audio dans l'étape « rendu » ; on en fait une commande séparée, lancée juste avant `brief:render`.
   - **Pourquoi pas dans `run-render`.** Appeler l'audio depuis `runRender` aurait mêlé au rendu du PDF une clé Google, un disjoncteur, ffmpeg et un budget de caractères, et modifié `pipeline/render/`, que ce lot n'a pas à toucher.
   - **Entrée.** `brief:audio` lit les `{lang}.verified.json` : `brief:render` ne change pas `audioScript` (il ne fait que remplir les photos), et les `{lang}.final.json` n'existent pas encore à ce moment.
   - **Si l'audio échoue.** Le PDF est rendu quand même, sans encart : `audio.json` n'est pas écrit, et `brief:render` sait déjà s'en passer (testé dans `routine-order.test.ts`).
4. **Budget de caractères : 5 000 par édition, 15 000 par passage.**
   - **Spec.** Elle vise environ 10 000 caractères par jour, soit 300 000 par mois, sous le million gratuit. Un script de 450 mots fait environ 3 000 caractères, soit 9 000 pour trois éditions.
   - **Par édition.** 5 000 caractères, soit plus de 700 mots. Au-delà, c'est une erreur de rédaction : l'édition part sans audio plutôt que de consommer le quota.
   - **Par passage.** 15 000 caractères, toutes tentatives comprises, réussies ou non. Même atteint chaque jour, ce plafond garde le mois sous 465 000 caractères. Une édition qui ne tient plus dans le reste du budget est sautée sans appel.
   - **Pas de registre mensuel.** Dans un conteneur cloud neuf, un registre en fichier ne protège rien (leçon du lot 3) : le plafond par passage borne le mois sans état. Une relance le même jour consomme de nouveau, mais elle reste rare.
   - **Rapport.** `audio-report.json` donne `characters.sent`, les deux plafonds et les caractères de chaque édition.
5. **Codes de sortie de `brief:audio` : l'audio dégrade, il ne bloque jamais.**
   - **0** : au moins un MP3 est écrit (`status` vaut `ok`, ou `degraded` s'il en manque) ; ou bien la clé est absente (`disabled`, avec un avertissement et aucun appel).
   - **1** : la clé est présente mais aucun MP3 n'a été produit (`failed`) : clé refusée, quota, service muet, budget, échéance.
   - **2** : entrée invalide (`invalid`) : date incorrecte, `voices.json` invalide, aucune `{lang}.verified.json` lisible, ou anciens MP3 impossibles à supprimer.
   - **Contrat de la routine.** Quel que soit le code, la routine enchaîne sur `brief:render` puis `brief:publish`. Le code et le `status` ne servent qu'à la notification : « audio partiel », « audio désactivé » ou « audio en échec ».
6. **Voix : une par édition, dans `pipeline/config/voices.json`.**
   - **Par défaut.** `fr-FR-Chirp3-HD-Aoede`, `en-US-Chirp3-HD-Charon` et `es-ES-Chirp3-HD-Kore`. Ces noms suivent la forme `<langue>-Chirp3-HD-<nom>` de la documentation, mais ils sont **à confirmer par `voices.list`** : `confirmed: false` déclenche un avertissement à chaque passage jusqu'au choix de Naïm.
   - **Validation.** `languageCode` vaut fr-FR, en-US ou en-GB, es-ES, et le nom doit commencer par lui et contenir `Chirp3-HD`. `speakingRate` est facultatif (0,25 à 2).
   - **Requête.** `audioConfig` vaut `{ audioEncoding: 'MP3', speakingRate? }`. On ne fixe pas `sampleRateHertz` : la fréquence naturelle de la voix est gardée, et le contrôle de format suffit.
7. **Échantillons (`audio:samples`).** La commande appelle `voices.list` pour fr-FR, en-US, en-GB et es-ES, filtre sur « Chirp3-HD » et garde la langue exacte. Elle synthétise 3 phrases d'essai par langue : la voix configurée d'abord, puis les autres, en alternant en-US et en-GB. Elle écrit `out/voice-samples/<voix>.mp3` et `index.json`, avec la liste complète des voix. Elle ne tourne jamais dans la routine. Codes : 0 = tout écrit, 1 = en partie, 2 = rien ou pas de clé.
8. **Une seconde tentative, pas plus.** Une erreur 5xx ou réseau sur un morceau est retentée une fois. Un 4xx, une réponse invalide, une réponse trop lourde ou un délai dépassé ne sont pas retentés. Chaque échec compte pour le disjoncteur, partagé par les trois éditions.

### Points non vérifiables ici

Voir la dernière section, « À vérifier avec la vraie API ».

## Structure des fichiers

```
pipeline/audio/
  mp3.ts                trames MPEG couche III : en-tête, ID3, Xing/Info, durée, m:ss
  chunk.ts              normalisation et découpage sous 4 500 octets (phrases, propositions, mots)
  concat.ts             ffmpeg (64 kb/s mono) ou trames bout à bout ; détection de ffmpeg
  tts.ts                client Text-to-Speech : text:synthesize, voices, filtre Chirp3-HD
  voices.ts             lecture et validation de pipeline/config/voices.json
  budget.ts             plafonds de caractères (édition, passage)
  voice-edition.ts      une édition : découpage, synthèse (budget, disjoncteur, 2e tentative), concaténation
  run-audio.ts          orchestration de brief:audio : anciennes sorties, MP3, audio.json, audio-report.json
  cli.ts                npm run brief:audio
  samples.ts            échantillons de voix (mise en place)
  samples-cli.ts        npm run audio:samples
pipeline/config/voices.json          une voix Chirp 3 HD par édition (à confirmer)
pipeline/lib/fs.ts                   (modifié) writeAtomic accepte des octets
fixtures/api/tts-synthesize.json     réponse de synthèse construite (audio synthétique)
fixtures/api/tts-voices.json         réponse de voices.list construite
pipeline/test/audio/
  mp3.ts                MP3 synthétiques : trames, ID3, Xing
  fake-tts.ts           faux Text-to-Speech (synthèse, liste des voix)
  fake-tts-preload.ts   faux fetch préchargé pour les tests de CLI
  mp3, chunk, concat, tts, voices, voice-edition, run-audio, routine-order, cli, samples, samples-cli (.test.ts)
docs/setup-audio.md                  mise en place : projet Google Cloud, clé restreinte, voix
```

---

### Tâche 1 : trames MP3 et durée

**Fichiers :**
- Créer : `pipeline/audio/mp3.ts`
- Test : `pipeline/test/audio/mp3.ts` (MP3 synthétiques), `pipeline/test/audio/mp3.test.ts`

Comportement attendu :
- **En-tête.** `readFrameHeader` lit une trame MPEG-1, 2 ou 2.5 couche III (débit, fréquence, mono, longueur avec l'octet de remplissage). Il refuse la synchronisation absente, la version réservée, une autre couche, le débit libre ou interdit et la fréquence réservée.
- **Fichier.** `parseMp3` retire l'ID3v2 (taille « synchsafe », pied compris), l'ID3v1 final et la trame d'information Xing, Info ou VBRI. Il ignore une dernière trame tronquée. Il refuse les octets parasites (avec leur position), un format qui change en cours de fichier et un fichier sans audio.
- **Durée.** Elle vaut la somme des échantillons divisée par la fréquence. `formatDuration` l'écrit en m:ss, arrondie à la seconde.
- **Lot 4.** Les MP3 synthétiques passent `looksLikeMp3`.

- [ ] **Étape 1 : écrire les MP3 synthétiques et les tests**

Fichier `pipeline/test/audio/mp3.ts` :

```ts
/**
 * MP3 synthétiques pour les tests : trames couche III valides (en-tête correct, contenu nul,
 * c'est-à-dire du silence), étiquettes ID3 et trame d'information Xing. Aucun encodeur requis.
 */

export type FrameSpec = {
  /** 'mpeg2' : 24 kHz (sortie habituelle de Google TTS) ; 'mpeg1' : 44,1 kHz. */
  version?: 'mpeg1' | 'mpeg2';
  /** Débit en kb/s, présent dans la table de la version. */
  bitrate?: number;
  mono?: boolean;
};

const MPEG1 = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320];
const MPEG2 = [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160];

/**
 * Une trame : MPEG-2 à 24 kHz ou MPEG-1 à 44,1 kHz, sans CRC ni octet de remplissage. Contenu nul :
 * du silence, que ffmpeg décode. `fill` remplit le contenu après l'en-tête d'un octet reconnaissable
 * (tests de concaténation) ; la trame reste lisible par `parseMp3`, mais plus par un décodeur.
 */
export function frame(spec: FrameSpec = {}, fill = 0): Buffer {
  const version = spec.version ?? 'mpeg2';
  const bitrate = spec.bitrate ?? 32;
  const table = version === 'mpeg1' ? MPEG1 : MPEG2;
  const index = table.indexOf(bitrate);
  if (index <= 0) throw new Error(`débit ${bitrate} absent de la table ${version}`);
  const samples = version === 'mpeg1' ? 1152 : 576;
  const rate = version === 'mpeg1' ? 44100 : 24000;
  const length = Math.floor(((samples / 8) * bitrate * 1000) / rate);
  const b = Buffer.alloc(length, fill);
  b[0] = 0xff;
  b[1] = version === 'mpeg1' ? 0xfb : 0xf3;
  b[2] = (index << 4) | ((version === 'mpeg1' ? 0 : 1) << 2);
  b[3] = (spec.mono ?? true) ? 0xc4 : 0x04;
  return b;
}

/** `count` trames ; avec `fill`, le contenu de la trame i vaut `fill + i` (pour suivre l'ordre). */
export function frames(count: number, spec: FrameSpec = {}, fill = 0): Buffer {
  return Buffer.concat(Array.from({ length: count }, (_, i) => frame(spec, fill ? fill + i : 0)));
}

/** Trame d'information « Xing » (ou « Info ») placée après les informations annexes. */
export function xingFrame(spec: FrameSpec = {}, tag: 'Xing' | 'Info' = 'Xing'): Buffer {
  const f = frame(spec);
  const mono = spec.mono ?? true;
  const side = (spec.version ?? 'mpeg2') === 'mpeg1' ? (mono ? 17 : 32) : mono ? 9 : 17;
  f.write(tag, 4 + side, 'latin1');
  return f;
}

/** Étiquette ID3v2.4 de `size` octets de contenu (taille en entier « synchsafe »). */
export function id3v2(size = 20): Buffer {
  const head = Buffer.from([0x49, 0x44, 0x33, 4, 0, 0, (size >> 21) & 0x7f, (size >> 14) & 0x7f, (size >> 7) & 0x7f, size & 0x7f]);
  return Buffer.concat([head, Buffer.alloc(size, 0x41)]);
}

/** Étiquette ID3v1 (128 octets commençant par « TAG »). */
export function id3v1(): Buffer {
  const b = Buffer.alloc(128, 0x20);
  b.write('TAG', 0, 'latin1');
  return b;
}

/** MP3 tel que pourrait le renvoyer une API : ID3v2, trame Xing, `count` trames audio. */
export function apiLikeMp3(count: number, fill = 1, spec: FrameSpec = {}): Buffer {
  return Buffer.concat([id3v2(), xingFrame(spec), frames(count, spec, fill)]);
}
```

Fichier `pipeline/test/audio/mp3.test.ts` :

```ts
import { describe, expect, it } from 'vitest';
import { formatDuration, id3v2Size, mp3Seconds, Mp3FormatError, parseMp3, readFrameHeader } from '../../audio/mp3';
import { looksLikeMp3 } from '../../publish/files';
import { apiLikeMp3, frame, frames, id3v1, id3v2, xingFrame } from './mp3';

describe('readFrameHeader', () => {
  it('lit une trame MPEG-2 couche III à 24 kHz, 32 kb/s, mono (96 octets, 576 échantillons)', () => {
    expect(readFrameHeader(frame(), 0)).toEqual({ version: 'mpeg2', bitrate: 32, sampleRate: 24000, samples: 576, mono: true, length: 96 });
  });

  it('lit une trame MPEG-1 à 44,1 kHz, 128 kb/s, stéréo (417 octets, 1152 échantillons)', () => {
    expect(readFrameHeader(frame({ version: 'mpeg1', bitrate: 128, mono: false }), 0)).toEqual({ version: 'mpeg1', bitrate: 128, sampleRate: 44100, samples: 1152, mono: false, length: 417 });
  });

  it('compte l’octet de remplissage', () => {
    const f = frame({ version: 'mpeg1', bitrate: 128 });
    f[2] |= 0x02;
    expect(readFrameHeader(f, 0)?.length).toBe(418);
  });

  it('refuse ce qui n’est pas une trame couche III valide', () => {
    const bad = (patch: (b: Buffer) => void) => {
      const f = frame();
      patch(f);
      return readFrameHeader(f, 0);
    };
    expect(bad((b) => (b[0] = 0xfe))).toBeNull(); // pas de synchronisation
    expect(bad((b) => (b[1] = 0xeb))).toBeNull(); // version réservée
    expect(bad((b) => (b[1] = 0xf5))).toBeNull(); // couche II
    expect(bad((b) => (b[2] = 0x04))).toBeNull(); // débit libre
    expect(bad((b) => (b[2] = 0xf4))).toBeNull(); // débit interdit
    expect(bad((b) => (b[2] = 0x4c))).toBeNull(); // fréquence réservée
    expect(readFrameHeader(Buffer.from([0xff, 0xf3]), 0)).toBeNull(); // en-tête incomplet
  });
});

describe('parseMp3', () => {
  it('compte les trames et la durée : 125 trames de 576 échantillons à 24 kHz = 3 s', () => {
    const p = parseMp3(frames(125));
    expect([p.frames.length, p.seconds, p.sampleRate, p.mono, p.infoFrame]).toEqual([125, 3, 24000, true, false]);
  });

  it('retire l’étiquette ID3v2, la trame Xing et l’étiquette ID3v1', () => {
    const p = parseMp3(Buffer.concat([apiLikeMp3(10), id3v1()]));
    expect(p.frames.length).toBe(10);
    expect(p.infoFrame).toBe(true);
    expect(p.frames.every((f) => f[0] === 0xff && f[4] !== 0)).toBe(true);
  });

  it('reconnaît aussi une trame « Info » (MP3 à débit constant)', () => {
    expect(parseMp3(Buffer.concat([xingFrame({}, 'Info'), frames(3)])).frames.length).toBe(3);
  });

  it('ignore une dernière trame tronquée', () => {
    const b = Buffer.concat([frames(4), frame().subarray(0, 50)]);
    expect(parseMp3(b).frames.length).toBe(4);
  });

  it('refuse des octets qui ne sont pas des trames, un mélange de formats ou un fichier sans audio', () => {
    expect(() => parseMp3(Buffer.concat([frames(2), Buffer.from('nimporte quoi, assez long pour un en-tête')]))).toThrow(/trame MP3 attendue à l'octet 192/);
    expect(() => parseMp3(Buffer.concat([frames(2), frame({ version: 'mpeg1', bitrate: 64 })]))).toThrow(/format de trame changeant/);
    expect(() => parseMp3(Buffer.concat([frames(2), frame({ mono: false })]))).toThrow(/format de trame changeant/);
    expect(() => parseMp3(id3v2())).toThrow(Mp3FormatError);
    expect(() => parseMp3(Buffer.concat([id3v2(), xingFrame()]))).toThrow(/aucune trame audio/);
    expect(() => parseMp3(Buffer.alloc(0))).toThrow(/aucune trame audio/);
  });

  it('id3v2Size lit la taille « synchsafe » et refuse un octet de taille invalide', () => {
    expect(id3v2Size(id3v2(300))).toBe(310);
    expect(id3v2Size(frame())).toBe(0);
    const bad = id3v2(10);
    bad[7] = 0x80;
    expect(() => id3v2Size(bad)).toThrow(/ID3 invalide/);
  });

  it('les MP3 synthétiques passent le contrôle de la publication (lot 4)', () => {
    expect(looksLikeMp3(frames(2))).toBe(true);
    expect(looksLikeMp3(apiLikeMp3(2))).toBe(true);
    expect(looksLikeMp3(frame({ version: 'mpeg1', bitrate: 64 }))).toBe(true);
  });
});

describe('durée', () => {
  it('mp3Seconds additionne les trames audio seulement', () => {
    expect(mp3Seconds(apiLikeMp3(250))).toBe(6);
  });

  it('formatDuration écrit m:ss, arrondi à la seconde', () => {
    expect(formatDuration(204)).toBe('3:24');
    expect(formatDuration(59.6)).toBe('1:00');
    expect(formatDuration(5.4)).toBe('0:05');
    expect(formatDuration(3725)).toBe('62:05');
    expect(formatDuration(-1)).toBe('0:00');
  });
});
```

- [ ] **Étape 2 : vérifier l'échec**

Commande : `npx vitest run pipeline/test/audio/mp3.test.ts`
Attendu : échec, « Failed to load url ../../audio/mp3 », `Test Files  1 failed (1)`.

- [ ] **Étape 3 : écrire le lecteur de trames**

Fichier `pipeline/audio/mp3.ts` :

```ts
/**
 * Lecture des trames MPEG audio couche III (MP3), sans dépendance : en-têtes, étiquettes ID3,
 * trame d'information Xing/Info/VBRI et durée. Sert à la concaténation sans ffmpeg et à mesurer
 * la durée de tout MP3 produit.
 */

export type MpegVersion = 'mpeg1' | 'mpeg2' | 'mpeg2.5';

export type FrameHeader = {
  version: MpegVersion;
  /** Débit en kb/s. */
  bitrate: number;
  sampleRate: number;
  /** Échantillons par trame : 1152 (MPEG-1) ou 576 (MPEG-2 et 2.5). */
  samples: number;
  mono: boolean;
  /** Longueur de la trame en octets, en-tête compris. */
  length: number;
};

export type ParsedMp3 = {
  /** Trames audio, sans étiquette ni trame d'information. */
  frames: Uint8Array[];
  sampleRate: number;
  version: MpegVersion;
  mono: boolean;
  /** Durée en secondes (nombre d'échantillons / fréquence). */
  seconds: number;
  /** Trame d'information (Xing, Info ou VBRI) retirée. */
  infoFrame: boolean;
};

/** Débits de la couche III (kb/s), index 1 à 14 ; 0 (format libre) et 15 sont refusés. */
const BITRATES: Record<'mpeg1' | 'mpeg2', number[]> = {
  mpeg1: [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320],
  mpeg2: [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160],
};
const SAMPLE_RATES: Record<MpegVersion, number[]> = {
  mpeg1: [44100, 48000, 32000],
  mpeg2: [22050, 24000, 16000],
  'mpeg2.5': [11025, 12000, 8000],
};

/** Erreur de format MP3 ; le message donne la position fautive, jamais le contenu. */
export class Mp3FormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'Mp3FormatError';
  }
}

/** En-tête de trame couche III à la position `at`, ou null s'il n'y en a pas de valide. */
export function readFrameHeader(b: Uint8Array, at: number): FrameHeader | null {
  if (at + 4 > b.length) return null;
  const b1 = b[at + 1];
  const b2 = b[at + 2];
  const b3 = b[at + 3];
  if (b[at] !== 0xff || (b1 & 0xe0) !== 0xe0) return null;
  const v = (b1 >> 3) & 3;
  if (v === 1) return null; // version réservée
  if (((b1 >> 1) & 3) !== 1) return null; // couche III seulement
  const version: MpegVersion = v === 3 ? 'mpeg1' : v === 2 ? 'mpeg2' : 'mpeg2.5';
  const bitrateIndex = b2 >> 4;
  const srIndex = (b2 >> 2) & 3;
  if (bitrateIndex === 0 || bitrateIndex === 15 || srIndex === 3) return null;
  const bitrate = BITRATES[version === 'mpeg1' ? 'mpeg1' : 'mpeg2'][bitrateIndex];
  const sampleRate = SAMPLE_RATES[version][srIndex];
  const padding = (b2 >> 1) & 1;
  const samples = version === 'mpeg1' ? 1152 : 576;
  const length = Math.floor(((samples / 8) * bitrate * 1000) / sampleRate) + padding;
  return { version, bitrate, sampleRate, samples, mono: b3 >> 6 === 3, length };
}

/** Taille de l'étiquette ID3v2 en tête (10 octets d'en-tête, pied éventuel compris), ou 0. */
export function id3v2Size(b: Uint8Array): number {
  if (b.length < 10 || b[0] !== 0x49 || b[1] !== 0x44 || b[2] !== 0x33) return 0;
  if ((b[6] | b[7] | b[8] | b[9]) & 0x80) throw new Mp3FormatError('étiquette ID3 invalide');
  const size = (b[6] << 21) | (b[7] << 14) | (b[8] << 7) | b[9];
  return 10 + size + (b[5] & 0x10 ? 10 : 0);
}

/** Vrai si la trame porte une étiquette Xing, Info (après les informations annexes) ou VBRI (à 36 octets). */
function isInfoFrame(frame: Uint8Array, h: FrameHeader): boolean {
  const side = h.version === 'mpeg1' ? (h.mono ? 17 : 32) : h.mono ? 9 : 17;
  const tag = (at: number) => String.fromCharCode(...frame.subarray(at, at + 4));
  const xing = tag(4 + side);
  return xing === 'Xing' || xing === 'Info' || tag(36) === 'VBRI';
}

/**
 * Découpe un MP3 en trames audio. Les étiquettes ID3v2 (en tête) et ID3v1 (128 derniers octets)
 * et la trame d'information sont retirées ; une dernière trame tronquée est ignorée. Lève
 * Mp3FormatError si les octets ne sont pas une suite de trames couche III de même format.
 */
export function parseMp3(bytes: Uint8Array): ParsedMp3 {
  let end = bytes.length;
  if (end >= 128 && bytes[end - 128] === 0x54 && bytes[end - 127] === 0x41 && bytes[end - 126] === 0x47) end -= 128;
  let at = id3v2Size(bytes);
  const frames: Uint8Array[] = [];
  let first: FrameHeader | null = null;
  let infoFrame = false;
  let samples = 0;
  while (at < end) {
    const h = readFrameHeader(bytes, at);
    if (!h) throw new Mp3FormatError(`trame MP3 attendue à l'octet ${at}`);
    if (at + h.length > end) break; // dernière trame tronquée
    const frame = bytes.subarray(at, at + h.length);
    if (first && (h.version !== first.version || h.sampleRate !== first.sampleRate || h.mono !== first.mono)) {
      throw new Mp3FormatError(`format de trame changeant à l'octet ${at}`);
    }
    if (!first && isInfoFrame(frame, h)) infoFrame = true;
    else {
      frames.push(frame);
      samples += h.samples;
    }
    first ??= h;
    at += h.length;
  }
  if (!first || frames.length === 0) throw new Mp3FormatError('aucune trame audio');
  return { frames, sampleRate: first.sampleRate, version: first.version, mono: first.mono, seconds: samples / first.sampleRate, infoFrame };
}

/** Durée en secondes d'un MP3 (somme des trames audio). */
export const mp3Seconds = (bytes: Uint8Array): number => parseMp3(bytes).seconds;

/** Durée au format m:ss (« 3:24 »), arrondie à la seconde. */
export function formatDuration(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
```

- [ ] **Étape 4 : vérifier le succès**

Commande : `npx vitest run pipeline/test/audio/mp3.test.ts`
Attendu : `Test Files  1 passed (1)` et `Tests  13 passed (13)`.

Commande : `npm test && npm run typecheck`
Attendu : `Test Files  68 passed (68)`, `Tests  729 passed (729)`, et `tsc` sans sortie.

- [ ] **Étape 5 : commit**

```bash
git add pipeline/audio/mp3.ts pipeline/test/audio/mp3.ts pipeline/test/audio/mp3.test.ts
git commit -m "feat(audio): lecture des trames MP3 et durée"
```

---

### Tâche 2 : découpage du script

**Fichiers :**
- Créer : `pipeline/audio/chunk.ts`
- Test : `pipeline/test/audio/chunk.test.ts`

Comportement attendu :
- **Normalisation.** Le texte passe en forme NFC, et toute suite d'espaces (insécables et fines comprises) devient une espace simple.
- **Limites.** Aucun morceau ne dépasse 4 500 octets UTF-8 ; une limite au-dessus des 5 000 octets de l'API est refusée.
- **Découpe.** Elle se fait aux fins de phrase, puis aux virgules, points-virgules, deux-points et tirets, puis entre les mots. Un mot n'est jamais coupé, et les abréviations et initiales ne terminent pas une phrase.
- **Ponctuation.** Guillemets français, `¿`, `¡` et ponctuation précédée d'une espace restent avec leur mot.
- **Fidélité.** Les morceaux recollés par une espace redonnent le texte normalisé, et `billedChars` compte les points de code.
- **Fixture.** Les scripts de la fixture tiennent chacun en un morceau.

- [ ] **Étape 1 : écrire les tests**

Fichier `pipeline/test/audio/chunk.test.ts` :

```ts
import { describe, expect, it } from 'vitest';
import { billedChars, chunkScript, MAX_CHUNK_BYTES, normalizeScript, TTS_MAX_REQUEST_BYTES, utf8Bytes } from '../../audio/chunk';
import { fixtureEdition } from '../helpers';

/** Propriétés de tout découpage : sous la limite, rien de perdu, aucun mot coupé. */
function expectSound(text: string, chunks: string[], max: number) {
  for (const c of chunks) {
    expect(utf8Bytes(c)).toBeLessThanOrEqual(max);
    expect(c).toBe(c.trim());
    expect(c).not.toBe('');
  }
  expect(chunks.join(' ')).toBe(normalizeScript(text));
}

describe('normalizeScript', () => {
  it('ramène toute suite d’espaces (insécables, fines, retours à la ligne) à une espace', () => {
    expect(normalizeScript('  Bonjour !\n\n« Daily\tBrief »  ')).toBe('Bonjour ! « Daily Brief »');
  });

  it('compose les accents (NFC)', () => {
    expect(normalizeScript('été')).toBe('été');
  });
});

describe('chunkScript', () => {
  it('limite de l’API : 5 000 octets ; morceaux de 4 500 octets au plus', () => {
    expect([TTS_MAX_REQUEST_BYTES, MAX_CHUNK_BYTES]).toEqual([5000, 4500]);
    expect(() => chunkScript('Bonjour.', 6000)).toThrow(/au-dessus de celle de l'API/);
  });

  it('un script court donne un seul morceau ; un script vide aucun', () => {
    expect(chunkScript('Bonjour. Voici le brief.')).toEqual(['Bonjour. Voici le brief.']);
    expect(chunkScript(' \n ')).toEqual([]);
  });

  it('les scripts de la fixture tiennent chacun en un morceau', () => {
    for (const lang of ['fr', 'en', 'es'] as const) {
      const script = fixtureEdition(lang).audioScript;
      const chunks = chunkScript(script);
      expect(chunks).toHaveLength(1);
      expectSound(script, chunks, MAX_CHUNK_BYTES);
    }
  });

  it('coupe aux fins de phrase : aucune phrase coupée quand chacune tient', () => {
    const sentences = Array.from({ length: 40 }, (_, i) => `Phrase numéro ${i + 1}, qui parle d’économie et de société.`);
    const text = sentences.join(' ');
    const chunks = chunkScript(text, 300);
    expect(chunks.length).toBeGreaterThan(5);
    expectSound(text, chunks, 300);
    for (const c of chunks) expect(c).toMatch(/\.$/);
    expect(chunks.flatMap((c) => c.match(/Phrase numéro \d+, qui parle d’économie et de société\./g) ?? [])).toEqual(sentences);
  });

  it('ne coupe pas après une abréviation ni une initiale', () => {
    const text = 'M. Macron a reçu J. D. Vance. Les EE. UU. ont répondu. Dr. Smith a signé.';
    expect(chunkScript(text, 40)).toEqual(['M. Macron a reçu J. D. Vance.', 'Les EE. UU. ont répondu.', 'Dr. Smith a signé.']);
  });

  it('une phrase trop longue est coupée aux virgules, puis entre les mots', () => {
    const text = `${'alpha beta gamma, '.repeat(20)}fin. Puis ${'mot '.repeat(60)}final.`;
    const chunks = chunkScript(text, 100);
    expectSound(text, chunks, 100);
    expect(chunks[0]).toMatch(/,$/);
  });

  it('garde les guillemets français et la ponctuation espagnole avec leur mot', () => {
    const fr = '« Nous ne céderons pas » , a-t-il dit . Puis : « Jamais ! »';
    const es = '¿ Qué pasará mañana ? ¡ Nadie lo sabe ! El Gobierno , sin embargo , confía .';
    for (const [text, max] of [
      [fr, 30],
      [es, 25],
    ] as const) {
      const chunks = chunkScript(text, max);
      expectSound(text, chunks, max);
      for (const c of chunks) expect(c).not.toMatch(/^[»!?,.:;]|[«¿¡]$/);
    }
    expect(chunkScript(es, 25)).toEqual(['¿ Qué pasará mañana ?', '¡ Nadie lo sabe !', 'El Gobierno ,', 'sin embargo , confía .']);
  });

  it('compte les octets UTF-8, pas les caractères', () => {
    const text = 'é'.repeat(30) + ' ' + 'é'.repeat(30);
    expect(chunkScript(text, 70)).toEqual(['é'.repeat(30), 'é'.repeat(30)]);
  });

  it('refuse un mot plus long que la limite plutôt que de le couper', () => {
    expect(() => chunkScript(`Début ${'x'.repeat(50)} fin.`, 40)).toThrow(/mot de 50 octets/);
  });

  it('un script de 450 mots se découpe sous la limite réelle sans rien perdre', () => {
    const text = Array.from({ length: 45 }, (_, i) => `Le sujet ${i} évoque la réforme « des retraites », le budget et l’Europe.`).join(' ');
    const chunks = chunkScript(text);
    expectSound(text, chunks, MAX_CHUNK_BYTES);
    expect(billedChars(chunks.join(' '))).toBe(billedChars(normalizeScript(text)));
  });

  it('billedChars compte les points de code', () => {
    expect(billedChars('été 😀')).toBe(5);
  });
});
```

- [ ] **Étape 2 : vérifier l'échec**

Commande : `npx vitest run pipeline/test/audio/chunk.test.ts`
Attendu : échec, « Failed to load url ../../audio/chunk », `Test Files  1 failed (1)`.

- [ ] **Étape 3 : écrire le découpage**

Fichier `pipeline/audio/chunk.ts` :

```ts
/**
 * Découpage d'un `audioScript` en morceaux sous la limite d'une requête Text-to-Speech.
 *
 * La documentation de Google Cloud Text-to-Speech fixe 5 000 octets de texte par requête
 * `text:synthesize` (quotas et limites). On vise 4 500 octets UTF-8 (10 % de marge, consigne de
 * la feuille de route) : un accent compte deux octets, une espace insécable aussi.
 */

/** Limite documentée d'une requête (octets de texte). */
export const TTS_MAX_REQUEST_BYTES = 5000;
/** Taille maximale d'un morceau (octets UTF-8). */
export const MAX_CHUNK_BYTES = 4500;

export const utf8Bytes = (s: string): number => Buffer.byteLength(s, 'utf8');

/** Nombre de caractères facturés (points de code, espaces comprises). */
export const billedChars = (s: string): number => [...s].length;

/**
 * Texte normalisé : forme NFC, toute suite d'espaces (espaces insécables, fines, tabulations et
 * retours à la ligne compris) ramenée à une espace simple, sans espace en tête ni en fin.
 */
export function normalizeScript(text: string): string {
  return text.normalize('NFC').replace(/[\s   ⁠﻿]+/gu, ' ').trim();
}

/** Ponctuation isolée qui s'accroche au mot suivant : « ¿ ¡ ( [ “ ‘ et les guillemets droits. */
const OPENING = /^[«¿¡(\[“‘"']+$/u;
/** Ponctuation isolée qui s'accroche au mot précédent : » : ; ! ? , . … ) ] ” ’ et les tirets. */
const CLOSING = /^[»:;!?,.…)\]”’\-—–]+$/u;
/** Fin de phrase : . ! ? … éventuellement suivis de guillemets ou parenthèses fermants. */
const SENTENCE_END = /[.!?…]+[»”’"')\]]*$/u;
/** Fin de proposition : virgule, point-virgule, deux-points ou tiret. */
const CLAUSE_END = /(?:[,;:]|[—–])[»”’"')\]]*$/u;
/** Abréviations courantes (FR, EN, ES) qui ne terminent pas une phrase. */
const ABBREVIATIONS = new Set(['m.', 'mm.', 'mme.', 'mmes.', 'mlle.', 'dr.', 'pr.', 'st.', 'mr.', 'mrs.', 'ms.', 'sr.', 'sra.', 'srta.', 'dña.', 'd.', 'ee.', 'uu.', 'p.', 'ex.', 'cf.', 'vs.', 'no.', 'n.º', 'art.', 'av.', 'gen.', 'gov.', 'sen.', 'rep.']);

/** Mots du texte normalisé, la ponctuation isolée (« « », « ? », « — ») accrochée à son voisin. */
function words(text: string): string[] {
  const out: string[] = [];
  let pending = '';
  for (const raw of text.split(' ')) {
    if (raw === '') continue;
    if (OPENING.test(raw)) {
      pending += (pending ? ' ' : '') + raw;
      continue;
    }
    const w = pending ? `${pending} ${raw}` : raw;
    pending = '';
    if (CLOSING.test(raw) && out.length > 0) out[out.length - 1] += ` ${w}`;
    else out.push(w);
  }
  if (pending) {
    if (out.length > 0) out[out.length - 1] += ` ${pending}`;
    else out.push(pending);
  }
  return out;
}

/** Vrai si le mot clôt une phrase (et n'est ni une abréviation ni une initiale). */
function endsSentence(word: string): boolean {
  if (!SENTENCE_END.test(word)) return false;
  const last = word.split(' ').pop()!.toLowerCase();
  if (ABBREVIATIONS.has(last)) return false;
  return !/^\p{Lu}\.$/u.test(word.split(' ').pop()!); // initiale : « J. »
}

/** Regroupe les mots en segments, coupés après chaque mot qui vérifie `cut`. */
function group(ws: string[], cut: (w: string) => boolean): string[][] {
  const out: string[][] = [];
  let cur: string[] = [];
  for (const w of ws) {
    cur.push(w);
    if (cut(w)) {
      out.push(cur);
      cur = [];
    }
  }
  if (cur.length) out.push(cur);
  return out;
}

/** Unités à empaqueter : la phrase si elle tient, sinon ses propositions, sinon ses mots. */
function units(ws: string[], max: number): string[] {
  const out: string[] = [];
  for (const sentence of group(ws, endsSentence)) {
    const s = sentence.join(' ');
    if (utf8Bytes(s) <= max) {
      out.push(s);
      continue;
    }
    for (const clause of group(sentence, (w) => CLAUSE_END.test(w))) {
      const c = clause.join(' ');
      if (utf8Bytes(c) <= max) out.push(c);
      else
        for (const w of clause) {
          if (utf8Bytes(w) > max) throw new Error(`mot de ${utf8Bytes(w)} octets : impossible à découper sous ${max} octets`);
          out.push(w);
        }
    }
  }
  return out;
}

/**
 * Découpe le texte en morceaux d'au plus `maxBytes` octets UTF-8. Les phrases entières sont
 * regroupées tant qu'elles tiennent ; une phrase trop longue est coupée aux virgules,
 * points-virgules, deux-points ou tirets, puis entre les mots. Un mot n'est jamais coupé, et la
 * ponctuation isolée (« guillemets », ¿ ¡, ? !) reste avec son mot. Les morceaux recollés par une
 * espace redonnent exactement `normalizeScript(text)`.
 */
export function chunkScript(text: string, maxBytes = MAX_CHUNK_BYTES): string[] {
  if (maxBytes > TTS_MAX_REQUEST_BYTES) throw new Error(`limite de ${maxBytes} octets au-dessus de celle de l'API (${TTS_MAX_REQUEST_BYTES})`);
  const ws = words(normalizeScript(text));
  const chunks: string[] = [];
  let cur = '';
  for (const u of units(ws, maxBytes)) {
    const next = cur ? `${cur} ${u}` : u;
    if (utf8Bytes(next) <= maxBytes) cur = next;
    else {
      chunks.push(cur);
      cur = u;
    }
  }
  if (cur) chunks.push(cur);
  return chunks;
}
```

- [ ] **Étape 4 : vérifier le succès**

Commande : `npx vitest run pipeline/test/audio/chunk.test.ts`
Attendu : `Test Files  1 passed (1)` et `Tests  13 passed (13)`.

Commande : `npm test && npm run typecheck`
Attendu : `Test Files  69 passed (69)`, `Tests  742 passed (742)`, et `tsc` sans sortie.

- [ ] **Étape 5 : commit**

```bash
git add pipeline/audio/chunk.ts pipeline/test/audio/chunk.test.ts
git commit -m "feat(audio): découpage du script sous la limite de Text-to-Speech"
```

---

### Tâche 3 : concaténation, avec ou sans ffmpeg

**Fichiers :**
- Créer : `pipeline/audio/concat.ts`
- Test : `pipeline/test/audio/concat.test.ts`

Comportement attendu :
- **Sans ffmpeg.** Les trames audio sont mises bout à bout, dans l'ordre, sans étiquette ni trame Xing, et la durée suit le nombre de trames. Des formats différents, un morceau illisible ou une liste vide sont refusés, avec le numéro du morceau.
- **Avec ffmpeg.** Deux vrais MP3 (sinusoïdes produites par ffmpeg dans le test) deviennent un MP3 de 64 kb/s mono, sans ID3. Sa durée, relue sur les trames, vaut 1,5 s à 0,1 s près.
- **Repli.** Si ffmpeg échoue, on concatène les trames avec un avertissement d'une ligne. `findFfmpeg` renvoie null pour un `FFMPEG_PATH` qui ne répond pas.
- **Lot 4.** Toutes les sorties passent `looksLikeMp3`. Les 4 tests qui ont besoin de ffmpeg sont ignorés s'il est absent.

- [ ] **Étape 1 : écrire les tests**

Fichier `pipeline/test/audio/concat.test.ts` :

```ts
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { concatFrames, concatMp3, concatWithFfmpeg, findFfmpeg } from '../../audio/concat';
import { parseMp3, readFrameHeader } from '../../audio/mp3';
import { looksLikeMp3 } from '../../publish/files';
import { apiLikeMp3, frame, frames, id3v1, xingFrame } from './mp3';

const FFMPEG = findFfmpeg();

/** Vrai MP3 produit par ffmpeg : sinusoïde mono à 24 kHz, 32 kb/s (proche de la sortie de Google TTS). */
function realMp3(seconds: number, hz: number): Buffer {
  const out = join(mkdtempSync(join(tmpdir(), 'mp3-')), 'tone.mp3');
  execFileSync(FFMPEG!, ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', `sine=frequency=${hz}:duration=${seconds}`, '-ac', '1', '-ar', '24000', '-c:a', 'libmp3lame', '-b:a', '32k', out]);
  return readFileSync(out);
}

describe('concatFrames (sans ffmpeg)', () => {
  it('met les trames audio bout à bout, dans l’ordre, sans étiquette ni trame Xing', () => {
    const r = concatFrames([apiLikeMp3(3, 10), Buffer.concat([apiLikeMp3(2, 20), id3v1()])]);
    expect(r.method).toBe('frames');
    expect(r.bytes.length).toBe(5 * 96);
    expect([0, 1, 2, 3, 4].map((i) => r.bytes[i * 96 + 50])).toEqual([10, 11, 12, 20, 21]);
    expect(r.seconds).toBeCloseTo((5 * 576) / 24000, 6);
    expect(looksLikeMp3(r.bytes)).toBe(true);
    expect(parseMp3(r.bytes).infoFrame).toBe(false);
  });

  it('la durée suit le nombre de trames : 2 × 1 000 trames à 24 kHz = 48 s', () => {
    expect(concatFrames([frames(1000), frames(1000)]).seconds).toBe(48);
  });

  it('refuse des morceaux de formats différents, un morceau illisible ou une liste vide', () => {
    expect(() => concatFrames([frames(2), frames(2, { version: 'mpeg1', bitrate: 64 })])).toThrow(/morceau 2 : format différent/);
    expect(() => concatFrames([frames(2), Buffer.from('<html>erreur</html>')])).toThrow(/morceau 2 : trame MP3 attendue/);
    expect(() => concatFrames([Buffer.concat([xingFrame()])])).toThrow(/morceau 1 : aucune trame audio/);
    expect(() => concatFrames([])).toThrow(/aucun morceau/);
  });
});

describe('concatMp3', () => {
  it('sans ffmpeg : concaténation des trames', async () => {
    const r = await concatMp3([frames(4), frames(4)], null);
    expect([r.method, r.bytes.length, r.warnings]).toEqual(['frames', 8 * 96, []]);
  });

  it('ffmpeg en échec (programme absent) : repli sur les trames avec un avertissement', async () => {
    const r = await concatMp3([frames(4), frames(4)], '/chemin/inexistant/ffmpeg');
    expect(r.method).toBe('frames');
    expect(r.bytes.length).toBe(8 * 96);
    expect(r.warnings).toHaveLength(1);
    expect(r.warnings[0]).toMatch(/^ffmpeg en échec \(.+\) : trames concaténées sans réencodage$/);
  });

  it('findFfmpeg : un FFMPEG_PATH qui ne répond pas donne null', () => {
    expect(findFfmpeg({ FFMPEG_PATH: '/chemin/inexistant/ffmpeg' })).toBeNull();
  });
});

describe.skipIf(!FFMPEG)('avec ffmpeg (ignoré si ffmpeg est absent)', () => {
  it('réencode deux vrais MP3 en un MP3 64 kb/s mono, durée exacte relue sur les trames', async () => {
    const r = await concatWithFfmpeg([realMp3(1, 440), realMp3(0.5, 660)], FFMPEG!);
    expect(r.method).toBe('ffmpeg');
    expect(looksLikeMp3(r.bytes)).toBe(true);
    expect(r.seconds).toBeGreaterThan(1.45);
    expect(r.seconds).toBeLessThan(1.65);
    const p = parseMp3(r.bytes);
    expect([p.mono, p.sampleRate]).toEqual([true, 24000]);
    expect(readFrameHeader(p.frames[1], 0)?.bitrate).toBe(64);
    expect(r.bytes.subarray(0, 3).toString('latin1')).not.toBe('ID3');
  }, 30_000);

  it('concatMp3 choisit ffmpeg quand il est présent', async () => {
    const r = await concatMp3([realMp3(0.5, 440), realMp3(0.5, 440)], FFMPEG);
    expect([r.method, r.warnings]).toEqual(['ffmpeg', []]);
  }, 30_000);

  it('la concaténation des trames lit aussi de vrais MP3 (étiquette et trame Info de LAME)', () => {
    const r = concatFrames([realMp3(1, 440), realMp3(0.5, 660)]);
    expect(looksLikeMp3(r.bytes)).toBe(true);
    expect(r.seconds).toBeGreaterThan(1.45);
    expect(r.seconds).toBeLessThan(1.65);
  }, 30_000);

  it('ffmpeg refuse un morceau qui n’est pas un MP3 : repli sur les trames, qui le refusent aussi', async () => {
    await expect(concatMp3([frame(), Buffer.from('pas un mp3')], FFMPEG)).rejects.toThrow(/morceau 2/);
  }, 30_000);
});
```

- [ ] **Étape 2 : vérifier l'échec**

Commande : `npx vitest run pipeline/test/audio/concat.test.ts`
Attendu : échec, « Failed to load url ../../audio/concat », `Test Files  1 failed (1)`.

- [ ] **Étape 3 : écrire la concaténation**

Fichier `pipeline/audio/concat.ts` :

```ts
import { execFile, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { parseMp3 } from './mp3';

const run = promisify(execFile);

/** Débit de sortie visé (spec §9) : 64 kb/s, mono. */
export const TARGET_BITRATE = '64k';
/** Délai d'un appel à ffmpeg. */
export const FFMPEG_TIMEOUT_MS = 120_000;

export type ConcatMethod = 'ffmpeg' | 'frames';

export type ConcatResult = {
  bytes: Buffer;
  /** Durée mesurée sur les trames du fichier produit. */
  seconds: number;
  method: ConcatMethod;
  /** Repli sur la concaténation des trames après un échec de ffmpeg (message court). */
  warnings: string[];
};

/**
 * Chemin de ffmpeg : `FFMPEG_PATH` s'il est défini, sinon `ffmpeg` s'il répond à `-version`
 * dans le PATH, sinon null (le conteneur de la routine peut ne pas l'avoir, spec §16).
 */
export function findFfmpeg(env: NodeJS.ProcessEnv = process.env): string | null {
  const candidate = env.FFMPEG_PATH?.trim() || 'ffmpeg';
  const r = spawnSync(candidate, ['-hide_banner', '-version'], { stdio: 'ignore', timeout: 10_000 });
  return r.status === 0 ? candidate : null;
}

/**
 * Concaténation sans ffmpeg : étiquettes ID3 et trames Xing/Info retirées, trames audio mises
 * bout à bout. Les morceaux doivent avoir le même format (version, fréquence, mono) ; le débit
 * reste celui de la source (pas de réencodage possible sans encodeur).
 */
export function concatFrames(chunks: Uint8Array[]): ConcatResult {
  if (chunks.length === 0) throw new Error('aucun morceau à concaténer');
  const parsed = chunks.map((c, i) => {
    try {
      return parseMp3(c);
    } catch (e) {
      throw new Error(`morceau ${i + 1} : ${(e as Error).message}`);
    }
  });
  const first = parsed[0];
  parsed.forEach((p, i) => {
    if (p.version !== first.version || p.sampleRate !== first.sampleRate || p.mono !== first.mono) {
      throw new Error(`morceau ${i + 1} : format différent du premier (${p.sampleRate} Hz contre ${first.sampleRate} Hz)`);
    }
  });
  const bytes = Buffer.concat(parsed.flatMap((p) => p.frames));
  return { bytes, seconds: parsed.reduce((s, p) => s + p.seconds, 0), method: 'frames', warnings: [] };
}

/**
 * Concaténation par ffmpeg (démultiplexeur `concat`), réencodée en MP3 64 kb/s mono, sans
 * métadonnées ni étiquette ID3. La durée est relue sur les trames du fichier produit.
 */
export async function concatWithFfmpeg(chunks: Uint8Array[], ffmpeg: string, opts: { timeoutMs?: number; signal?: AbortSignal } = {}): Promise<ConcatResult> {
  if (chunks.length === 0) throw new Error('aucun morceau à concaténer');
  const dir = mkdtempSync(join(tmpdir(), 'brief-audio-'));
  try {
    const names = chunks.map((c, i) => {
      const name = `chunk-${String(i).padStart(3, '0')}.mp3`;
      writeFileSync(join(dir, name), c);
      return name;
    });
    writeFileSync(join(dir, 'list.txt'), names.map((n) => `file '${n}'\n`).join(''));
    const args = ['-hide_banner', '-nostdin', '-loglevel', 'error', '-y', '-f', 'concat', '-safe', '0', '-i', 'list.txt', '-vn', '-map_metadata', '-1', '-ac', '1', '-c:a', 'libmp3lame', '-b:a', TARGET_BITRATE, '-id3v2_version', '0', '-f', 'mp3', 'out.mp3'];
    await run(ffmpeg, args, { cwd: dir, timeout: opts.timeoutMs ?? FFMPEG_TIMEOUT_MS, signal: opts.signal, maxBuffer: 1024 * 1024 });
    const bytes = readFileSync(join(dir, 'out.mp3'));
    return { bytes, seconds: parseMp3(bytes).seconds, method: 'ffmpeg', warnings: [] };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** Première ligne d'une erreur de ffmpeg, bornée (jamais la sortie complète). */
function ffmpegError(e: unknown): string {
  const err = e as { killed?: boolean; code?: unknown; stderr?: string; message?: string };
  if (err.killed) return 'délai dépassé';
  const line = (err.stderr || err.message || String(e)).split('\n').find((l) => l.trim()) ?? 'erreur inconnue';
  return line.trim().slice(0, 200);
}

/**
 * Concatène les morceaux MP3 : avec ffmpeg s'il est disponible (64 kb/s mono), sinon, ou si
 * ffmpeg échoue, par concaténation des trames (avec un avertissement dans le second cas).
 */
export async function concatMp3(chunks: Uint8Array[], ffmpeg: string | null, opts: { timeoutMs?: number; signal?: AbortSignal } = {}): Promise<ConcatResult> {
  if (ffmpeg) {
    try {
      return await concatWithFfmpeg(chunks, ffmpeg, opts);
    } catch (e) {
      if (opts.signal?.aborted) throw e;
      const r = concatFrames(chunks);
      return { ...r, warnings: [`ffmpeg en échec (${ffmpegError(e)}) : trames concaténées sans réencodage`] };
    }
  }
  return concatFrames(chunks);
}
```

- [ ] **Étape 4 : vérifier le succès**

Commande : `npx vitest run pipeline/test/audio/concat.test.ts`
Attendu : `Test Files  1 passed (1)` et `Tests  10 passed (10)` (sans ffmpeg : `Tests  6 passed | 4 skipped (10)`).

Commande : `npm test && npm run typecheck`
Attendu : `Test Files  70 passed (70)`, `Tests  752 passed (752)`, et `tsc` sans sortie.

- [ ] **Étape 5 : commit**

```bash
git add pipeline/audio/concat.ts pipeline/test/audio/concat.test.ts
git commit -m "feat(audio): concaténation des MP3 avec ffmpeg ou trame par trame"
```

---

### Tâche 4 : client Text-to-Speech

**Fichiers :**
- Créer : `pipeline/audio/tts.ts`, `fixtures/api/tts-synthesize.json`, `fixtures/api/tts-voices.json`
- Modifier : `fixtures/api/README.md`
- Test : `pipeline/test/audio/tts.test.ts`

Les deux fixtures sont **construites** d'après la documentation publique de l'API v1, pas enregistrées. L'audio de `tts-synthesize.json` est synthétique (trame Xing et trois trames de silence produites par `pipeline/test/audio/mp3.ts`). Les noms de `tts-voices.json` suivent la forme documentée, à confirmer par un vrai appel.

Comportement attendu :
- **Synthèse.** `POST https://texttospeech.googleapis.com/v1/text:synthesize` avec `{ input: { text }, voice: { languageCode, name }, audioConfig: { audioEncoding: 'MP3', speakingRate? } }`.
- **Clé.** Elle passe dans l'en-tête `x-goog-api-key`, jamais dans l'URL.
- **Réponse.** `audioContent` est validé (base64 non vide) puis décodé, et l'audio doit passer `looksLikeMp3`. Un morceau au-dessus de 5 000 octets est refusé sans appel. Une réponse de plus de 8 Mo est refusée (`BodyError`).
- **Erreurs.** Une erreur HTTP lève `HttpError` (statut, URL sans clé, aucun corps). Le délai et le signal de l'appelant interrompent l'appel.
- **Voix.** `GET …/v1/voices?languageCode=` est validé ; `chirp3HdVoices` garde les voix « Chirp3-HD » de la langue exacte, triées.

- [ ] **Étape 1 : écrire les fixtures et les tests**

Fichier `fixtures/api/tts-synthesize.json` :

```json
{
  "audioContent": "//NExAAAAAAAAAAAAFhpbmcAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA//NExAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA//NExAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA//NExAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"
}
```

Fichier `fixtures/api/tts-voices.json` :

```json
{
  "voices": [
    { "languageCodes": ["fr-FR"], "name": "fr-FR-Chirp3-HD-Charon", "ssmlGender": "MALE", "naturalSampleRateHertz": 24000 },
    { "languageCodes": ["fr-FR"], "name": "fr-FR-Chirp3-HD-Aoede", "ssmlGender": "FEMALE", "naturalSampleRateHertz": 24000 },
    { "languageCodes": ["fr-FR"], "name": "fr-FR-Chirp3-HD-Kore", "ssmlGender": "FEMALE", "naturalSampleRateHertz": 24000 },
    { "languageCodes": ["fr-FR"], "name": "fr-FR-Chirp3-HD-Puck", "ssmlGender": "MALE", "naturalSampleRateHertz": 24000 },
    { "languageCodes": ["fr-FR"], "name": "fr-FR-Chirp-HD-D", "ssmlGender": "MALE", "naturalSampleRateHertz": 24000 },
    { "languageCodes": ["fr-FR"], "name": "fr-FR-Neural2-A", "ssmlGender": "FEMALE", "naturalSampleRateHertz": 24000 },
    { "languageCodes": ["fr-FR"], "name": "fr-FR-Wavenet-B", "ssmlGender": "MALE", "naturalSampleRateHertz": 24000 },
    { "languageCodes": ["fr-CA"], "name": "fr-CA-Chirp3-HD-Aoede", "ssmlGender": "FEMALE", "naturalSampleRateHertz": 24000 }
  ]
}
```

Dans `fixtures/api/README.md`, remplacer :

```markdown
- `article-euronews.html` : page d'article construite (menu, script, article, encadré, pied de page) pour l'extraction du texte intégral.
```

par :

```markdown
- `article-euronews.html` : page d'article construite (menu, script, article, encadré, pied de page) pour l'extraction du texte intégral.
- `tts-synthesize.json` : `POST https://texttospeech.googleapis.com/v1/text:synthesize` (documentation Google Cloud Text-to-Speech v1 : `SynthesizeSpeechResponse`, champ `audioContent` en base64). L'audio est **synthétique** : une trame d'information « Xing » puis trois trames MPEG-2 couche III de silence (24 kHz, 32 kb/s, mono), fabriquées par `pipeline/test/audio/mp3.ts`, pas une vraie voix.
- `tts-voices.json` : `GET https://texttospeech.googleapis.com/v1/voices?languageCode=fr-FR` (documentation v1 : `voices[]` avec `languageCodes`, `name`, `ssmlGender`, `naturalSampleRateHertz`). Les noms suivent la forme `<langue>-Chirp3-HD-<nom>` de la documentation, **à confirmer par un vrai appel** ; la liste mêle des voix Chirp 3 HD, une voix « Chirp-HD » (autre famille), Neural2, WaveNet et une voix fr-CA, pour tester le filtre.
```

Fichier `pipeline/test/audio/tts.test.ts` :

```ts
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { BodyError, HttpError } from '../../collect/http';
import { chirp3HdVoices, listVoices, MAX_SYNTH_RESPONSE_BYTES, synthesize, TTS_BASE, TtsAudioError } from '../../audio/tts';
import { parseMp3 } from '../../audio/mp3';
import { fakeHttp } from '../collect/fake-http';
import { repoPath } from '../helpers';

const KEY = 'AIzaSy-cle-de-test-0123456789';
const VOICE = { languageCode: 'fr-FR', name: 'fr-FR-Chirp3-HD-Aoede' };
const SYNTH = JSON.parse(readFileSync(repoPath('fixtures/api/tts-synthesize.json'), 'utf8'));
const VOICES = JSON.parse(readFileSync(repoPath('fixtures/api/tts-voices.json'), 'utf8'));

describe('synthesize', () => {
  it('POST text:synthesize : texte, voix, MP3 ; la clé passe dans x-goog-api-key, jamais dans l’URL', async () => {
    const net = fakeHttp({ [`${TTS_BASE}/text:synthesize`]: { json: SYNTH } });
    const mp3 = await synthesize('Bonjour.', VOICE, { speakingRate: 1.05 }, { apiKey: KEY, fetch: net.fetch });
    expect(parseMp3(mp3).frames).toHaveLength(3);
    const [call] = net.calls;
    expect(call.url).toBe('https://texttospeech.googleapis.com/v1/text:synthesize');
    expect(call.method).toBe('POST');
    expect(call.headers?.['x-goog-api-key']).toBe(KEY);
    expect(call.url).not.toContain(KEY);
    expect(JSON.parse(call.body!)).toEqual({ input: { text: 'Bonjour.' }, voice: VOICE, audioConfig: { audioEncoding: 'MP3', speakingRate: 1.05 } });
  });

  it('sans speakingRate, audioConfig ne porte que l’encodage', async () => {
    const net = fakeHttp({ [TTS_BASE]: { json: SYNTH } });
    await synthesize('Bonjour.', VOICE, {}, { apiKey: KEY, fetch: net.fetch });
    expect(JSON.parse(net.calls[0].body!).audioConfig).toEqual({ audioEncoding: 'MP3' });
  });

  it('refuse un morceau au-dessus de la limite de l’API sans appeler le service', async () => {
    const net = fakeHttp({});
    await expect(synthesize('é'.repeat(2501), VOICE, {}, { apiKey: KEY, fetch: net.fetch })).rejects.toThrow(/5002 octets/);
    expect(net.calls).toHaveLength(0);
  });

  it('erreur HTTP : HttpError avec le statut, sans la clé ni le corps', async () => {
    const net = fakeHttp({ [TTS_BASE]: { status: 403, json: { error: { code: 403, message: `API key ${KEY} not valid`, status: 'PERMISSION_DENIED' } } } });
    const e = await synthesize('Bonjour.', VOICE, {}, { apiKey: KEY, fetch: net.fetch }).catch((x) => x);
    expect(e).toBeInstanceOf(HttpError);
    expect((e as HttpError).status).toBe(403);
    expect(String(e.message)).not.toContain(KEY);
  });

  it('réponse invalide : sans audioContent, base64 incorrect, audio qui n’est pas un MP3', async () => {
    const call = (json: unknown) => synthesize('Bonjour.', VOICE, {}, { apiKey: KEY, fetch: fakeHttp({ [TTS_BASE]: { json } }).fetch });
    await expect(call({})).rejects.toBeInstanceOf(z.ZodError);
    await expect(call({ audioContent: '***' })).rejects.toBeInstanceOf(z.ZodError);
    await expect(call({ audioContent: Buffer.from('<html>non</html>').toString('base64') })).rejects.toBeInstanceOf(TtsAudioError);
  });

  it('réponse trop lourde : BodyError avant lecture complète', async () => {
    const net = fakeHttp({ [TTS_BASE]: { json: SYNTH, headers: { 'content-length': String(MAX_SYNTH_RESPONSE_BYTES + 1) } } });
    await expect(synthesize('Bonjour.', VOICE, {}, { apiKey: KEY, fetch: net.fetch })).rejects.toBeInstanceOf(BodyError);
  });

  it('délai dépassé : l’appel est interrompu (TimeoutError)', async () => {
    const net = fakeHttp({ [TTS_BASE]: { hang: true } });
    const e = await synthesize('Bonjour.', VOICE, {}, { apiKey: KEY, fetch: net.fetch, timeoutMs: 20 }).catch((x) => x);
    expect((e as Error).name).toBe('TimeoutError');
  });

  it('le signal de l’appelant interrompt l’appel', async () => {
    const net = fakeHttp({ [TTS_BASE]: { hang: true } });
    const ctrl = new AbortController();
    const p = synthesize('Bonjour.', VOICE, {}, { apiKey: KEY, fetch: net.fetch, signal: ctrl.signal });
    ctrl.abort(new Error('échéance globale'));
    await expect(p).rejects.toThrow('échéance globale');
  });
});

describe('listVoices et chirp3HdVoices', () => {
  it('GET voices?languageCode= ; clé en en-tête ; seules les voix Chirp3-HD de la langue, triées', async () => {
    const net = fakeHttp({ [`${TTS_BASE}/voices`]: { json: VOICES } });
    const voices = await listVoices('fr-FR', { apiKey: KEY, fetch: net.fetch });
    expect(net.calls[0].url).toBe('https://texttospeech.googleapis.com/v1/voices?languageCode=fr-FR');
    expect(net.calls[0].headers?.['x-goog-api-key']).toBe(KEY);
    expect(voices).toHaveLength(8);
    expect(chirp3HdVoices(voices, 'fr-FR').map((v) => v.name)).toEqual(['fr-FR-Chirp3-HD-Aoede', 'fr-FR-Chirp3-HD-Charon', 'fr-FR-Chirp3-HD-Kore', 'fr-FR-Chirp3-HD-Puck']);
  });

  it('une réponse sans voix donne une liste vide ; une réponse mal formée est refusée', async () => {
    expect(await listVoices('xx-XX', { apiKey: KEY, fetch: fakeHttp({ [TTS_BASE]: { json: {} } }).fetch })).toEqual([]);
    await expect(listVoices('fr-FR', { apiKey: KEY, fetch: fakeHttp({ [TTS_BASE]: { json: { voices: [{ name: 3 }] } } }).fetch })).rejects.toBeInstanceOf(z.ZodError);
  });
});
```

- [ ] **Étape 2 : vérifier l'échec**

Commande : `npx vitest run pipeline/test/audio/tts.test.ts`
Attendu : échec, « Failed to load url ../../audio/tts », `Test Files  1 failed (1)`.

- [ ] **Étape 3 : écrire le client**

Fichier `pipeline/audio/tts.ts` :

```ts
import { z } from 'zod';
import { looksLikeMp3 } from '../publish/files';
import { fetchJson, type HttpFetch } from '../collect/http';
import { TTS_MAX_REQUEST_BYTES, utf8Bytes } from './chunk';

/** API REST Google Cloud Text-to-Speech v1. */
export const TTS_BASE = 'https://texttospeech.googleapis.com/v1';
/** Délai d'une synthèse (un morceau de 4 500 octets donne environ une minute d'audio). */
export const SYNTH_TIMEOUT_MS = 60_000;
/** Délai d'une liste de voix. */
export const LIST_TIMEOUT_MS = 20_000;
/** Taille maximale d'une réponse de synthèse (JSON, audio en base64) : 8 Mo. */
export const MAX_SYNTH_RESPONSE_BYTES = 8 * 1024 * 1024;
/** Taille maximale d'une liste de voix : 2 Mo. */
export const MAX_LIST_RESPONSE_BYTES = 2 * 1024 * 1024;

export type TtsVoice = { languageCode: string; name: string };
export type TtsAudio = { speakingRate?: number };
export type TtsClient = { apiKey: string; fetch: HttpFetch; signal?: AbortSignal; timeoutMs?: number };

/** Réponse de `text:synthesize` : `audioContent` en base64 (champ `bytes` de l'API). */
const SynthesizeResponse = z.object({ audioContent: z.base64().min(1) });

/** Réponse de `voices` : on ne garde que les champs utiles. */
const VoicesResponse = z.object({
  voices: z
    .array(
      z.object({
        languageCodes: z.array(z.string()),
        name: z.string().min(1),
        ssmlGender: z.string().optional(),
        naturalSampleRateHertz: z.number().int().optional(),
      }),
    )
    .max(5000)
    .default([]),
});

export type VoiceInfo = z.infer<typeof VoicesResponse>['voices'][number];

/** Réponse audio inutilisable (vide, pas un MP3, trop lourde) : comptée comme un échec du service. */
export class TtsAudioError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TtsAudioError';
  }
}

/** En-têtes : la clé passe par `x-goog-api-key`, jamais dans l'URL. */
const headers = (apiKey: string) => ({ 'x-goog-api-key': apiKey, 'content-type': 'application/json; charset=utf-8', accept: 'application/json' });

/**
 * Synthétise un morceau en MP3 (POST `text:synthesize`). La réponse est bornée en taille et validée,
 * et l'audio décodé doit être un MP3 (contrôle du lot 4). Lève HttpError, BodyError, ZodError,
 * TtsAudioError ou une erreur réseau ; le message ne contient jamais la clé.
 */
export async function synthesize(text: string, voice: TtsVoice, audio: TtsAudio, client: TtsClient): Promise<Buffer> {
  if (utf8Bytes(text) > TTS_MAX_REQUEST_BYTES) throw new Error(`morceau de ${utf8Bytes(text)} octets, au-dessus de la limite de l'API`);
  const body = JSON.stringify({
    input: { text },
    voice: { languageCode: voice.languageCode, name: voice.name },
    audioConfig: { audioEncoding: 'MP3', ...(audio.speakingRate !== undefined ? { speakingRate: audio.speakingRate } : {}) },
  });
  const json = await fetchJson(client.fetch, `${TTS_BASE}/text:synthesize`, {
    method: 'POST',
    headers: headers(client.apiKey),
    body,
    signal: client.signal,
    timeoutMs: client.timeoutMs ?? SYNTH_TIMEOUT_MS,
    maxBytes: MAX_SYNTH_RESPONSE_BYTES,
  });
  const bytes = Buffer.from(SynthesizeResponse.parse(json).audioContent, 'base64');
  if (!looksLikeMp3(bytes)) throw new TtsAudioError('réponse audio qui n’est pas un MP3');
  return bytes;
}

/** Liste les voix d'une langue (GET `voices?languageCode=`), validées. */
export async function listVoices(languageCode: string, client: TtsClient): Promise<VoiceInfo[]> {
  const json = await fetchJson(client.fetch, `${TTS_BASE}/voices?${new URLSearchParams({ languageCode })}`, {
    headers: headers(client.apiKey),
    signal: client.signal,
    timeoutMs: client.timeoutMs ?? LIST_TIMEOUT_MS,
    maxBytes: MAX_LIST_RESPONSE_BYTES,
  });
  return VoicesResponse.parse(json).voices;
}

/** Voix Chirp 3 HD d'une langue (spec §16 : filtre sur « Chirp3-HD »), triées par nom. */
export function chirp3HdVoices(voices: VoiceInfo[], languageCode: string): VoiceInfo[] {
  return voices.filter((v) => v.name.includes('Chirp3-HD') && v.languageCodes.includes(languageCode)).sort((a, b) => a.name.localeCompare(b.name));
}
```

- [ ] **Étape 4 : vérifier le succès**

Commande : `npx vitest run pipeline/test/audio/tts.test.ts`
Attendu : `Test Files  1 passed (1)` et `Tests  10 passed (10)`.

Commande : `npm test && npm run typecheck`
Attendu : `Test Files  71 passed (71)`, `Tests  762 passed (762)`, et `tsc` sans sortie.

- [ ] **Étape 5 : commit**

```bash
git add pipeline/audio/tts.ts fixtures/api/tts-synthesize.json fixtures/api/tts-voices.json fixtures/api/README.md pipeline/test/audio/tts.test.ts
git commit -m "feat(audio): client Google Cloud Text-to-Speech"
```

---

### Tâche 5 : voix par édition

**Fichiers :**
- Créer : `pipeline/config/voices.json`, `pipeline/audio/voices.ts`
- Test : `pipeline/test/audio/voices.test.ts`

Comportement attendu :
- **Fichier du dépôt.** Il est valide : une voix Chirp 3 HD par édition, avec `confirmed: false` tant que Naïm n'a pas choisi.
- **Langues.** L'anglais accepte en-US ou en-GB, et un `speakingRate` entre 0,25 et 2 est permis.
- **Refus.** Sont refusés, avec un message qui nomme le champ :
  - une variante régionale non prévue ;
  - une voix d'une autre langue ;
  - une voix d'une autre famille (Neural2) ;
  - un débit hors bornes ;
  - une clé inconnue, un champ manquant ;
  - un JSON illisible.

- [ ] **Étape 1 : écrire les tests**

Fichier `pipeline/test/audio/voices.test.ts` :

```ts
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { LANGUAGE_CODES, loadVoices, VOICES_PATH } from '../../audio/voices';

const base = {
  confirmed: true,
  fr: { languageCode: 'fr-FR', name: 'fr-FR-Chirp3-HD-Aoede' },
  en: { languageCode: 'en-GB', name: 'en-GB-Chirp3-HD-Charon', speakingRate: 1.1 },
  es: { languageCode: 'es-ES', name: 'es-ES-Chirp3-HD-Kore' },
};

function write(cfg: unknown): string {
  const path = join(mkdtempSync(join(tmpdir(), 'voices-')), 'voices.json');
  writeFileSync(path, typeof cfg === 'string' ? cfg : JSON.stringify(cfg));
  return path;
}

describe('voices.json', () => {
  it('le fichier du dépôt est valide : une voix Chirp 3 HD par édition, non encore confirmée', () => {
    const v = loadVoices();
    expect(VOICES_PATH).toMatch(/pipeline\/config\/voices\.json$/);
    expect(v.confirmed).toBe(false);
    for (const lang of ['fr', 'en', 'es'] as const) {
      expect(LANGUAGE_CODES[lang]).toContain(v[lang].languageCode);
      expect(v[lang].name).toMatch(new RegExp(`^${v[lang].languageCode}-Chirp3-HD-`));
    }
  });

  it('accepte en-US ou en-GB pour l’anglais, et un débit de parole', () => {
    expect(loadVoices(write(base)).en).toEqual({ languageCode: 'en-GB', name: 'en-GB-Chirp3-HD-Charon', speakingRate: 1.1 });
  });

  it('refuse une variante régionale non prévue, une voix d’une autre langue ou d’une autre famille', () => {
    expect(() => loadVoices(write({ ...base, fr: { languageCode: 'fr-CA', name: 'fr-CA-Chirp3-HD-Aoede' } }))).toThrow(/fr\.languageCode fr : fr-FR attendu/);
    expect(() => loadVoices(write({ ...base, es: { languageCode: 'es-ES', name: 'es-US-Chirp3-HD-Kore' } }))).toThrow(/es\.name es : la voix doit être de es-ES/);
    expect(() => loadVoices(write({ ...base, fr: { languageCode: 'fr-FR', name: 'fr-FR-Neural2-A' } }))).toThrow(/voix Chirp 3 HD attendue/);
  });

  it('refuse un débit hors bornes, une clé inconnue, un champ manquant ou un JSON illisible', () => {
    expect(() => loadVoices(write({ ...base, fr: { ...base.fr, speakingRate: 3 } }))).toThrow(/voices\.json invalide : fr\.speakingRate/);
    expect(() => loadVoices(write({ ...base, de: base.fr }))).toThrow(/voices\.json invalide/);
    expect(() => loadVoices(write({ fr: base.fr, en: base.en, es: base.es }))).toThrow(/confirmed/);
    expect(() => loadVoices(write('{ pas du json'))).toThrow(/voices\.json illisible/);
  });
});
```

- [ ] **Étape 2 : vérifier l'échec**

Commande : `npx vitest run pipeline/test/audio/voices.test.ts`
Attendu : échec, « Failed to load url ../../audio/voices », `Test Files  1 failed (1)`.

- [ ] **Étape 3 : écrire la configuration et son lecteur**

Fichier `pipeline/config/voices.json` :

```json
{
  "_note": "Voix par défaut, à confirmer par voices.list : lancer `npm run audio:samples`, écouter out/voice-samples/ et remplacer les noms par ceux choisis (spec §9 et §14).",
  "confirmed": false,
  "fr": { "languageCode": "fr-FR", "name": "fr-FR-Chirp3-HD-Aoede" },
  "en": { "languageCode": "en-US", "name": "en-US-Chirp3-HD-Charon" },
  "es": { "languageCode": "es-ES", "name": "es-ES-Chirp3-HD-Kore" }
}
```

Fichier `pipeline/audio/voices.ts` :

```ts
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import type { Lang } from '@daily-brief/schema';

/** Variantes régionales permises par édition (spec §9 : fr-FR, en-US ou en-GB, es-ES). */
export const LANGUAGE_CODES: Record<Lang, readonly string[]> = { fr: ['fr-FR'], en: ['en-US', 'en-GB'], es: ['es-ES'] };

export const VOICES_PATH = fileURLToPath(new URL('../config/voices.json', import.meta.url));

const VoiceSchema = z.strictObject({
  languageCode: z.string(),
  /** Nom complet d'une voix Chirp 3 HD : `<languageCode>-Chirp3-HD-<nom>`. */
  name: z.string().regex(/^[a-z]{2}-[A-Z]{2}-Chirp3-HD-[A-Za-z]+$/, 'voix Chirp 3 HD attendue (« fr-FR-Chirp3-HD-Nom »)'),
  /** Débit de parole (API : 0,25 à 2,0 ; 1 par défaut). */
  speakingRate: z.number().min(0.25).max(2).optional(),
});

export type VoiceConfig = z.infer<typeof VoiceSchema>;

export const VoicesSchema = z
  .strictObject({
    _note: z.string().optional(),
    /** Vrai une fois les noms confirmés par voices.list et choisis sur les échantillons. */
    confirmed: z.boolean(),
    fr: VoiceSchema,
    en: VoiceSchema,
    es: VoiceSchema,
  })
  .superRefine((cfg, ctx) => {
    for (const lang of ['fr', 'en', 'es'] as const) {
      const v = cfg[lang];
      if (!LANGUAGE_CODES[lang].includes(v.languageCode)) {
        ctx.addIssue({ code: 'custom', path: [lang, 'languageCode'], message: `${lang} : ${LANGUAGE_CODES[lang].join(' ou ')} attendu` });
      } else if (!v.name.startsWith(`${v.languageCode}-`)) {
        ctx.addIssue({ code: 'custom', path: [lang, 'name'], message: `${lang} : la voix doit être de ${v.languageCode}` });
      }
    }
  });

export type Voices = z.infer<typeof VoicesSchema>;

/** Lit et valide `pipeline/config/voices.json` ; lève une erreur lisible sinon. */
export function loadVoices(path = VOICES_PATH): Voices {
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(path, 'utf8'));
  } catch (e) {
    throw new Error(`voices.json illisible : ${(e as Error).message}`);
  }
  const r = VoicesSchema.safeParse(raw);
  if (!r.success) throw new Error(`voices.json invalide : ${r.error.issues.map((i) => `${i.path.join('.')} ${i.message}`).join(' ; ')}`);
  return r.data;
}
```

- [ ] **Étape 4 : vérifier le succès**

Commande : `npx vitest run pipeline/test/audio/voices.test.ts`
Attendu : `Test Files  1 passed (1)` et `Tests  4 passed (4)`.

Commande : `npm test && npm run typecheck`
Attendu : `Test Files  72 passed (72)`, `Tests  766 passed (766)`, et `tsc` sans sortie.

- [ ] **Étape 5 : commit**

```bash
git add pipeline/config/voices.json pipeline/audio/voices.ts pipeline/test/audio/voices.test.ts
git commit -m "feat(audio): voix Chirp 3 HD par édition"
```

---

### Tâche 6 : lecture d'une édition, budget et disjoncteur

**Fichiers :**
- Créer : `pipeline/audio/budget.ts`, `pipeline/audio/voice-edition.ts`
- Test : `pipeline/test/audio/fake-tts.ts` (faux service, sert aussi aux tâches 7 à 9), `pipeline/test/audio/voice-edition.test.ts`

Comportement attendu :
- **Budget.** 5 000 caractères par édition, 15 000 par passage. `refuseEdition` dit pourquoi une édition est refusée, et `take` réserve les caractères d'une requête.
- **Lecture.** Le script est découpé, chaque morceau synthétisé dans l'ordre avec la voix et son débit, puis tout est concaténé. Le résultat donne le nombre de morceaux, la durée, la méthode et les caractères envoyés.
- **Seconde tentative.** Une erreur 5xx ou réseau est retentée une fois, et les caractères sont comptés deux fois. Deux échecs sur le même morceau font échouer l'édition sans couper le service.
- **Coupure.** 403, 429 ou délai dépassé coupent le service tout de suite, sans seconde tentative, et l'édition suivante n'appelle plus rien. Trois échecs consécutifs coupent aussi. Une réponse qui n'est pas un MP3 n'est pas retentée.
- **Sans appel.** Un script vide, un mot impossible à découper, un script au-delà du plafond par édition ou un budget épuisé font échouer l'édition sans aucun appel.
- **Échéance.** Elle interrompt l'appel en cours, puis plus rien n'est envoyé ni compté.

- [ ] **Étape 1 : écrire le faux service et les tests**

Fichier `pipeline/test/audio/fake-tts.ts` :

```ts
import type { HttpInit } from '../../collect/http';
import { TTS_BASE } from '../../audio/tts';
import { fakeHttp, type Reply } from '../collect/fake-http';
import { apiLikeMp3 } from './mp3';

/** Trames audio renvoyées par morceau : 125 trames de 576 échantillons à 24 kHz = 3 s. */
export const FRAMES_PER_CHUNK = 125;
export const SECONDS_PER_CHUNK = 3;

export type SynthRequest = { text: string; voice: { languageCode: string; name: string }; audioConfig: Record<string, unknown> };

/**
 * Réponse de synthèse réussie : un MP3 « comme celui de l'API » (ID3, Xing, trames). Avec `fill = 0`,
 * les trames sont du silence décodable par ffmpeg ; sinon leur contenu suit l'ordre mais ne se décode pas.
 */
export const okSynth = (fill = 1): Reply => ({ json: { audioContent: apiLikeMp3(FRAMES_PER_CHUNK, fill).toString('base64') } });

/** Liste de voix d'une langue, à la forme de voices.list : quatre Chirp 3 HD, une Neural2. */
export const voicesOf = (code: string): Reply => ({
  json: { voices: ['Aoede', 'Charon', 'Kore', 'Puck'].map((n) => ({ languageCodes: [code], name: `${code}-Chirp3-HD-${n}`, ssmlGender: 'FEMALE', naturalSampleRateHertz: 24000 })).concat([{ languageCodes: [code], name: `${code}-Neural2-A`, ssmlGender: 'FEMALE', naturalSampleRateHertz: 24000 }]) },
});

/**
 * Faux Text-to-Speech : `reply` choisit la réponse de chaque synthèse (par défaut, un MP3 de 3 s),
 * `voices` celle de chaque liste de voix. `requests` garde le corps de chaque synthèse.
 */
export function fakeTts(reply: (req: SynthRequest, n: number) => Reply = () => okSynth(), voices: (code: string) => Reply = voicesOf) {
  const requests: SynthRequest[] = [];
  const net = fakeHttp({
    [`${TTS_BASE}/text:synthesize`]: (_url: string, init?: HttpInit) => {
      const body = JSON.parse(init!.body!);
      const req = { text: body.input.text, voice: body.voice, audioConfig: body.audioConfig };
      requests.push(req);
      return reply(req, requests.length);
    },
    [`${TTS_BASE}/voices`]: (url: string) => voices(new URL(url).searchParams.get('languageCode') ?? ''),
  });
  return { ...net, requests };
}
```

Fichier `pipeline/test/audio/voice-edition.test.ts` :

```ts
import { describe, expect, it } from 'vitest';
import { Breaker } from '../../collect/breaker';
import { CharBudget, MAX_CHARS_PER_EDITION, MAX_CHARS_PER_RUN } from '../../audio/budget';
import { looksLikeMp3 } from '../../publish/files';
import { voiceEdition, VoiceEditionError, type VoiceEditionDeps } from '../../audio/voice-edition';
import { fakeTts, okSynth, SECONDS_PER_CHUNK } from './fake-tts';

const KEY = 'AIzaSy-cle-de-test-0123456789';
const VOICE = { languageCode: 'fr-FR', name: 'fr-FR-Chirp3-HD-Aoede', speakingRate: 1.05 };
/** Trois phrases de 30 octets : avec des morceaux de 70 octets, deux morceaux. */
const SCRIPT = 'Première phrase du brief ici. Deuxième phrase du brief ici. Troisième phrase, la fin.';

function deps(net: ReturnType<typeof fakeTts>, over: Partial<VoiceEditionDeps> = {}): VoiceEditionDeps {
  return { client: { apiKey: KEY, fetch: net.fetch }, breaker: new Breaker(), budget: new CharBudget(), ffmpeg: null, maxChunkBytes: 70, ...over };
}

const failure = (p: Promise<unknown>) => p.then(() => { throw new Error('succès inattendu'); }, (e: unknown) => e as VoiceEditionError);

describe('CharBudget', () => {
  it('plafonds : 5 000 caractères par édition, 15 000 par passage', () => {
    expect([MAX_CHARS_PER_EDITION, MAX_CHARS_PER_RUN]).toEqual([5000, 15000]);
    const b = new CharBudget();
    expect(b.refuseEdition(5001)).toBe('audioScript de 5001 caractères, au-delà du plafond de 5000 par édition');
    expect(b.refuseEdition(5000)).toBeNull();
    expect(b.take(14_000)).toBe(true);
    expect(b.refuseEdition(1001)).toBe('plafond du passage atteint (14000 caractères envoyés, 15000 au plus)');
    expect(b.take(1001)).toBe(false);
    expect(b.take(1000)).toBe(true);
    expect(b.sent).toBe(15_000);
  });
});

describe('voiceEdition', () => {
  it('découpe, synthétise chaque morceau dans l’ordre avec la voix, puis concatène', async () => {
    const net = fakeTts((_, n) => okSynth(n * 10));
    const r = await voiceEdition(SCRIPT, VOICE, deps(net));
    expect(net.requests.map((q) => q.text)).toEqual(['Première phrase du brief ici. Deuxième phrase du brief ici.', 'Troisième phrase, la fin.']);
    expect(net.requests[0].voice).toEqual({ languageCode: 'fr-FR', name: 'fr-FR-Chirp3-HD-Aoede' });
    expect(net.requests[0].audioConfig).toEqual({ audioEncoding: 'MP3', speakingRate: 1.05 });
    expect([r.chunks, r.seconds, r.method, r.characters]).toEqual([2, 2 * SECONDS_PER_CHUNK, 'frames', [...SCRIPT].length - 1]);
    expect(looksLikeMp3(r.bytes)).toBe(true);
    expect([r.bytes[50], r.bytes[r.bytes.length - 50]]).toEqual([10, 20 + 124]);
  });

  it('une erreur 500 passagère : seconde tentative réussie, caractères comptés deux fois', async () => {
    const net = fakeTts((_, n) => (n === 1 ? { status: 500, json: {} } : okSynth()));
    const budget = new CharBudget();
    const r = await voiceEdition('Une seule phrase.', VOICE, deps(net, { budget }));
    expect(net.requests).toHaveLength(2);
    expect(r.characters).toBe(34);
    expect(budget.sent).toBe(34);
  });

  it('deux erreurs 503 sur le même morceau : échec de l’édition, sans coupure du service', async () => {
    const net = fakeTts(() => ({ status: 503, json: {} }));
    const breaker = new Breaker();
    const e = await failure(voiceEdition('Une seule phrase.', VOICE, deps(net, { breaker })));
    expect(e).toBeInstanceOf(VoiceEditionError);
    expect(e.message).toBe('morceau 1/1 : HTTP 503 (https://texttospeech.googleapis.com/v1/text:synthesize)');
    expect(e.characters).toBe(34);
    expect(breaker.open).toBe(false);
  });

  it('403 : coupure immédiate du service, sans seconde tentative ; l’édition suivante n’appelle plus rien', async () => {
    const net = fakeTts(() => ({ status: 403, json: { error: { message: `clé ${KEY} refusée` } } }));
    const d = deps(net);
    const e = await failure(voiceEdition(SCRIPT, VOICE, d));
    expect(e.message).toBe('morceau 1/2 : HTTP 403 (https://texttospeech.googleapis.com/v1/text:synthesize) — Text-to-Speech coupé (HTTP 403)');
    expect(net.requests).toHaveLength(1);
    const next = await failure(voiceEdition(SCRIPT, VOICE, d));
    expect(next.message).toBe('Text-to-Speech coupé (HTTP 403)');
    expect(net.requests).toHaveLength(1);
  });

  it('429 et délai dépassé coupent aussi le service', async () => {
    for (const reply of [{ status: 429, json: {} }, { hang: true }]) {
      const net = fakeTts(() => reply);
      const d = deps(net, { client: { apiKey: KEY, fetch: net.fetch, timeoutMs: 20 } });
      const e = await failure(voiceEdition('Une phrase.', VOICE, d));
      expect(e.message).toMatch(/Text-to-Speech coupé \((HTTP 429|délai dépassé)\)$/);
    }
  });

  it('réponse invalide (pas un MP3) : échec sans seconde tentative', async () => {
    const net = fakeTts(() => ({ json: { audioContent: Buffer.from('<html>').toString('base64') } }));
    const e = await failure(voiceEdition('Une phrase.', VOICE, deps(net)));
    expect(e.message).toBe('morceau 1/1 : réponse audio qui n’est pas un MP3');
    expect(net.requests).toHaveLength(1);
  });

  it('script trop long pour le plafond par édition, ou budget du passage épuisé : aucun appel', async () => {
    const net = fakeTts();
    const long = await failure(voiceEdition('mot '.repeat(1300), VOICE, deps(net, { maxChunkBytes: 4500 })));
    expect(long.message).toBe('audioScript de 5199 caractères, au-delà du plafond de 5000 par édition');
    const budget = new CharBudget(5000, 50);
    const over = await failure(voiceEdition(SCRIPT, VOICE, deps(net, { budget })));
    expect(over.message).toMatch(/^plafond du passage atteint \(0 caractères envoyés, 50 au plus\)$/);
    expect(net.requests).toHaveLength(0);
  });

  it('script vide ou mot impossible à découper : échec lisible', async () => {
    const net = fakeTts();
    expect((await failure(voiceEdition('  ', VOICE, deps(net)))).message).toBe('audioScript vide');
    expect((await failure(voiceEdition('x'.repeat(80), VOICE, deps(net)))).message).toMatch(/^découpage impossible : mot de 80 octets/);
  });

  it('échéance du passage : l’appel en cours est interrompu et l’édition échoue', async () => {
    const net = fakeTts(() => ({ hang: true }));
    const ctrl = new AbortController();
    const p = failure(voiceEdition('Une phrase.', VOICE, deps(net, { client: { apiKey: KEY, fetch: net.fetch, signal: ctrl.signal } })));
    ctrl.abort(new Error('échéance'));
    expect((await p).message).toBe('morceau 1/1 : échéance du passage dépassée');
  });

  it('trois échecs non fatals consécutifs coupent le service', async () => {
    const net = fakeTts(() => ({ status: 400, json: {} }));
    const d = deps(net);
    for (let i = 0; i < 2; i++) expect((await failure(voiceEdition('Une phrase.', VOICE, d))).message).toMatch(/HTTP 400 \(/);
    expect((await failure(voiceEdition('Une phrase.', VOICE, d))).message).toMatch(/coupé \(source coupée après 3 échecs consécutifs\)$/);
  });
});
```

- [ ] **Étape 2 : vérifier l'échec**

Commande : `npx vitest run pipeline/test/audio/voice-edition.test.ts`
Attendu : échec, « Failed to load url ../../audio/budget », `Test Files  1 failed (1)`.

- [ ] **Étape 3 : écrire le budget et la lecture d'une édition**

Fichier `pipeline/audio/budget.ts` :

```ts
/**
 * Plafonds de caractères envoyés à Text-to-Speech (spec §9 : environ 10 000 par jour, soit
 * 300 000 par mois, sous le million gratuit des voix Chirp 3 HD).
 *
 * - Par édition : 5 000 caractères, soit plus de 700 mots, quand le script visé en fait 350 à 450.
 *   Un script plus long est une erreur de rédaction : l'édition part sans audio.
 * - Par passage : 15 000 caractères. Même relancé chaque jour à ce plafond, le mois reste sous
 *   465 000 caractères. Les tentatives répétées comptent, qu'elles aboutissent ou non.
 */
export const MAX_CHARS_PER_EDITION = 5000;
export const MAX_CHARS_PER_RUN = 15000;

export class CharBudget {
  sent = 0;

  constructor(
    readonly perEdition = MAX_CHARS_PER_EDITION,
    readonly perRun = MAX_CHARS_PER_RUN,
  ) {}

  /** Raison de refuser une édition de `chars` caractères avant tout appel, ou null. */
  refuseEdition(chars: number): string | null {
    if (chars > this.perEdition) return `audioScript de ${chars} caractères, au-delà du plafond de ${this.perEdition} par édition`;
    if (this.sent + chars > this.perRun) return `plafond du passage atteint (${this.sent} caractères envoyés, ${this.perRun} au plus)`;
    return null;
  }

  /** Réserve `chars` caractères pour une requête ; faux si le plafond du passage serait dépassé. */
  take(chars: number): boolean {
    if (this.sent + chars > this.perRun) return false;
    this.sent += chars;
    return true;
  }
}
```

Fichier `pipeline/audio/voice-edition.ts` :

```ts
import { z } from 'zod';
import { Breaker, describeError } from '../collect/breaker';
import { BodyError, HttpError, isTimeout } from '../collect/http';
import { CharBudget } from './budget';
import { billedChars, chunkScript, MAX_CHUNK_BYTES, normalizeScript } from './chunk';
import { concatMp3, type ConcatMethod } from './concat';
import { synthesize, TtsAudioError, type TtsClient } from './tts';
import type { VoiceConfig } from './voices';

/** Tentatives par morceau : une seconde chance après une erreur 5xx ou réseau. */
export const ATTEMPTS_PER_CHUNK = 2;

export type VoiceEditionDeps = {
  client: TtsClient;
  /** Disjoncteur partagé par toutes les éditions du passage. */
  breaker: Breaker;
  budget: CharBudget;
  /** Chemin de ffmpeg, ou null pour la concaténation des trames. */
  ffmpeg: string | null;
  maxChunkBytes?: number;
};

export type VoicedEdition = {
  bytes: Buffer;
  seconds: number;
  chunks: number;
  /** Caractères envoyés pour cette édition (tentatives répétées comprises). */
  characters: number;
  method: ConcatMethod;
  warnings: string[];
};

/** Échec d'une édition ; le message est déjà résumé (sans corps de réponse), à masquer avant affichage. */
export class VoiceEditionError extends Error {
  constructor(
    message: string,
    readonly characters: number,
  ) {
    super(message);
    this.name = 'VoiceEditionError';
  }
}

/** Erreur passagère qui mérite une seconde tentative : 5xx ou erreur réseau (pas un délai, qui coupe le service). */
function retryable(e: unknown): boolean {
  if (e instanceof HttpError) return e.status >= 500;
  if (e instanceof TtsAudioError || e instanceof BodyError || e instanceof z.ZodError || e instanceof SyntaxError || isTimeout(e)) return false;
  return e instanceof Error;
}

/**
 * Lit un `audioScript` avec une voix : découpage, synthèse de chaque morceau (budget, disjoncteur,
 * une seconde tentative sur 5xx ou erreur réseau), puis concaténation. Lève VoiceEditionError.
 */
export async function voiceEdition(script: string, voice: VoiceConfig, deps: VoiceEditionDeps): Promise<VoicedEdition> {
  let characters = 0;
  const fail = (message: string): never => {
    throw new VoiceEditionError(message, characters);
  };
  if (deps.breaker.open) fail(`Text-to-Speech coupé (${deps.breaker.reason})`);
  let chunks: string[];
  try {
    chunks = chunkScript(script, deps.maxChunkBytes ?? MAX_CHUNK_BYTES);
  } catch (e) {
    return fail(`découpage impossible : ${(e as Error).message}`);
  }
  if (chunks.length === 0) fail('audioScript vide');
  const refusal = deps.budget.refuseEdition(billedChars(normalizeScript(script)));
  if (refusal) fail(refusal);

  const parts: Buffer[] = [];
  for (const [i, text] of chunks.entries()) {
    for (let attempt = 1; ; attempt++) {
      if (deps.client.signal?.aborted) fail(`morceau ${i + 1}/${chunks.length} : échéance du passage dépassée`);
      const chars = billedChars(text);
      if (!deps.budget.take(chars)) fail(`plafond du passage atteint (${deps.budget.sent} caractères envoyés, ${deps.budget.perRun} au plus)`);
      characters += chars;
      try {
        parts.push(await synthesize(text, { languageCode: voice.languageCode, name: voice.name }, { speakingRate: voice.speakingRate }, deps.client));
        deps.breaker.success();
        break;
      } catch (e) {
        if (deps.client.signal?.aborted) fail(`morceau ${i + 1}/${chunks.length} : échéance du passage dépassée`);
        const cut = deps.breaker.trip(e);
        const where = `morceau ${i + 1}/${chunks.length} : ${describeError(e)}`;
        if (cut) fail(`${where} — Text-to-Speech coupé (${deps.breaker.reason})`);
        if (attempt >= ATTEMPTS_PER_CHUNK || !retryable(e)) fail(where);
      }
    }
  }

  try {
    const r = await concatMp3(parts, deps.ffmpeg, { signal: deps.client.signal });
    return { bytes: r.bytes, seconds: r.seconds, chunks: chunks.length, characters, method: r.method, warnings: r.warnings };
  } catch (e) {
    return fail(`concaténation impossible : ${(e as Error).message}`);
  }
}
```

- [ ] **Étape 4 : vérifier le succès**

Commande : `npx vitest run pipeline/test/audio/voice-edition.test.ts`
Attendu : `Test Files  1 passed (1)` et `Tests  11 passed (11)`.

Commande : `npm test && npm run typecheck`
Attendu : `Test Files  73 passed (73)`, `Tests  777 passed (777)`, et `tsc` sans sortie.

- [ ] **Étape 5 : commit**

```bash
git add pipeline/audio/budget.ts pipeline/audio/voice-edition.ts pipeline/test/audio/fake-tts.ts pipeline/test/audio/voice-edition.test.ts
git commit -m "feat(audio): lecture d'une édition, budget de caractères et disjoncteur"
```

---

### Tâche 7 : orchestration de `brief:audio`

**Fichiers :**
- Créer : `pipeline/audio/run-audio.ts`
- Modifier : `pipeline/lib/fs.ts` (`writeAtomic` accepte des octets)
- Test : `pipeline/test/audio/run-audio.test.ts`, `pipeline/test/audio/routine-order.test.ts`

Comportement attendu :
- **Trois éditions.** Trois MP3 aux noms du lot 4, un `audio.json` conforme au schéma de `brief:render`, un rapport `ok` et le code 0. Les voix vont dans l'ordre fr-FR, en-US, es-ES, et aucun fichier `.tmp` ne reste.
- **Publication.** `loadPublishInputs` (lot 4) prend les trois MP3, aux chemins `AAAA-MM-JJ/<langue>.mp3`, sans avertissement.
- **Une édition en échec.** Elle est sautée et signalée (« édition publiée sans lecteur »), les autres continuent : `degraded`, code 0, `audio.json` sans cette langue.
- **Clé refusée (403).** Un seul appel, aucun MP3, pas d'`audio.json` : `failed`, code 1.
- **Sans clé.** Aucun appel : `disabled`, code 0, avec un avertissement.
- **Anciennes sorties.** Les MP3, temporaires, `audio.json` et le rapport sont supprimés d'abord, même sans clé.
- **Entrée invalide (code 2).** Une date incorrecte ne crée rien. Aucune édition vérifiée lisible ou un `voices.json` invalide écrivent un rapport `invalid`.
- **Éditions à problème.** Une édition absente, illisible ou d'une autre date est signalée, et les autres sont lues.
- **Limites.** Le plafond du passage saute les éditions qui ne tiennent plus. L'échéance globale arrête le passage, et plus rien n'est envoyé ensuite.
- **Secrets.** Rien dans le rapport ni les messages, même quand une erreur réseau cite la clé.
- **Déterminisme.** Deux passages identiques donnent les mêmes MP3 et le même `audio.json`.
- **Avec ffmpeg.** Les trames de silence sont réencodées (méthode `ffmpeg`, durée `0:03`). Le test est ignoré sans ffmpeg.
- **Ordre de la routine.** Après `brief:audio`, le vrai `runRender` met « 0:03 · voix Chirp HD » dans l'encart des trois éditions. Si l'audio échoue, le PDF est rendu sans encart. `brief:render` ne touche pas aux MP3.

- [ ] **Étape 1 : écrire les tests**

Fichier `pipeline/test/audio/run-audio.test.ts` :

```ts
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import type { Lang } from '@daily-brief/schema';
import { CharBudget } from '../../audio/budget';
import { findFfmpeg } from '../../audio/concat';
import { runAudio, type RunAudioOptions } from '../../audio/run-audio';
import { loadPublishInputs } from '../../publish/inputs';
import { fixtureEdition } from '../helpers';
import { fakeTts, okSynth } from './fake-tts';

const DAY = '2026-11-06';
const FFMPEG = findFfmpeg();
const KEY = 'AIzaSy-cle-de-test-0123456789';

/** Dossier du jour avec les éditions vérifiées demandées (copies de la fixture). */
function makeDay(langs: Lang[] = ['fr', 'en', 'es']) {
  const outDir = mkdtempSync(join(tmpdir(), 'audio-'));
  const dayDir = join(outDir, DAY);
  mkdirSync(dayDir, { recursive: true });
  for (const lang of langs) writeFileSync(join(dayDir, `${lang}.verified.json`), JSON.stringify(fixtureEdition(lang)));
  return { outDir, dayDir };
}

const run = (outDir: string, net: ReturnType<typeof fakeTts>, over: Partial<RunAudioOptions> = {}) => runAudio({ outDir, date: DAY, apiKey: KEY, fetch: net.fetch, ffmpeg: null, ...over });
const readJson = (path: string) => JSON.parse(readFileSync(path, 'utf8'));

/** Forme lue par brief:render (pipeline/render/run-render.ts). */
const RenderAudioSchema = z.object({ fr: z.object({ duration: z.string().min(1) }), en: z.object({ duration: z.string().min(1) }), es: z.object({ duration: z.string().min(1) }) }).partial();

describe('runAudio', () => {
  it('trois éditions : trois MP3 aux noms du lot 4, audio.json lisible par brief:render, rapport ok, code 0', async () => {
    const { outDir, dayDir } = makeDay();
    const net = fakeTts();
    const r = await run(outDir, net);
    expect([r.exitCode, r.report.status, r.reportWritten]).toEqual([0, 'ok', true]);
    for (const L of ['FR', 'EN', 'ES']) expect(existsSync(join(dayDir, `Daily Brief ${DAY} ${L}.mp3`))).toBe(true);
    const audio = readJson(join(dayDir, 'audio.json'));
    expect(audio).toEqual({ fr: { duration: '0:03' }, en: { duration: '0:03' }, es: { duration: '0:03' } });
    expect(RenderAudioSchema.parse(audio)).toEqual(audio);
    expect(net.requests.map((q) => q.voice.languageCode)).toEqual(['fr-FR', 'en-US', 'es-ES']);
    expect(net.requests.map((q) => q.text)).toEqual(['fr', 'en', 'es'].map((l) => fixtureEdition(l as Lang).audioScript.replace(/\s+/g, ' ').trim()));
    const report = readJson(join(dayDir, 'audio-report.json'));
    expect(report.editions.map((e: { file: string; duration: string; method: string; error: null }) => [e.file, e.duration, e.method, e.error])).toEqual([
      [`Daily Brief ${DAY} FR.mp3`, '0:03', 'frames', null],
      [`Daily Brief ${DAY} EN.mp3`, '0:03', 'frames', null],
      [`Daily Brief ${DAY} ES.mp3`, '0:03', 'frames', null],
    ]);
    expect(report.characters.sent).toBe(net.requests.reduce((s, q) => s + [...q.text].length, 0));
    expect(report.characters).toMatchObject({ maxPerEdition: 5000, maxPerRun: 15000 });
    expect(report.issues.map((i: { message: string }) => i.message)).toEqual([
      'voix par défaut non confirmées : lancer npm run audio:samples et choisir les voix (voices.json)',
      'ffmpeg absent : trames concaténées sans réencodage (débit de la source)',
    ]);
    expect(readdirSync(dayDir).filter((f) => f.endsWith('.tmp'))).toEqual([]);
  });

  it('les MP3 écrits passent le contrôle de brief:publish (lot 4)', async () => {
    const { outDir, dayDir } = makeDay();
    await run(outDir, fakeTts());
    writeFileSync(join(dayDir, 'render-report.json'), JSON.stringify({ date: DAY, generatedAt: new Date().toISOString(), pdf: null, finals: ['fr', 'en', 'es'] }));
    for (const lang of ['fr', 'en', 'es'] as const) writeFileSync(join(dayDir, `${lang}.final.json`), JSON.stringify(fixtureEdition(lang)));
    const inputs = loadPublishInputs(dayDir, DAY);
    expect(inputs.audio.map((a) => [a.lang, a.path])).toEqual([
      ['fr', `${DAY}/fr.mp3`],
      ['en', `${DAY}/en.mp3`],
      ['es', `${DAY}/es.mp3`],
    ]);
    expect(inputs.issues.filter((i) => i.message.includes('.mp3'))).toEqual([]);
  });

  it('une édition en échec est sautée et signalée ; les autres continuent : code 0, degraded', async () => {
    const { outDir, dayDir } = makeDay();
    const net = fakeTts((q) => (q.voice.languageCode === 'en-US' ? { status: 400, json: {} } : okSynth()));
    const r = await run(outDir, net);
    expect([r.exitCode, r.report.status]).toEqual([0, 'degraded']);
    expect(existsSync(join(dayDir, `Daily Brief ${DAY} EN.mp3`))).toBe(false);
    expect(Object.keys(readJson(join(dayDir, 'audio.json')))).toEqual(['fr', 'es']);
    expect(r.report.issues).toContainEqual({ level: 'error', lang: 'en', message: 'morceau 1/1 : HTTP 400 (https://texttospeech.googleapis.com/v1/text:synthesize) : édition publiée sans lecteur' });
    expect(r.report.editions.find((e) => e.lang === 'en')).toMatchObject({ file: null, duration: null, error: 'morceau 1/1 : HTTP 400 (https://texttospeech.googleapis.com/v1/text:synthesize)' });
  });

  it('clé refusée (403) : un seul appel, aucune édition, pas d’audio.json, code 1 (failed) sans bloquer', async () => {
    const { outDir, dayDir } = makeDay();
    const net = fakeTts(() => ({ status: 403, json: { error: { message: `API key ${KEY} not valid` } } }));
    const r = await run(outDir, net);
    expect([r.exitCode, r.report.status, net.requests.length]).toEqual([1, 'failed', 1]);
    expect(existsSync(join(dayDir, 'audio.json'))).toBe(false);
    expect(r.report.editions.map((e) => e.error)).toEqual([
      'morceau 1/1 : HTTP 403 (https://texttospeech.googleapis.com/v1/text:synthesize) — Text-to-Speech coupé (HTTP 403)',
      'Text-to-Speech coupé (HTTP 403)',
      'Text-to-Speech coupé (HTTP 403)',
    ]);
  });

  it('sans clé : aucun appel, audio désactivé, code 0 avec un avertissement', async () => {
    const { outDir, dayDir } = makeDay();
    const net = fakeTts();
    const r = await run(outDir, net, { apiKey: '   ' });
    expect([r.exitCode, r.report.status, net.requests.length]).toEqual([0, 'disabled', 0]);
    expect(r.report.issues).toEqual([{ level: 'warning', message: 'GOOGLE_TTS_API_KEY absente : audio désactivé, éditions publiées sans lecteur' }]);
    expect(readJson(join(dayDir, 'audio-report.json')).status).toBe('disabled');
  });

  it('supprime d’abord les anciens MP3, audio.json et rapport, même sans clé', async () => {
    const { outDir, dayDir } = makeDay();
    const stale = [`Daily Brief ${DAY} FR.mp3`, `Daily Brief ${DAY} ES.mp3.tmp`, 'audio.json', 'audio-report.json'];
    for (const f of stale) writeFileSync(join(dayDir, f), 'ancien');
    await run(outDir, fakeTts(), { apiKey: undefined });
    for (const f of stale.slice(0, 3)) expect(existsSync(join(dayDir, f))).toBe(false);
    expect(readJson(join(dayDir, 'audio-report.json')).status).toBe('disabled');
  });

  it('entrée invalide : date incorrecte (rien n’est créé), aucune édition vérifiée, voices.json invalide : code 2', async () => {
    const outDir = mkdtempSync(join(tmpdir(), 'audio-'));
    const bad = await runAudio({ outDir, date: '2026-02-30', apiKey: KEY, fetch: fakeTts().fetch, ffmpeg: null });
    expect([bad.exitCode, bad.report.status, bad.reportWritten]).toEqual([2, 'invalid', false]);
    expect(readdirSync(outDir)).toEqual([]);

    const empty = makeDay([]);
    const none = await run(empty.outDir, fakeTts());
    expect([none.exitCode, none.report.status]).toEqual([2, 'invalid']);
    expect(none.report.issues.at(-1)?.message).toBe('aucune édition vérifiée lisible : pas d’audio');

    const day = makeDay(['fr']);
    const voicesPath = join(day.outDir, 'voices.json');
    writeFileSync(voicesPath, '{}');
    const cfg = await run(day.outDir, fakeTts(), { voicesPath });
    expect([cfg.exitCode, cfg.report.status]).toEqual([2, 'invalid']);
    expect(cfg.report.issues[0].message).toMatch(/^voices\.json invalide/);
  });

  it('édition absente, illisible ou d’une autre date : signalée, les autres sont lues', async () => {
    const { outDir, dayDir } = makeDay(['fr']);
    writeFileSync(join(dayDir, 'en.verified.json'), '{ pas du json');
    writeFileSync(join(dayDir, 'es.verified.json'), JSON.stringify({ ...fixtureEdition('es'), date: '2026-11-05' }));
    const r = await run(outDir, fakeTts());
    expect([r.exitCode, r.report.status]).toEqual([0, 'ok']);
    expect(r.report.editions.map((e) => e.lang)).toEqual(['fr']);
    expect(r.report.issues.filter((i) => i.level === 'error')).toEqual([
      { level: 'error', lang: 'en', message: expect.stringMatching(/^en\.verified\.json illisible : /) },
      { level: 'error', lang: 'es', message: 'es.verified.json contient l’édition es du 2026-11-05 (attendu : es, 2026-11-06)' },
    ]);
  });

  it('plafond du passage : les éditions qui ne tiennent plus sont sautées sans appel', async () => {
    const { outDir } = makeDay();
    const net = fakeTts();
    const frChars = [...fixtureEdition('fr').audioScript.replace(/\s+/g, ' ').trim()].length;
    const r = await run(outDir, net, { budget: new CharBudget(5000, frChars + 10) });
    expect(net.requests).toHaveLength(1);
    expect([r.exitCode, r.report.status, r.report.characters.sent]).toEqual([0, 'degraded', frChars]);
    expect(r.report.editions[1].error).toBe(`plafond du passage atteint (${frChars} caractères envoyés, ${frChars + 10} au plus)`);
  });

  it('aucun secret dans le rapport, les messages ni audio.json, même si une erreur réseau cite la clé', async () => {
    const { outDir, dayDir } = makeDay();
    const net = fakeTts(() => ({ error: new Error(`connect ECONNRESET https://texttospeech.googleapis.com/v1/text:synthesize?key=${KEY} (x-goog-api-key: ${KEY})`) }));
    const r = await run(outDir, net);
    expect(r.exitCode).toBe(1);
    const everything = JSON.stringify(r.report) + readFileSync(join(dayDir, 'audio-report.json'), 'utf8');
    expect(everything).not.toContain(KEY);
    expect(everything).toContain('***');
    expect(net.calls.every((c) => !c.url.includes(KEY) && c.headers?.['x-goog-api-key'] === KEY)).toBe(true);
  });

  it('échéance globale : le passage s’arrête sans attendre, code 1', async () => {
    const { outDir } = makeDay();
    const net = fakeTts(() => ({ hang: true }));
    const r = await run(outDir, net, { deadlineMs: 30 });
    expect(r.exitCode).toBe(1);
    expect(r.report.editions[0].error).toBe('morceau 1/1 : échéance du passage dépassée');
    // Après l'échéance, plus rien n'est envoyé ni compté.
    expect(net.requests).toHaveLength(1);
    expect(r.report.editions.slice(1).map((e) => [e.error, e.characters])).toEqual([
      ['morceau 1/1 : échéance du passage dépassée', 0],
      ['morceau 1/1 : échéance du passage dépassée', 0],
    ]);
  });

  it('déterministe : deux passages identiques donnent les mêmes MP3 et le même audio.json', async () => {
    const a = makeDay();
    const b = makeDay();
    await run(a.outDir, fakeTts());
    await run(b.outDir, fakeTts());
    for (const f of [`Daily Brief ${DAY} FR.mp3`, 'audio.json']) expect(readFileSync(join(a.dayDir, f))).toEqual(readFileSync(join(b.dayDir, f)));
  });

  it.skipIf(!FFMPEG)('avec ffmpeg (ignoré s’il est absent) : trames de silence décodables réencodées, méthode ffmpeg, aucun avertissement ffmpeg', async () => {
    const { outDir } = makeDay(['fr']);
    const r = await run(outDir, fakeTts(() => okSynth(0)), { ffmpeg: FFMPEG });
    expect([r.exitCode, r.report.ffmpeg, r.report.editions[0].method]).toEqual([0, true, 'ffmpeg']);
    expect(r.report.editions[0].duration).toBe('0:03');
    expect(r.report.issues.some((i) => i.message.includes('ffmpeg'))).toBe(false);
  }, 30_000);
});
```

Fichier `pipeline/test/audio/routine-order.test.ts` :

```ts
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { runAudio } from '../../audio/run-audio';
import { runRender } from '../../render/run-render';
import { fixtureEdition } from '../helpers';
import { fakeFetch } from '../render/fake-fetch';
import { fakeTts } from './fake-tts';

const DAY = '2026-11-06';
const KEY = 'AIzaSy-cle-de-test-0123456789';

function day() {
  const outDir = mkdtempSync(join(tmpdir(), 'routine-'));
  const dayDir = join(outDir, DAY);
  mkdirSync(dayDir, { recursive: true });
  for (const lang of ['fr', 'en', 'es'] as const) writeFileSync(join(dayDir, `${lang}.verified.json`), JSON.stringify(fixtureEdition(lang)));
  return { outDir, dayDir };
}

/** Rendu sans Chromium : on garde le HTML et on écrit un faux PDF. */
async function render(outDir: string) {
  const printed: string[] = [];
  const r = await runRender({
    outDir,
    date: DAY,
    fetch: fakeFetch({}).fetch,
    print: async (html, outPath) => {
      printed.push(html);
      writeFileSync(outPath, '%PDF-1.7\n%%EOF\n');
    },
  });
  return { r, html: printed[0] ?? '' };
}

describe('ordre de la routine : brief:audio puis brief:render', () => {
  it('l’encart audio du PDF porte la durée de chaque édition écrite par brief:audio', async () => {
    const { outDir } = day();
    expect((await runAudio({ outDir, date: DAY, apiKey: KEY, fetch: fakeTts().fetch, ffmpeg: null })).exitCode).toBe(0);
    const { r, html } = await render(outDir);
    expect(r.exitCode).toBe(0);
    expect(html.match(/0:03 · voix Chirp HD/g)).toHaveLength(3);
  });

  it('audio en échec : le PDF est rendu quand même, sans encart audio', async () => {
    const { outDir, dayDir } = day();
    const audio = await runAudio({ outDir, date: DAY, apiKey: KEY, fetch: fakeTts(() => ({ status: 403, json: {} })).fetch, ffmpeg: null });
    expect(audio.exitCode).toBe(1);
    const { r, html } = await render(outDir);
    expect(r.exitCode).toBe(0);
    expect(existsSync(join(dayDir, `Daily Brief ${DAY}.pdf`))).toBe(true);
    expect(html).not.toContain('Version audio');
  });

  it('brief:audio ne lit que les éditions vérifiées et n’écrit rien que brief:render remplace', async () => {
    const { outDir, dayDir } = day();
    await runAudio({ outDir, date: DAY, apiKey: KEY, fetch: fakeTts().fetch, ffmpeg: null });
    const before = readFileSync(join(dayDir, `Daily Brief ${DAY} FR.mp3`));
    await render(outDir);
    expect(readFileSync(join(dayDir, `Daily Brief ${DAY} FR.mp3`))).toEqual(before);
    expect(existsSync(join(dayDir, 'audio.json'))).toBe(true);
  });
});
```

- [ ] **Étape 2 : vérifier l'échec**

Commande : `npx vitest run pipeline/test/audio/run-audio.test.ts pipeline/test/audio/routine-order.test.ts`
Attendu : échec, « Failed to load url ../../audio/run-audio », `Test Files  2 failed (2)`.

- [ ] **Étape 3 : élargir `writeAtomic` et écrire l'orchestration**

Dans `pipeline/lib/fs.ts`, remplacer :

```ts
/**
 * Écriture atomique : fichier temporaire (`<chemin>.tmp`) puis renommage, pour qu'une coupure ne laisse jamais
 * un fichier tronqué. En cas d'échec, le fichier temporaire est retiré si possible et l'erreur est remontée.
 */
export function writeAtomic(path: string, text: string): void {
```

par :

```ts
/**
 * Écriture atomique (texte ou octets) : fichier temporaire (`<chemin>.tmp`) puis renommage, pour qu'une coupure ne laisse jamais
 * un fichier tronqué. En cas d'échec, le fichier temporaire est retiré si possible et l'erreur est remontée.
 */
export function writeAtomic(path: string, text: string | Uint8Array): void {
```

Fichier `pipeline/audio/run-audio.ts` :

```ts
import { existsSync, mkdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { IsoDateSchema, LANGS, parseEdition, type Edition, type Lang } from '@daily-brief/schema';
import { Breaker } from '../collect/breaker';
import type { HttpFetch } from '../collect/http';
import { writeAtomic } from '../lib/fs';
import { redactText, stripSecrets } from '../lib/redact';
import { looksLikeMp3, mp3FileName } from '../publish/files';
import { MAX_JSON_BYTES, MAX_MP3_BYTES } from '../publish/inputs';
import { CharBudget } from './budget';
import { findFfmpeg, type ConcatMethod } from './concat';
import { formatDuration } from './mp3';
import { voiceEdition, VoiceEditionError } from './voice-edition';
import { loadVoices, VOICES_PATH, type Voices } from './voices';

/** Échéance globale de `brief:audio` : la routine n'attend jamais l'audio plus de 10 minutes. */
export const AUDIO_DEADLINE_MS = 10 * 60_000;

export type AudioIssue = { level: 'error' | 'warning'; lang?: Lang; message: string };

export type AudioEditionReport = {
  lang: Lang;
  voice: string;
  chunks: number;
  /** Caractères envoyés à Text-to-Speech pour cette édition. */
  characters: number;
  /** Nom du MP3 écrit, ou null (édition publiée sans lecteur). */
  file: string | null;
  /** Durée « m:ss », comme dans audio.json. */
  duration: string | null;
  seconds: number | null;
  bytes: number | null;
  method: ConcatMethod | null;
  error: string | null;
};

/**
 * - `ok` : un MP3 par édition vérifiée ; `degraded` : au moins un MP3, mais pas pour toutes ;
 * - `disabled` : pas de clé, aucun appel (avertissement) ; `failed` : clé présente, aucun MP3 ;
 * - `invalid` : entrée inutilisable (date, voices.json, aucune édition vérifiée lisible).
 */
export type AudioStatus = 'ok' | 'degraded' | 'disabled' | 'failed' | 'invalid';

export type AudioReport = {
  date: string;
  generatedAt: string;
  exitCode: 0 | 1 | 2;
  status: AudioStatus;
  /** Voix confirmées dans voices.json (null si le fichier est illisible). */
  voicesConfirmed: boolean | null;
  /** ffmpeg trouvé (réencodage 64 kb/s mono) ; sinon concaténation des trames. */
  ffmpeg: boolean;
  characters: { sent: number; maxPerEdition: number; maxPerRun: number };
  editions: AudioEditionReport[];
  issues: AudioIssue[];
};

export type RunAudioOptions = {
  outDir: string;
  date: string;
  /** `GOOGLE_TTS_API_KEY` ; sans clé, l'audio est désactivé (code 0, avertissement). */
  apiKey?: string;
  fetch: HttpFetch;
  /** Chemin de ffmpeg, null pour s'en passer ; par défaut, recherche dans le PATH. */
  ffmpeg?: string | null;
  voicesPath?: string;
  budget?: CharBudget;
  deadlineMs?: number;
  /** Délai d'une requête de synthèse. */
  timeoutMs?: number;
  maxChunkBytes?: number;
};

export type RunAudioResult = { exitCode: 0 | 1 | 2; report: AudioReport; reportWritten: boolean };

/** Fichiers de `brief:audio` dans le dossier du jour, supprimés avant tout travail. */
export const audioOutputs = (date: string): string[] => [...LANGS.flatMap((l) => [mp3FileName(date, l), `${mp3FileName(date, l)}.tmp`]), 'audio.json', 'audio.json.tmp', 'audio-report.json', 'audio-report.json.tmp'];

/** Lit `{lang}.verified.json` (taille bornée), contrôlé contre sa langue et sa date. */
function readEdition(dayDir: string, lang: Lang, date: string): { edition?: Edition; issue?: AudioIssue } {
  const name = `${lang}.verified.json`;
  const path = join(dayDir, name);
  if (!existsSync(path)) return { issue: { level: 'warning', lang, message: `${name} absent : pas d'audio pour cette édition` } };
  try {
    if (statSync(path).size > MAX_JSON_BYTES) throw new Error(`fichier trop lourd (plus de ${MAX_JSON_BYTES} octets)`);
    const parsed = parseEdition(JSON.parse(readFileSync(path, 'utf8')));
    if (!parsed.success) return { issue: { level: 'error', lang, message: `${name} invalide : ${parsed.errors.slice(0, 3).join(' ; ')}` } };
    if (parsed.data.lang !== lang || parsed.data.date !== date) {
      return { issue: { level: 'error', lang, message: `${name} contient l’édition ${parsed.data.lang} du ${parsed.data.date} (attendu : ${lang}, ${date})` } };
    }
    return { edition: parsed.data };
  } catch (e) {
    return { issue: { level: 'error', lang, message: `${name} illisible : ${(e as Error).message}` } };
  }
}

/**
 * `brief:audio` : lit l'`audioScript` de chaque `{lang}.verified.json`, le fait lire par la voix
 * Chirp 3 HD de l'édition, écrit `Daily Brief <date> FR.mp3` (EN, ES), `audio.json`
 * (`{ fr: { duration: "3:24" } }`, lu par brief:render) et `audio-report.json`.
 *
 * L'audio ne bloque jamais la routine (spec §9 et §12) : une édition en échec est publiée sans
 * lecteur, les autres continuent. Codes : 0 = au moins un MP3, ou audio désactivé faute de clé ;
 * 1 = clé présente mais aucun MP3 ; 2 = entrée invalide. Quel que soit le code, la routine
 * enchaîne sur brief:render.
 */
export async function runAudio(opts: RunAudioOptions): Promise<RunAudioResult> {
  const apiKey = opts.apiKey?.trim() || undefined;
  const budget = opts.budget ?? new CharBudget();
  const issues: AudioIssue[] = [];
  const editions: AudioEditionReport[] = [];
  const report: AudioReport = {
    date: opts.date,
    generatedAt: '',
    exitCode: 2,
    status: 'invalid',
    voicesConfirmed: null,
    ffmpeg: false,
    characters: { sent: 0, maxPerEdition: budget.perEdition, maxPerRun: budget.perRun },
    editions,
    issues,
  };
  const secrets = [apiKey];
  const issue = (level: AudioIssue['level'], message: string, lang?: Lang) => issues.push({ level, ...(lang ? { lang } : {}), message: redactText(message, secrets) });

  if (!IsoDateSchema.safeParse(opts.date).success) {
    issue('error', `date incorrecte : « ${opts.date} »`);
    report.generatedAt = new Date().toISOString();
    return { exitCode: 2, report, reportWritten: false };
  }
  const dayDir = join(opts.outDir, opts.date);

  const finish = (exitCode: 0 | 1 | 2, status: AudioStatus): RunAudioResult => {
    report.exitCode = exitCode;
    report.status = status;
    report.characters.sent = budget.sent;
    report.generatedAt = new Date().toISOString();
    try {
      writeAtomic(join(dayDir, 'audio-report.json'), stripSecrets(JSON.stringify(report, null, 2), secrets) + '\n');
      return { exitCode, report, reportWritten: true };
    } catch {
      return { exitCode, report, reportWritten: false };
    }
  };

  try {
    mkdirSync(dayDir, { recursive: true });
    // Les anciens MP3 d'abord : brief:publish prend tout MP3 présent pour une édition publiable.
    for (const name of audioOutputs(opts.date)) rmSync(join(dayDir, name), { force: true });
  } catch (e) {
    issue('error', `anciens fichiers audio impossibles à supprimer : ${(e as Error).message}`);
    return finish(2, 'invalid');
  }

  let voices: Voices;
  try {
    voices = loadVoices(opts.voicesPath ?? VOICES_PATH);
  } catch (e) {
    issue('error', (e as Error).message);
    return finish(2, 'invalid');
  }
  report.voicesConfirmed = voices.confirmed;

  const todo: Edition[] = [];
  for (const lang of LANGS) {
    const r = readEdition(dayDir, lang, opts.date);
    if (r.issue) issues.push(r.issue);
    if (r.edition) todo.push(r.edition);
  }
  if (todo.length === 0) {
    issue('error', 'aucune édition vérifiée lisible : pas d’audio');
    return finish(2, 'invalid');
  }

  if (!apiKey) {
    issue('warning', 'GOOGLE_TTS_API_KEY absente : audio désactivé, éditions publiées sans lecteur');
    return finish(0, 'disabled');
  }
  if (!voices.confirmed) issue('warning', 'voix par défaut non confirmées : lancer npm run audio:samples et choisir les voix (voices.json)');

  const ffmpeg = opts.ffmpeg !== undefined ? opts.ffmpeg : findFfmpeg();
  report.ffmpeg = ffmpeg !== null;
  if (!ffmpeg) issue('warning', 'ffmpeg absent : trames concaténées sans réencodage (débit de la source)');

  const signal = AbortSignal.timeout(opts.deadlineMs ?? AUDIO_DEADLINE_MS);
  const breaker = new Breaker();
  const durations: Partial<Record<Lang, { duration: string }>> = {};
  try {
    for (const ed of todo) {
      const voice = voices[ed.lang];
      const entry: AudioEditionReport = { lang: ed.lang, voice: voice.name, chunks: 0, characters: 0, file: null, duration: null, seconds: null, bytes: null, method: null, error: null };
      editions.push(entry);
      const fail = (message: string) => {
        entry.error = redactText(message, secrets);
        issue('error', `${message} : édition publiée sans lecteur`, ed.lang);
      };
      let voiced;
      try {
        voiced = await voiceEdition(ed.audioScript, voice, { client: { apiKey, fetch: opts.fetch, signal, timeoutMs: opts.timeoutMs }, breaker, budget, ffmpeg, maxChunkBytes: opts.maxChunkBytes });
      } catch (e) {
        if (e instanceof VoiceEditionError) entry.characters = e.characters;
        fail(e instanceof Error ? e.message : String(e));
        continue;
      }
      Object.assign(entry, { chunks: voiced.chunks, characters: voiced.characters, method: voiced.method, seconds: Math.round(voiced.seconds * 100) / 100 });
      for (const w of voiced.warnings) issue('warning', w, ed.lang);
      if (voiced.bytes.length > MAX_MP3_BYTES || !looksLikeMp3(voiced.bytes)) {
        fail(`MP3 refusé (${voiced.bytes.length} octets, ${MAX_MP3_BYTES} au plus, en-tête MP3 exigé)`);
        continue;
      }
      const name = mp3FileName(opts.date, ed.lang);
      try {
        writeAtomic(join(dayDir, name), voiced.bytes);
      } catch (e) {
        fail(`${name} impossible à écrire : ${(e as Error).message}`);
        continue;
      }
      Object.assign(entry, { file: name, bytes: voiced.bytes.length, duration: formatDuration(voiced.seconds) });
      durations[ed.lang] = { duration: entry.duration! };
    }
  } catch (e) {
    issue('error', `erreur inattendue : ${(e as Error).message}`);
  }

  const made = editions.filter((e) => e.file !== null).length;
  if (made > 0) {
    try {
      writeAtomic(join(dayDir, 'audio.json'), JSON.stringify(durations, null, 2) + '\n');
    } catch (e) {
      issue('warning', `audio.json impossible à écrire, PDF sans encart audio : ${(e as Error).message}`);
    }
  }
  if (made === 0) return finish(1, 'failed');
  return finish(0, made === todo.length ? 'ok' : 'degraded');
}
```

- [ ] **Étape 4 : vérifier le succès**

Commande : `npx vitest run pipeline/test/audio/run-audio.test.ts pipeline/test/audio/routine-order.test.ts`
Attendu : `Test Files  2 passed (2)` et `Tests  16 passed (16)` (sans ffmpeg : `Tests  15 passed | 1 skipped (16)`).

Commande : `npm test && npm run typecheck`
Attendu : `Test Files  75 passed (75)`, `Tests  793 passed (793)`, et `tsc` sans sortie.

- [ ] **Étape 5 : commit**

```bash
git add pipeline/audio/run-audio.ts pipeline/lib/fs.ts pipeline/test/audio/run-audio.test.ts pipeline/test/audio/routine-order.test.ts
git commit -m "feat(audio): orchestration de brief:audio, audio.json et rapport"
```

---

### Tâche 8 : commande `npm run brief:audio`

**Fichiers :**
- Créer : `pipeline/audio/cli.ts`
- Modifier : `package.json` (script), `pipeline/test/run-cli.ts` (`GOOGLE_TTS_API_KEY` retirée des CLI testés)
- Test : `pipeline/test/audio/fake-tts-preload.ts`, `pipeline/test/audio/cli.test.ts`

Comportement attendu :
- **Variables.** Le CLI charge `.env` par `loadEnv`, qui retire d'abord une variable blanche. La clé est rognée.
- **Sortie.** Il affiche les problèmes, l'état de chaque édition (fichier, durée, morceaux, caractères, méthode, ou « sans lecteur ») et un résumé selon le `status`, puis sort avec le code du rapport.
- **Option `--no-ffmpeg`.** Elle force la concaténation des trames.
- **Erreurs.** Sans clé : code 0 et aucun appel. Clé refusée : code 1, sans secret affiché ni écrit. Date invalide : code 2, rien n'est écrit. Une erreur de haut niveau ne cite pas la clé.
- **Script npm.** `npm run brief:audio` pointe sur ce CLI.

- [ ] **Étape 1 : écrire le faux fetch préchargé, les tests, et protéger les CLI testés**

Fichier `pipeline/test/audio/fake-tts-preload.ts` :

```ts
import { appendFileSync } from 'node:fs';
import { fakeTts, okSynth } from './fake-tts';

/**
 * Module de préchargement des tests de CLI audio : remplace `fetch` par un faux Text-to-Speech
 * (aucun appel réel). `FAKE_TTS=403` : clé refusée ; sinon un MP3 de 3 s par morceau. Chaque URL
 * et la valeur de `x-goog-api-key` sont ajoutées au fichier `FAKE_FETCH_LOG`.
 */
const net = fakeTts(() => (process.env.FAKE_TTS === '403' ? { status: 403, json: { error: { code: 403, status: 'PERMISSION_DENIED' } } } : okSynth()));
globalThis.fetch = (async (url: string, init?: Parameters<typeof net.fetch>[1]) => {
  if (process.env.FAKE_FETCH_LOG) appendFileSync(process.env.FAKE_FETCH_LOG, `${url} ${init?.headers?.['x-goog-api-key'] ?? '-'}\n`);
  return net.fetch(url, init);
}) as unknown as typeof fetch;
```

Fichier `pipeline/test/audio/cli.test.ts` :

```ts
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { fixtureEdition } from '../helpers';
import { runCli } from '../run-cli';

const DAY = '2026-11-06';
const KEY = 'AIzaSy-cle-de-test-0123456789';
const PRELOAD = 'pipeline/test/audio/fake-tts-preload.ts';

/** Dossier du jour avec les trois éditions vérifiées de la fixture ; `--out` absolu. */
function audioCli(env: Record<string, string> = {}, files?: Record<string, string>, args: string[] = []) {
  const outDir = mkdtempSync(join(tmpdir(), 'audio-cli-'));
  const dayDir = join(outDir, DAY);
  mkdirSync(dayDir);
  for (const lang of ['fr', 'en', 'es'] as const) writeFileSync(join(dayDir, `${lang}.verified.json`), JSON.stringify(fixtureEdition(lang)));
  const log = join(outDir, 'fetch.log');
  const r = runCli('pipeline/audio/cli.ts', ['--date', DAY, '--out', outDir, '--no-ffmpeg', ...args], { FAKE_FETCH_LOG: log, ...env }, { files, preload: PRELOAD });
  return { ...r, dayDir, log: existsSync(log) ? readFileSync(log, 'utf8') : '' };
}

describe('CLI brief:audio', () => {
  it('sans clé : code 0, audio désactivé, aucun appel', () => {
    const r = audioCli();
    expect(r.status).toBe(0);
    expect(r.stdout).toBe(
      'brief:audio 2026-11-06\n' + '[warning] GOOGLE_TTS_API_KEY absente : audio désactivé, éditions publiées sans lecteur\n' + 'Audio désactivé : éditions publiées sans lecteur.\n',
    );
    expect(r.log).toBe('');
    expect(JSON.parse(readFileSync(join(r.dayDir, 'audio-report.json'), 'utf8')).status).toBe('disabled');
  }, 30_000);

  it('avec une clé (faux service) : trois MP3, audio.json, code 0 ; la clé passe en en-tête', () => {
    const r = audioCli({ GOOGLE_TTS_API_KEY: `  ${KEY}  ` });
    expect(r.status).toBe(0);
    expect(r.stdout).toContain(`FR : Daily Brief ${DAY} FR.mp3 (0:03, 1 morceau(x), `);
    expect(r.stdout).toContain('[warning] ffmpeg absent : trames concaténées sans réencodage (débit de la source)\n');
    expect(r.stdout).toMatch(/Audio complet : 3 MP3, \d+ caractères envoyés\.\n$/);
    expect(JSON.parse(readFileSync(join(r.dayDir, 'audio.json'), 'utf8'))).toEqual({ fr: { duration: '0:03' }, en: { duration: '0:03' }, es: { duration: '0:03' } });
    expect(r.log.trim().split('\n')).toEqual(Array(3).fill(`https://texttospeech.googleapis.com/v1/text:synthesize ${KEY}`));
  }, 30_000);

  it('clé refusée : code 1 (audio en échec, la routine continue), aucun secret affiché ni écrit', () => {
    const r = audioCli({ GOOGLE_TTS_API_KEY: KEY, FAKE_TTS: '403' });
    expect(r.status).toBe(1);
    expect(r.stdout).toContain('[error] FR morceau 1/1 : HTTP 403 (https://texttospeech.googleapis.com/v1/text:synthesize) — Text-to-Speech coupé (HTTP 403) : édition publiée sans lecteur');
    expect(r.stdout).toContain('ES : sans lecteur');
    expect(r.stdout).toContain('Audio en échec : éditions publiées sans lecteur.');
    expect(r.stdout + r.stderr + readFileSync(join(r.dayDir, 'audio-report.json'), 'utf8')).not.toContain(KEY);
  }, 30_000);

  it('lit la clé dans .env', () => {
    const r = audioCli({}, { '.env': `GOOGLE_TTS_API_KEY=${KEY}\n` });
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('Audio complet : 3 MP3');
  }, 30_000);

  it('date invalide : code 2, rien n’est écrit', () => {
    const r = runCli('pipeline/audio/cli.ts', ['--date', '2026-02-30'], {}, { preload: PRELOAD });
    expect(r.status).toBe(2);
    expect(r.stdout).toContain('[error] date incorrecte : « 2026-02-30 »');
    expect(r.stdout).toContain('Erreur : entrée invalide, pas d’audio.');
    expect(existsSync(join(r.cwd, 'out'))).toBe(false);
  }, 30_000);

  it('une erreur de haut niveau ne cite pas la clé', () => {
    const r = runCli('pipeline/audio/cli.ts', [`--${KEY}`], { GOOGLE_TTS_API_KEY: KEY }, { preload: PRELOAD });
    expect(r.status).toBe(2);
    expect(r.stderr).toContain('brief:audio :');
    expect(r.stderr).not.toContain(KEY);
  }, 30_000);

  it('le script npm brief:audio pointe sur ce CLI', () => {
    const pkg = JSON.parse(readFileSync(new URL('../../../package.json', import.meta.url), 'utf8'));
    expect(pkg.scripts['brief:audio']).toBe('tsx pipeline/audio/cli.ts');
  });
});
```

Dans `pipeline/test/run-cli.ts`, remplacer :

```ts
const SECRET_VARS = ['THENEWSAPI_KEY', 'EXA_API_KEY', 'WEBZ_TOKEN', 'PEXELS_API_KEY', 'SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'APPS_SCRIPT_URL', 'APPS_SCRIPT_TOKEN'];
```

par :

```ts
const SECRET_VARS = ['THENEWSAPI_KEY', 'EXA_API_KEY', 'WEBZ_TOKEN', 'PEXELS_API_KEY', 'SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'APPS_SCRIPT_URL', 'APPS_SCRIPT_TOKEN', 'GOOGLE_TTS_API_KEY'];
```

- [ ] **Étape 2 : vérifier l'échec**

Commande : `npx vitest run pipeline/test/audio/cli.test.ts`
Attendu : échec, `Tests  7 failed (7)` (le CLI n'existe pas : chaque lancement sort avec le code 1).

- [ ] **Étape 3 : écrire le CLI et le script npm**

Fichier `pipeline/audio/cli.ts` :

```ts
import { parseArgs } from 'node:util';
import { IsoDateSchema } from '@daily-brief/schema';
import type { HttpFetch } from '../collect/http';
import { parisToday } from '../lib/date';
import { loadEnv } from '../lib/env';
import { redactText } from '../lib/redact';
import { runAudio } from './run-audio';

try {
  loadEnv(['GOOGLE_TTS_API_KEY']);
  const { values } = parseArgs({ options: { date: { type: 'string' }, out: { type: 'string', default: 'out' }, 'no-ffmpeg': { type: 'boolean', default: false } } });
  const date = values.date ?? parisToday();
  const { exitCode, report, reportWritten } = await runAudio({
    outDir: values.out!,
    date,
    apiKey: process.env.GOOGLE_TTS_API_KEY,
    fetch: fetch as HttpFetch,
    ...(values['no-ffmpeg'] ? { ffmpeg: null } : {}),
  });
  console.log(`brief:audio ${date}`);
  for (const i of report.issues) console.log(`[${i.level}]${i.lang ? ' ' + i.lang.toUpperCase() : ''} ${i.message}`);
  for (const e of report.editions) console.log(`${e.lang.toUpperCase()} : ${e.file ? `${e.file} (${e.duration}, ${e.chunks} morceau(x), ${e.characters} caractères, ${e.method})` : 'sans lecteur'}`);
  if (!reportWritten && IsoDateSchema.safeParse(date).success) console.error('brief:audio : audio-report.json n’a pas pu être écrit.');
  const made = report.editions.filter((e) => e.file).length;
  const summary = {
    ok: `Audio complet : ${made} MP3, ${report.characters.sent} caractères envoyés.`,
    degraded: `Audio partiel : ${made} MP3 sur ${report.editions.length}, ${report.characters.sent} caractères envoyés.`,
    disabled: 'Audio désactivé : éditions publiées sans lecteur.',
    failed: 'Audio en échec : éditions publiées sans lecteur.',
    invalid: 'Erreur : entrée invalide, pas d’audio.',
  }[report.status];
  console.log(summary);
  process.exit(exitCode);
} catch (e) {
  console.error(`brief:audio : ${redactText(e instanceof Error ? e.message : String(e), [process.env.GOOGLE_TTS_API_KEY?.trim()])}`);
  process.exit(2);
}
```

Dans `package.json`, remplacer :

```json
    "brief:verify": "tsx pipeline/verify/cli.ts",
    "brief:render": "tsx pipeline/render/cli.ts",
```

par :

```json
    "brief:verify": "tsx pipeline/verify/cli.ts",
    "brief:audio": "tsx pipeline/audio/cli.ts",
    "brief:render": "tsx pipeline/render/cli.ts",
```

- [ ] **Étape 4 : vérifier le succès**

Commande : `npx vitest run pipeline/test/audio/cli.test.ts`
Attendu : `Test Files  1 passed (1)` et `Tests  7 passed (7)`.

Commande : `npm test && npm run typecheck`
Attendu : `Test Files  76 passed (76)`, `Tests  800 passed (800)`, et `tsc` sans sortie.

- [ ] **Étape 5 : commit**

```bash
git add pipeline/audio/cli.ts package.json pipeline/test/run-cli.ts pipeline/test/audio/fake-tts-preload.ts pipeline/test/audio/cli.test.ts
git commit -m "feat(audio): commande npm run brief:audio"
```

---

### Tâche 9 : échantillons de voix (`npm run audio:samples`)

**Fichiers :**
- Créer : `pipeline/audio/samples.ts`, `pipeline/audio/samples-cli.ts`
- Modifier : `package.json` (script)
- Test : `pipeline/test/audio/samples.test.ts`, `pipeline/test/audio/samples-cli.test.ts`

Comportement attendu :
- **Choix des voix.** La voix configurée vient d'abord, puis les autres, en alternant en-US et en-GB. Si la voix configurée est absente, seules les voix trouvées servent, sans doublon et sans dépasser le nombre demandé.
- **Passage.** `voices.list` est appelé pour fr-FR, en-US, en-GB et es-ES. La commande écrit 3 échantillons par langue et `index.json` (toutes les voix, échantillons, caractères), après avoir vidé le dossier.
- **Erreurs.** Un échantillon en échec donne le code 1, avec une erreur notée sans la clé. Une voix configurée absente est signalée. Une clé refusée coupe le service dès la première liste : code 2, mais `index.json` est écrit.
- **CLI.** Sans clé : code 2 et un message d'aide. `--count` choisit le nombre d'échantillons (1 à 10). Un `--count` invalide donne le code 2.
- **Script npm.** `npm run audio:samples` pointe sur ce CLI.

- [ ] **Étape 1 : écrire les tests**

Fichier `pipeline/test/audio/samples.test.ts` :

```ts
import { existsSync, mkdtempSync, readdirSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { pickSampleVoices, runVoiceSamples, SAMPLE_TEXTS } from '../../audio/samples';
import { chirp3HdVoices, type VoiceInfo } from '../../audio/tts';
import { loadVoices } from '../../audio/voices';
import { looksLikeMp3 } from '../../publish/files';
import { fakeTts, okSynth, voicesOf } from './fake-tts';

const KEY = 'AIzaSy-cle-de-test-0123456789';
const names = (code: string) => chirp3HdVoices((voicesOf(code).json as { voices: VoiceInfo[] }).voices, code);

describe('pickSampleVoices', () => {
  it('la voix configurée d’abord, puis les autres, en alternant en-US et en-GB', () => {
    expect(pickSampleVoices({ 'en-US': names('en-US'), 'en-GB': names('en-GB') }, 'en-US-Chirp3-HD-Charon', 3)).toEqual(['en-US-Chirp3-HD-Charon', 'en-US-Chirp3-HD-Aoede', 'en-GB-Chirp3-HD-Aoede']);
  });

  it('voix configurée absente : seulement les voix trouvées ; jamais plus que demandé ni de doublon', () => {
    expect(pickSampleVoices({ 'fr-FR': names('fr-FR') }, 'fr-FR-Chirp3-HD-Inconnue', 2)).toEqual(['fr-FR-Chirp3-HD-Aoede', 'fr-FR-Chirp3-HD-Charon']);
    expect(pickSampleVoices({ 'fr-FR': names('fr-FR') }, 'fr-FR-Chirp3-HD-Kore', 10)).toEqual(['fr-FR-Chirp3-HD-Kore', 'fr-FR-Chirp3-HD-Aoede', 'fr-FR-Chirp3-HD-Charon', 'fr-FR-Chirp3-HD-Puck']);
    expect(pickSampleVoices({}, 'fr-FR-Chirp3-HD-Kore', 3)).toEqual([]);
  });
});

describe('runVoiceSamples', () => {
  it('liste les voix Chirp 3 HD, écrit 3 échantillons par langue et index.json ; code 0', async () => {
    const outDir = mkdtempSync(join(tmpdir(), 'samples-'));
    mkdirSync(join(outDir, 'voice-samples'));
    writeFileSync(join(outDir, 'voice-samples', 'ancien.mp3'), 'x');
    const net = fakeTts();
    const r = await runVoiceSamples({ apiKey: KEY, fetch: net.fetch, outDir, voices: loadVoices() });
    expect(r.exitCode).toBe(0);
    expect(net.calls.filter((c) => c.url.includes('/voices?')).map((c) => new URL(c.url).searchParams.get('languageCode'))).toEqual(['fr-FR', 'en-US', 'en-GB', 'es-ES']);
    expect(r.index.voices.fr).toEqual(['fr-FR-Chirp3-HD-Aoede', 'fr-FR-Chirp3-HD-Charon', 'fr-FR-Chirp3-HD-Kore', 'fr-FR-Chirp3-HD-Puck']);
    expect(r.index.voices.en).toHaveLength(8);
    expect(r.index.samples.map((s) => s.voice)).toEqual([
      'fr-FR-Chirp3-HD-Aoede', 'fr-FR-Chirp3-HD-Charon', 'fr-FR-Chirp3-HD-Kore',
      'en-US-Chirp3-HD-Charon', 'en-US-Chirp3-HD-Aoede', 'en-GB-Chirp3-HD-Aoede',
      'es-ES-Chirp3-HD-Kore', 'es-ES-Chirp3-HD-Aoede', 'es-ES-Chirp3-HD-Charon',
    ]);
    expect(net.requests[5].voice).toEqual({ languageCode: 'en-GB', name: 'en-GB-Chirp3-HD-Aoede' });
    expect(net.requests.map((q) => q.text)).toEqual([...Array(3).fill(SAMPLE_TEXTS.fr), ...Array(3).fill(SAMPLE_TEXTS.en), ...Array(3).fill(SAMPLE_TEXTS.es)]);
    expect(readdirSync(r.dir).sort()).toEqual([...r.index.samples.map((s) => s.file!), 'index.json'].sort());
    expect(looksLikeMp3(readFileSync(join(r.dir, 'fr-FR-Chirp3-HD-Aoede.mp3')))).toBe(true);
    expect(JSON.parse(readFileSync(join(r.dir, 'index.json'), 'utf8')).characters).toBe(r.index.characters);
    expect(net.calls.every((c) => c.headers?.['x-goog-api-key'] === KEY && !c.url.includes(KEY))).toBe(true);
  });

  it('un échantillon en échec : code 1, erreur notée sans la clé ; voix configurée absente signalée', async () => {
    const outDir = mkdtempSync(join(tmpdir(), 'samples-'));
    const net = fakeTts((q) => (q.voice.name.endsWith('Charon') && q.voice.languageCode === 'fr-FR' ? { error: new Error(`reset ${KEY}`) } : okSynth()));
    const voices = { ...loadVoices(), es: { languageCode: 'es-ES', name: 'es-ES-Chirp3-HD-Inconnue' } };
    const r = await runVoiceSamples({ apiKey: KEY, fetch: net.fetch, outDir, voices, count: 2 });
    expect(r.exitCode).toBe(1);
    expect(r.index.samples.find((s) => s.voice === 'fr-FR-Chirp3-HD-Charon')).toEqual({ lang: 'fr', voice: 'fr-FR-Chirp3-HD-Charon', file: null, error: 'reset ***' });
    expect(r.index.issues).toEqual(['es : la voix configurée es-ES-Chirp3-HD-Inconnue est absente de voices.list']);
    expect(readFileSync(join(r.dir, 'index.json'), 'utf8')).not.toContain(KEY);
  });

  it('clé refusée : le service est coupé dès la première liste, aucun échantillon, code 2', async () => {
    const outDir = mkdtempSync(join(tmpdir(), 'samples-'));
    const net = fakeTts(undefined, () => ({ status: 403, json: {} }));
    const r = await runVoiceSamples({ apiKey: KEY, fetch: net.fetch, outDir, voices: loadVoices() });
    expect(r.exitCode).toBe(2);
    expect(net.calls).toHaveLength(1);
    expect(r.index.issues).toEqual(['voices.list fr-FR : HTTP 403 (https://texttospeech.googleapis.com/v1/voices?languageCode=fr-FR)']);
    expect(existsSync(join(r.dir, 'index.json'))).toBe(true);
  });
});
```

Fichier `pipeline/test/audio/samples-cli.test.ts` :

```ts
import { mkdtempSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { runCli } from '../run-cli';

const KEY = 'AIzaSy-cle-de-test-0123456789';
const PRELOAD = 'pipeline/test/audio/fake-tts-preload.ts';

describe('CLI audio:samples', () => {
  it('sans clé : code 2 et message d’aide, aucun appel', () => {
    const r = runCli('pipeline/audio/samples-cli.ts', [], {}, { preload: PRELOAD });
    expect(r.status).toBe(2);
    expect(r.stderr).toBe('audio:samples : GOOGLE_TTS_API_KEY absente (voir docs/setup-audio.md).\n');
  }, 30_000);

  it('avec une clé (faux service) : 2 échantillons par langue dans <out>/voice-samples, code 0', () => {
    const out = mkdtempSync(join(tmpdir(), 'samples-cli-'));
    const r = runCli('pipeline/audio/samples-cli.ts', ['--out', out, '--count', '2'], { GOOGLE_TTS_API_KEY: KEY }, { preload: PRELOAD });
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('FR : 4 voix Chirp 3 HD (fr-FR-Chirp3-HD-Aoede, fr-FR-Chirp3-HD-Charon, fr-FR-Chirp3-HD-Kore, fr-FR-Chirp3-HD-Puck)');
    expect(r.stdout).toContain('6 échantillon(s)');
    expect(readdirSync(join(out, 'voice-samples')).filter((f) => f.endsWith('.mp3'))).toHaveLength(6);
    expect(r.stdout + readFileSync(join(out, 'voice-samples', 'index.json'), 'utf8')).not.toContain(KEY);
  }, 30_000);

  it('--count invalide : code 2, sans la clé dans le message', () => {
    const r = runCli('pipeline/audio/samples-cli.ts', ['--count', 'trois'], { GOOGLE_TTS_API_KEY: KEY }, { preload: PRELOAD });
    expect(r.status).toBe(2);
    expect(r.stderr).toBe('audio:samples : --count invalide : « trois »\n');
  }, 30_000);

  it('le script npm audio:samples pointe sur ce CLI', () => {
    const pkg = JSON.parse(readFileSync(new URL('../../../package.json', import.meta.url), 'utf8'));
    expect(pkg.scripts['audio:samples']).toBe('tsx pipeline/audio/samples-cli.ts');
  });
});
```

- [ ] **Étape 2 : vérifier l'échec**

Commande : `npx vitest run pipeline/test/audio/samples.test.ts pipeline/test/audio/samples-cli.test.ts`
Attendu : échec, « Failed to load url ../../audio/samples » pour le premier fichier et `Tests  4 failed (4)` pour le second, soit `Test Files  2 failed (2)`.

- [ ] **Étape 3 : écrire les échantillons, le CLI et le script npm**

Fichier `pipeline/audio/samples.ts` :

```ts
import { mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { LANGS, type Lang } from '@daily-brief/schema';
import { Breaker, describeError } from '../collect/breaker';
import type { HttpFetch } from '../collect/http';
import { writeAtomic } from '../lib/fs';
import { redactText, stripSecrets } from '../lib/redact';
import { billedChars } from './chunk';
import { chirp3HdVoices, listVoices, synthesize, type TtsClient, type VoiceInfo } from './tts';
import { LANGUAGE_CODES, type Voices } from './voices';

/** Phrases d'essai, du ton d'un Morning Brief (environ 200 caractères chacune). */
export const SAMPLE_TEXTS: Record<Lang, string> = {
  fr: 'Bonjour, voici le Daily Brief du jour. Au programme : le budget revient à l’Assemblée, la Bourse de Paris hésite, et « la grande question » du jour : qui paiera la transition énergétique ?',
  en: 'Good morning, here is today’s Daily Brief. Coming up: Congress returns to the budget fight, the Bank of England holds its rates, and a new climate report lands in Brussels.',
  es: 'Buenos días, este es el Daily Brief de hoy. ¿Qué nos espera? El Congreso debate los presupuestos, el Ibex abre con dudas y, ¡atención!, la selección prepara su próximo partido.',
};

export const DEFAULT_SAMPLES = 3;
export const MAX_SAMPLES = 10;

export type SampleEntry = { lang: Lang; voice: string; file: string | null; error: string | null };

export type SamplesIndex = {
  generatedAt: string;
  /** Toutes les voix Chirp 3 HD trouvées par langue d'édition (noms à recopier dans voices.json). */
  voices: Record<Lang, string[]>;
  samples: SampleEntry[];
  characters: number;
  issues: string[];
};

export type SamplesOptions = { apiKey: string; fetch: HttpFetch; outDir: string; voices: Voices; count?: number; timeoutMs?: number };

/**
 * Voix à essayer pour une langue : la voix configurée si elle existe, puis les autres en
 * alternant les variantes régionales (en-US, en-GB), chacune triée par nom.
 */
export function pickSampleVoices(byCode: Record<string, VoiceInfo[]>, preferred: string, count: number): string[] {
  const lists = Object.values(byCode).map((vs) => vs.map((v) => v.name).filter((n) => n !== preferred));
  const all = new Set(Object.values(byCode).flatMap((vs) => vs.map((v) => v.name)));
  const out = all.has(preferred) ? [preferred] : [];
  for (let i = 0; out.length < count && lists.some((l) => i < l.length); i++) {
    for (const l of lists) if (i < l.length && out.length < count) out.push(l[i]);
  }
  return out;
}

/**
 * `npm run audio:samples` (mise en place, spec §14) : liste les voix Chirp 3 HD de chaque langue
 * (voices.list filtré sur « Chirp3-HD », spec §16), synthétise `count` échantillons par langue
 * dans `<outDir>/voice-samples/` et écrit `index.json`. Ne sert jamais pendant la routine.
 * Codes : 0 = tous les échantillons écrits ; 1 = certains seulement ; 2 = aucun.
 */
export async function runVoiceSamples(opts: SamplesOptions): Promise<{ exitCode: 0 | 1 | 2; index: SamplesIndex; dir: string }> {
  const count = Math.min(MAX_SAMPLES, Math.max(1, Math.floor(opts.count ?? DEFAULT_SAMPLES)));
  const dir = join(opts.outDir, 'voice-samples');
  const secrets = [opts.apiKey];
  const clean = (m: string) => redactText(m, secrets);
  const index: SamplesIndex = { generatedAt: '', voices: { fr: [], en: [], es: [] }, samples: [], characters: 0, issues: [] };
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });

  const breaker = new Breaker();
  const client: TtsClient = { apiKey: opts.apiKey, fetch: opts.fetch, timeoutMs: opts.timeoutMs };
  for (const lang of LANGS) {
    const byCode: Record<string, VoiceInfo[]> = {};
    for (const code of LANGUAGE_CODES[lang]) {
      if (breaker.open) break;
      try {
        byCode[code] = chirp3HdVoices(await listVoices(code, client), code);
        breaker.success();
      } catch (e) {
        breaker.trip(e);
        index.issues.push(clean(`voices.list ${code} : ${describeError(e)}`));
      }
    }
    index.voices[lang] = Object.values(byCode).flatMap((vs) => vs.map((v) => v.name));
    const preferred = opts.voices[lang].name;
    if (Object.keys(byCode).length > 0 && !index.voices[lang].includes(preferred)) index.issues.push(`${lang} : la voix configurée ${preferred} est absente de voices.list`);
    for (const name of pickSampleVoices(byCode, preferred, count)) {
      const entry: SampleEntry = { lang, voice: name, file: null, error: null };
      index.samples.push(entry);
      if (breaker.open) {
        entry.error = `Text-to-Speech coupé (${breaker.reason})`;
        continue;
      }
      const languageCode = name.split('-').slice(0, 2).join('-');
      try {
        index.characters += billedChars(SAMPLE_TEXTS[lang]);
        const mp3 = await synthesize(SAMPLE_TEXTS[lang], { languageCode, name }, {}, client);
        breaker.success();
        writeAtomic(join(dir, `${name}.mp3`), mp3);
        entry.file = `${name}.mp3`;
      } catch (e) {
        breaker.trip(e);
        entry.error = clean(describeError(e));
      }
    }
  }
  index.generatedAt = new Date().toISOString();
  writeAtomic(join(dir, 'index.json'), stripSecrets(JSON.stringify(index, null, 2), secrets) + '\n');
  const made = index.samples.filter((s) => s.file).length;
  return { exitCode: made === 0 ? 2 : made === index.samples.length ? 0 : 1, index, dir };
}
```

Fichier `pipeline/audio/samples-cli.ts` :

```ts
import { parseArgs } from 'node:util';
import type { HttpFetch } from '../collect/http';
import { loadEnv } from '../lib/env';
import { redactText } from '../lib/redact';
import { DEFAULT_SAMPLES, runVoiceSamples } from './samples';
import { loadVoices } from './voices';

try {
  loadEnv(['GOOGLE_TTS_API_KEY']);
  const { values } = parseArgs({ options: { out: { type: 'string', default: 'out' }, count: { type: 'string', default: String(DEFAULT_SAMPLES) } } });
  const apiKey = process.env.GOOGLE_TTS_API_KEY?.trim();
  if (!apiKey) {
    console.error('audio:samples : GOOGLE_TTS_API_KEY absente (voir docs/setup-audio.md).');
    process.exit(2);
  }
  const count = Number(values.count);
  if (!Number.isInteger(count) || count < 1) throw new Error(`--count invalide : « ${values.count} »`);
  const { exitCode, index, dir } = await runVoiceSamples({ apiKey, fetch: fetch as HttpFetch, outDir: values.out!, voices: loadVoices(), count });
  console.log('audio:samples');
  for (const i of index.issues) console.log(`[warning] ${i}`);
  for (const lang of ['fr', 'en', 'es'] as const) console.log(`${lang.toUpperCase()} : ${index.voices[lang].length} voix Chirp 3 HD${index.voices[lang].length ? ` (${index.voices[lang].join(', ')})` : ''}`);
  for (const s of index.samples) console.log(`  ${s.file ? `${dir}/${s.file}` : `${s.voice} : ${s.error}`}`);
  console.log(`${index.samples.filter((s) => s.file).length} échantillon(s), ${index.characters} caractères. Écouter, puis recopier les voix choisies dans pipeline/config/voices.json (confirmed: true).`);
  process.exit(exitCode);
} catch (e) {
  console.error(`audio:samples : ${redactText(e instanceof Error ? e.message : String(e), [process.env.GOOGLE_TTS_API_KEY?.trim()])}`);
  process.exit(2);
}
```

Dans `package.json`, remplacer :

```json
    "brief:publish": "tsx pipeline/publish/cli.ts",
    "check:thenewsapi": "tsx pipeline/collect/check-thenewsapi.ts",
```

par :

```json
    "brief:publish": "tsx pipeline/publish/cli.ts",
    "audio:samples": "tsx pipeline/audio/samples-cli.ts",
    "check:thenewsapi": "tsx pipeline/collect/check-thenewsapi.ts",
```

- [ ] **Étape 4 : vérifier le succès**

Commande : `npx vitest run pipeline/test/audio/samples.test.ts pipeline/test/audio/samples-cli.test.ts`
Attendu : `Test Files  2 passed (2)` et `Tests  9 passed (9)`.

Commande : `npm test && npm run typecheck`
Attendu : `Test Files  78 passed (78)`, `Tests  809 passed (809)`, et `tsc` sans sortie.

- [ ] **Étape 5 : commit**

```bash
git add pipeline/audio/samples.ts pipeline/audio/samples-cli.ts package.json pipeline/test/audio/samples.test.ts pipeline/test/audio/samples-cli.test.ts
git commit -m "feat(audio): échantillons de voix pour la mise en place"
```

---

### Tâche 10 : documentation, mise en place et consignes

**Fichiers :**
- Créer : `docs/setup-audio.md`
- Modifier : `README.md`, `docs/superpowers/plans/2026-11-06-phase-1-roadmap.md` (description du lot 5, consignes issues du lot 5)

- [ ] **Étape 1 : écrire le guide de mise en place**

Le guide suit le §14 de la spec : projet Google Cloud, API Text-to-Speech, facturation, clé restreinte à cette API, Vault, ffmpeg, choix des voix sur les échantillons, premier essai, puis les contrôles à faire sur le vrai service.

Fichier `docs/setup-audio.md` :

````markdown
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

Sur une machine de confiance, avec la clé dans un `.env` local (jamais commité) :

```bash
# créer .env avec un éditeur, une seule ligne : GOOGLE_TTS_API_KEY=<la clé>
npm run audio:samples            # 3 échantillons par langue ; --count 5 pour en entendre plus
```

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
````

- [ ] **Étape 2 : compléter le README**

Dans `README.md`, remplacer :

```markdown
npm run brief:verify -- --date AAAA-MM-JJ [--out out]
npm run brief:render -- --date AAAA-MM-JJ [--out out]
```

par :

```markdown
npm run brief:verify -- --date AAAA-MM-JJ [--out out]
npm run brief:audio -- --date AAAA-MM-JJ [--out out] [--no-ffmpeg]
npm run audio:samples -- [--out out] [--count 3]   # mise en place : échantillons de voix
npm run brief:render -- --date AAAA-MM-JJ [--out out]
```

Dans `README.md`, remplacer :

```markdown
`brief:verify` contrôle `out/<date>/{fr,en,es}.json` selon les règles R1 à R12 de la spec. Il écrit `{lang}.verified.json` (conforme aux règles R1 à R12 détectables automatiquement) et `verify-report.json`. Code de sortie : 0 si propre, 1 si des corrections ont été appliquées, 2 en cas d’erreur : édition invalide ou absente, fichier d’entrée illisible, ou date incorrecte (l’édition doit alors être corrigée avant publication).

`brief:render` lit les `{lang}.verified.json` du jour et complète les photos Pexels si `PEXELS_API_KEY` est définie (variable d'environnement ou `.env`). Il écrit `{lang}.final.json`, `Daily Brief <date>.pdf` (A4, FR puis EN puis ES) et `render-report.json`. Une édition absente est omise ; sans aucune édition, il n'y a pas de PDF et le code de sortie vaut 2. Le code 2 peut accompagner des `{lang}.final.json` valides (PDF impossible) : la publication s'appuie sur `finals` du rapport. Le test visuel du PDF compare trois captures à `packages/render-pdf/test/__screens__/`. Après un changement voulu du gabarit, régénère-les avec `UPDATE_VISUAL=1 npx vitest run packages/render-pdf/test/visual.test.ts` et vérifie les images avant de les commiter.
```

par :

```markdown
`brief:verify` contrôle `out/<date>/{fr,en,es}.json` selon les règles R1 à R12 de la spec. Il écrit `{lang}.verified.json` (conforme aux règles R1 à R12 détectables automatiquement) et `verify-report.json`. Code de sortie : 0 si propre, 1 si des corrections ont été appliquées, 2 en cas d’erreur : édition invalide ou absente, fichier d’entrée illisible, ou date incorrecte (l’édition doit alors être corrigée avant publication).

`brief:audio` lit l'`audioScript` de chaque `{lang}.verified.json` et le fait lire par Google Cloud Text-to-Speech, avec la voix Chirp 3 HD de l'édition (`pipeline/config/voices.json`). Le texte est découpé en morceaux de 4 500 octets au plus (la limite de l'API est de 5 000), aux fins de phrase, sinon aux virgules, sinon entre les mots, sans jamais couper un mot. Les morceaux sont concaténés avec ffmpeg s'il est présent (MP3 64 kb/s mono, `FFMPEG_PATH` pour un autre chemin), sinon trame par trame, au débit de la source. Il écrit `Daily Brief <date> FR.mp3` (et `EN`, `ES`), `audio.json` (`{ "fr": { "duration": "3:24" } }`) et `audio-report.json`. Les anciens MP3 du jour sont supprimés d'abord, parce que `brief:publish` prend tout MP3 présent. La clé `GOOGLE_TTS_API_KEY` vient de l'environnement ou de `.env` ; elle part dans l'en-tête `x-goog-api-key`, jamais dans l'URL, et n'apparaît dans aucun message ni rapport. Chaque requête a un délai de 60 s, et le passage entier est borné à 10 minutes. Le service est coupé après un 401, un 403, un 429, un délai dépassé ou 3 échecs consécutifs ; une erreur 5xx ou réseau a droit à une seconde tentative. Les caractères sont plafonnés à 5 000 par édition et 15 000 par passage. L'audio ne bloque jamais la routine : une édition en échec est publiée sans lecteur. Codes de sortie de `brief:audio` :

- **0** : au moins un MP3 est écrit (`status` vaut `ok`, ou `degraded` s'il en manque un), ou l'audio est désactivé faute de clé (`disabled`, avec un avertissement) ;
- **1** : la clé est présente mais aucun MP3 n'a été produit (`failed`) ;
- **2** : entrée invalide (`invalid`) : date incorrecte, `voices.json` invalide ou aucune édition vérifiée lisible.

Quel que soit ce code, la routine enchaîne sur `brief:render`, qui lit `audio.json` pour l'encart audio du PDF : `brief:audio` passe donc **avant** `brief:render`. `audio:samples` sert une seule fois, à la mise en place : il liste les voix Chirp 3 HD de chaque langue et écrit des échantillons dans `out/voice-samples/` (voir `docs/setup-audio.md`).

`brief:render` lit les `{lang}.verified.json` du jour et complète les photos Pexels si `PEXELS_API_KEY` est définie (variable d'environnement ou `.env`). Il écrit `{lang}.final.json`, `Daily Brief <date>.pdf` (A4, FR puis EN puis ES) et `render-report.json`. Une édition absente est omise ; sans aucune édition, il n'y a pas de PDF et le code de sortie vaut 2. Le code 2 peut accompagner des `{lang}.final.json` valides (PDF impossible) : la publication s'appuie sur `finals` du rapport. Le test visuel du PDF compare trois captures à `packages/render-pdf/test/__screens__/`. Après un changement voulu du gabarit, régénère-les avec `UPDATE_VISUAL=1 npx vitest run packages/render-pdf/test/visual.test.ts` et vérifie les images avant de les commiter.
```

Dans `README.md`, remplacer :

```markdown
`brief:render` imprime avec Chromium (Playwright 1.63.0) : il est préinstallé via `PLAYWRIGHT_BROWSERS_PATH` ; sinon, lance `npx playwright install chromium`. Le code 0 peut s'accompagner d'entrées de niveau `error` dans le rapport (une édition invalide est omise et le PDF contient les autres). Le fichier facultatif `audio.json`, écrit par le lot 5, a la forme `{ "fr": { "duration": "3:24" }, "en": { "duration": "3:10" }, "es": { "duration": "3:31" } }` ; chaque langue est facultative et les autres clés sont ignorées.
```

par :

```markdown
`brief:render` imprime avec Chromium (Playwright 1.63.0) : il est préinstallé via `PLAYWRIGHT_BROWSERS_PATH` ; sinon, lance `npx playwright install chromium`. Le code 0 peut s'accompagner d'entrées de niveau `error` dans le rapport (une édition invalide est omise et le PDF contient les autres). Le fichier facultatif `audio.json`, écrit par `brief:audio`, a la forme `{ "fr": { "duration": "3:24" }, "en": { "duration": "3:10" }, "es": { "duration": "3:31" } }` ; chaque langue est facultative et les autres clés sont ignorées.
```

- [ ] **Étape 3 : mettre à jour la feuille de route**

La ligne « Plan : » et la mention « ✅ plan détaillé » sont déjà dans la feuille de route (commit du plan).

Dans `docs/superpowers/plans/2026-11-06-phase-1-roadmap.md`, remplacer :

```markdown
- Vérification §16 : noms exacts des voix Chirp 3 HD avec `voices.list` filtré sur « Chirp3-HD », et présence de ffmpeg.
- `pipeline/render/audio.ts` : découpage de `audioScript` sous la limite par requête (on vise moins de 4 500 octets par morceau, en coupant aux fins de phrase), synthèse en MP3, concaténation avec ffmpeg (sinon concaténation binaire des trames MP3), puis 64 kb/s mono. Le fichier s'appelle `Daily Brief AAAA-MM-JJ FR.mp3`. En cas d'échec, l'édition est publiée sans lecteur.
- Script de mise en place `pipeline/render/voice-samples.ts` : trois échantillons par langue, pour que Naïm choisisse sa voix. Le choix est rangé dans `pipeline/config/voices.json`.
- Tests : découpage (aucun morceau au-dessus de la limite, aucune phrase coupée), concaténation sur deux MP3 de test.
```

par :

```markdown
- Vérification §16 : noms exacts des voix Chirp 3 HD avec `voices.list` filtré sur « Chirp3-HD » (`npm run audio:samples`), et présence de ffmpeg (détectée à chaque passage).
- `pipeline/audio/` (et non `pipeline/render/audio.ts`, une responsabilité par fichier) : découpage de `audioScript` sous 4 500 octets par morceau (limite de l'API : 5 000), aux fins de phrase, sinon aux virgules, sinon entre les mots ; synthèse en MP3 ; concaténation avec ffmpeg en 64 kb/s mono, sinon trame par trame au débit de la source. Le fichier s'appelle `Daily Brief AAAA-MM-JJ FR.mp3`. En cas d'échec, l'édition est publiée sans lecteur.
- `npm run brief:audio`, lancé **avant** `brief:render`, écrit les MP3, `audio.json` (durées, lues pour l'encart du PDF) et `audio-report.json`.
- Script de mise en place `npm run audio:samples` (`pipeline/audio/samples.ts`) : trois échantillons par langue, pour que Naïm choisisse sa voix. Le choix est rangé dans `pipeline/config/voices.json`.
- Tests : découpage (aucun morceau au-dessus de la limite, aucune phrase ni aucun mot coupé), concaténation sur deux vrais MP3 produits par ffmpeg (ignorée sans ffmpeg) et sur des trames synthétiques.
```

Dans `docs/superpowers/plans/2026-11-06-phase-1-roadmap.md`, remplacer :

```markdown
  - **Routine et connecteur.** Le pipeline n'utilise pas le connecteur Supabase : il appelle l'API REST du projet avec la clé de service. Le connecteur ne sert qu'à lire Vault.
```

par :

```markdown
  - **Routine et connecteur.** Le pipeline n'utilise pas le connecteur Supabase : il appelle l'API REST du projet avec la clé de service. Le connecteur ne sert qu'à lire Vault.

### Consignes issues du lot 5

- **Lot 6 (appli)** :
  - **Lecteur.** Le lecteur MP3 du Morning Brief lit `editions.audio_path` (bucket privé `audio`, chemin `AAAA-MM-JJ/<langue>.mp3`) par une URL signée créée avec la session de l'utilisateur, jamais par une URL publique. Un `audio_path` nul : pas de lecteur, sans message d'erreur.
  - **Durée.** La durée n'est pas en base : l'appli la lit dans les métadonnées du fichier (`loadedmetadata`). Les MP3 n'ont pas d'étiquette ID3 ; à débit constant, la durée est juste dès le chargement (à vérifier au premier passage réel pour la concaténation sans ffmpeg).
- **Lot 7 (routine)** :
  - **Ordre.** `brief:verify` → `brief:audio` → `brief:render` → `brief:publish`. `brief:audio` passe avant le rendu pour que l'encart audio du PDF porte la durée, et avant la publication, qui prend les MP3 présents.
  - **Codes de sortie de `brief:audio`.** Quel que soit le code, la routine continue avec `brief:render`. Code 0 : lire `status` dans `audio-report.json` (`degraded` : « audio partiel » dans la notification ; `disabled` : « audio désactivé, clé absente »). Code 1 : « audio en échec, éditions sans lecteur ». Code 2 : entrée invalide, à signaler, sans bloquer le reste.
  - **Prompt de rédaction.** `PROMPT.md` demande un `audioScript` de 350 à 450 mots (environ 3 minutes), en phrases complètes, sans balises ni abréviations ambiguës. Au-delà de 5 000 caractères, l'édition part sans audio.
  - **Variables.** `.env` doit contenir `GOOGLE_TTS_API_KEY` (Vault). `FFMPEG_PATH` est facultatif.
  - **Mise en place.** Suivre `docs/setup-audio.md`, puis cocher sa section 7 au premier passage réel.
  - **`runs`.** La page Santé ne voit pas encore l'étape audio : ajouter `audio-report.json` au bilan de `pipeline/publish/run-summary.ts` (étape `audio`, compteurs `mp3` et `characters`).
```

- [ ] **Étape 4 : vérifier**

Commande : `npm test && npm run typecheck`
Attendu : `Test Files  78 passed (78)`, `Tests  809 passed (809)`, et `tsc` sans sortie.

Commande : `npm run brief:audio -- --date 2026-02-30`
Attendu : code 2, `[error] date incorrecte : « 2026-02-30 »` et `Erreur : entrée invalide, pas d’audio.`

- [ ] **Étape 5 : commit**

```bash
git add docs/setup-audio.md README.md docs/superpowers/plans/2026-11-06-phase-1-roadmap.md
git commit -m "docs: audio (commandes, mise en place, consignes du lot 5)"
```

---

## Couverture du lot (auto-revue)

| Exigence | Tâche |
|---|---|
| §3 `audioScript` d'environ 350 à 450 mots (3 min) : un morceau en pratique, plafond de 5 000 caractères par édition | 2, 6 |
| §9 Google Cloud Text-to-Speech, voix Chirp 3 HD, une par édition (fr-FR, en-US ou en-GB, es-ES) | 4, 5 |
| §9 découpage sous la limite par requête (5 000 octets documentés, 4 500 visés), aux fins de phrase, sans couper un mot ; guillemets français, `¿ ¡` | 2 |
| §9 concaténation en MP3 64 kb/s mono (ffmpeg) ; environ 10 000 caractères par jour, sous le million gratuit (plafonds 5 000 / 15 000) | 3, 6, 7 |
| §9 noms `Daily Brief AAAA-MM-JJ FR.mp3` (EN, ES) ; audio en échec → édition sans lecteur | 7 |
| §12 audio en échec : la routine continue (codes 0 / 1 / 2 documentés, jamais bloquant) | 7, 8, 10 |
| §14 étape 2 (projet, API, facturation, clé restreinte) et étape 7 (choix des voix sur échantillons) | 9, 10 |
| §16 noms des voix par `voices.list` filtré sur « Chirp3-HD » ; ffmpeg si présent, sinon concaténation des trames | 3, 4, 9 |
| Lot 4 : noms et chemins des MP3, `looksLikeMp3`, 15 Mo au plus, anciens MP3 supprimés d'abord ; testé avec `loadPublishInputs` | 1, 3, 7 |
| Lot 2 : `audio.json` `{ "fr": { "duration": "3:24" } }` lu par `brief:render` (schéma `partial`) ; encart vérifié avec le vrai `runRender` | 7 |
| Ordre de la routine : `brief:audio` avant `brief:render` ; PDF rendu même si l'audio échoue | 7, 10 |
| Délais, `AbortSignal`, échéance globale, disjoncteur (401, 403, 429, délai, 3 échecs) | 4, 6, 7 |
| Clé en en-tête `x-goog-api-key`, masquée partout (testé, y compris dans une erreur réseau) | 4, 7, 8, 9 |
| Réponses validées par zod et bornées en taille ; fixtures construites et marquées comme telles | 4 |
| Rapport toujours écrit, atomique ; anciennes sorties supprimées ; sorties déterministes | 7 |
| Consignes pour les lots 6 (lecteur par URL signée) et 7 (ordre, codes, variables, `runs`) | 10 |
| Hors lot : étape `audio` dans `runs` (fichier du lot 4 en cours de correction), rédaction du script (lot 7), lecteur de l'appli (lot 6) | — |

## À vérifier avec la vraie API

Ces points sont repris, à cocher, dans la section 7 de `docs/setup-audio.md`. Rien ici n'a touché Google Cloud : les tests utilisent un faux service et des MP3 synthétiques.

- **Noms des voix.** `fr-FR-Chirp3-HD-Aoede`, `en-US-Chirp3-HD-Charon` et `es-ES-Chirp3-HD-Kore` sont plausibles mais pas confirmés. `npm run audio:samples` les vérifie (avertissement si absents) ; ensuite, `confirmed: true`.
- **En-tête `x-goog-api-key`.** Il est accepté par les API Google en général ; à confirmer sur `texttospeech.googleapis.com` avec une clé restreinte (sinon, repli possible sur `?key=`, que `redactUrl` masque déjà).
- **Limites de la requête.** Les 5 000 octets par requête sont à confirmer. Il faut aussi savoir si Chirp 3 HD impose une longueur de phrase maximale (erreur « sentences too long » connue sur d'autres familles de voix). Si c'est le cas, réduire `MAX_CHUNK_BYTES` ou ajouter un découpage des phrases longues aux virgules.
- **Format renvoyé.** Fréquence (24 kHz attendus), débit (32 kb/s annoncés pour `MP3`), présence d'une étiquette ID3 ou d'une trame Xing, débit constant. Le lecteur de trames est strict : un octet parasite entre les trames ferait échouer la concaténation sans ffmpeg (l'édition partirait sans lecteur).
- **Taille des réponses.** Environ 320 Ko de base64 pour une minute à 32 kb/s ; la borne de 8 Mo laisse de la marge, à confirmer.
- **Champs `speakingRate`.** Il faut confirmer qu'il est accepté par les voix Chirp 3 HD.
- **Concaténation sans ffmpeg.** Il faut écouter le raccord entre deux morceaux (réservoir de bits MP3 : un léger clic est possible). La durée de `audio.json` doit correspondre à l'écoute.
- **ffmpeg dans le conteneur de la routine.** Sa présence et celle de `libmp3lame` sont à vérifier ; sinon, les MP3 restent au débit de Google, et l'avertissement le dit.
- **Tarif et palier gratuit.** Le million de caractères gratuits par mois pour Chirp 3 HD (spec §15) est à confirmer, ainsi que la façon de compter (caractères ou octets, espaces comprises).
- **Codes d'erreur.** Le code d'une voix inconnue (400 attendu), d'une clé non restreinte à la bonne API (403) et d'un quota (429) sont à confirmer. Le disjoncteur traite 401, 403 et 429 comme fatals, les autres 4xx comme des échecs ordinaires.
