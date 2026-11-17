/**
 * Daily Brief — réception des PDF et MP3 du jour, rangés dans Google Drive (spec §10).
 *
 * Application web Apps Script : « Exécuter en tant que : moi », « Accès : tout le monde ».
 * Propriété du script à définir : TOKEN (jeton partagé avec le pipeline, 32 caractères au moins).
 * Guide de déploiement : docs/setup-supabase.md, section « Apps Script ».
 *
 * Requête  : POST JSON { token, date: "AAAA-MM-JJ", files: [{ name, mimeType, base64 }] }
 * Réponse  : { ok: true, ids: { "<nom du fichier>": "<id Drive>" } }
 *         ou { ok: false, error: "<code>" } — toujours en HTTP 200 (Apps Script ne permet pas
 *            de choisir le statut), après une redirection 302 que le client suit.
 *
 * Les fonctions pures (validation, nom du dossier, comparaison du jeton) sont testées dans Node :
 * pipeline/test/apps-script/code.test.ts évalue ce fichier avec de faux services Google.
 */

var ROOT_NAME = 'Daily Brief';
var MONTHS = ['Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin', 'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre'];
var MIN_TOKEN_LENGTH = 32;
var MAX_FILES = 4;
/** 40 Mo de base64, soit 30 Mo de fichier : au-delà, la requête est refusée avant décodage. */
var MAX_BASE64_LENGTH = 40 * 1024 * 1024;
var FILE_NAME = /^Daily Brief (\d{4}-\d{2}-\d{2})(?: (?:FR|EN|ES))?\.(pdf|mp3)$/;
var MIME_BY_EXTENSION = { pdf: 'application/pdf', mp3: 'audio/mpeg' };

// ------------------------------------------------------------------------------------------
// Fonctions pures
// ------------------------------------------------------------------------------------------

/** Comparaison en temps constant : la durée ne dépend ni de la position du premier écart ni du contenu. */
function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  var diff = a.length ^ b.length;
  var n = Math.max(a.length, b.length);
  for (var i = 0; i < n; i++) diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return diff === 0;
}

/** Vrai si le jeton reçu est le jeton attendu. Un jeton attendu absent ou trop court refuse tout. */
function tokenMatches(expected, received) {
  if (typeof expected !== 'string' || expected.length < MIN_TOKEN_LENGTH) return false;
  return safeEqual(expected, received);
}

/** Vrai pour une date AAAA-MM-JJ qui existe au calendrier. */
function isRealDate(date) {
  if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  var d = new Date(date + 'T00:00:00Z');
  return !isNaN(d.getTime()) && d.toISOString().slice(0, 10) === date;
}

/** Dossiers d'une date : « 2026 » et « 11 - Novembre » (mois en français). */
function folderNames(date) {
  var month = Number(date.slice(5, 7));
  return { year: date.slice(0, 4), month: date.slice(5, 7) + ' - ' + MONTHS[month - 1] };
}

/**
 * Valide la requête : renvoie { ok: true, date, files } ou { ok: false, error }.
 * Chaque fichier doit porter le nom d'un fichier du Daily Brief de cette date, le type qui va
 * avec son extension et un contenu base64 non vide.
 */
function validatePayload(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return { ok: false, error: 'bad-request' };
  if (!isRealDate(payload.date)) return { ok: false, error: 'bad-date' };
  var files = payload.files;
  if (!Array.isArray(files) || files.length === 0 || files.length > MAX_FILES) return { ok: false, error: 'bad-files' };
  var seen = {};
  for (var i = 0; i < files.length; i++) {
    var f = files[i];
    if (!f || typeof f !== 'object' || typeof f.name !== 'string' || typeof f.mimeType !== 'string' || typeof f.base64 !== 'string') return { ok: false, error: 'bad-file' };
    var m = FILE_NAME.exec(f.name);
    if (!m || m[1] !== payload.date) return { ok: false, error: 'bad-name' };
    if (MIME_BY_EXTENSION[m[2]] !== f.mimeType) return { ok: false, error: 'bad-type' };
    if (f.base64.length === 0 || f.base64.length % 4 !== 0 || f.base64.length > MAX_BASE64_LENGTH || !/^[A-Za-z0-9+/]+={0,2}$/.test(f.base64)) return { ok: false, error: 'bad-content' };
    if (seen[f.name]) return { ok: false, error: 'duplicate-name' };
    seen[f.name] = true;
  }
  return { ok: true, date: payload.date, files: files };
}

/** Lit le corps JSON de la requête ; null s'il est absent ou illisible. */
function parseBody(e) {
  try {
    var text = e && e.postData && e.postData.contents;
    return typeof text === 'string' ? JSON.parse(text) : null;
  } catch (err) {
    return null;
  }
}

// ------------------------------------------------------------------------------------------
// Drive
// ------------------------------------------------------------------------------------------

/** Sous-dossier `name` de `parent`, créé s'il manque. */
function childFolder(parent, name) {
  var it = parent.getFoldersByName(name);
  while (it.hasNext()) {
    var folder = it.next();
    if (!folder.isTrashed()) return folder;
  }
  return parent.createFolder(name);
}

/**
 * Dossier racine « Daily Brief ». Son id est mémorisé dans la propriété ROOT_FOLDER_ID ; un dossier
 * supprimé ou mis à la corbeille est recherché par son nom à la racine de Mon Drive, puis recréé.
 */
function rootFolder(props) {
  var id = props.getProperty('ROOT_FOLDER_ID');
  if (id) {
    try {
      var known = DriveApp.getFolderById(id);
      if (!known.isTrashed()) return known;
    } catch (err) {
      // id périmé : on retrouve ou on recrée le dossier ci-dessous
    }
  }
  var root = childFolder(DriveApp.getRootFolder(), ROOT_NAME);
  props.setProperty('ROOT_FOLDER_ID', root.getId());
  return root;
}

/** Dossier « Daily Brief/AAAA/MM - Mois » de la date, créé au besoin. */
function monthFolder(props, date) {
  var names = folderNames(date);
  return childFolder(childFolder(rootFolder(props), names.year), names.month);
}

/** Décode tous les fichiers avant le premier effet sur Drive ; null si l'un d'eux est indécodable. */
function decodeAll(files) {
  try {
    var blobs = [];
    for (var i = 0; i < files.length; i++) blobs.push(Utilities.newBlob(Utilities.base64Decode(files[i].base64), files[i].mimeType, files[i].name));
    return blobs;
  } catch (err) {
    return null;
  }
}

/**
 * Dépose un fichier en remplaçant tout fichier de même nom : le nouveau est créé d'abord, puis les
 * anciens (tous les ids sauf le nouveau) vont à la corbeille. Une création en échec laisse l'ancien.
 */
function replaceFile(folder, blob, name) {
  var id = folder.createFile(blob).getId();
  var old = folder.getFilesByName(name);
  while (old.hasNext()) {
    var f = old.next();
    if (f.getId() !== id) f.setTrashed(true);
  }
  return id;
}

/** Vrai pour une erreur de quota de Google (message non transmis au client). */
function isQuotaError(err) {
  return /too many times|quota|limit exceeded/i.test(String((err && err.message) || err));
}

/** Traite une requête déjà lue : contrôle du jeton, validation, dépôt. Ne lève jamais. */
function handle(payload, props) {
  if (!payload || !tokenMatches(props.getProperty('TOKEN'), payload.token)) return { ok: false, error: 'unauthorized' };
  var checked = validatePayload(payload);
  if (!checked.ok) return checked;
  var blobs = decodeAll(checked.files);
  if (!blobs) return { ok: false, error: 'bad-content' };
  // Un seul dépôt à la fois : deux requêtes simultanées ne créent pas deux dossiers du même nom.
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) return { ok: false, error: 'busy' };
  try {
    var folder = monthFolder(props, checked.date);
    var ids = {};
    for (var i = 0; i < blobs.length; i++) ids[checked.files[i].name] = replaceFile(folder, blobs[i], checked.files[i].name);
    return { ok: true, ids: ids };
  } catch (err) {
    return { ok: false, error: isQuotaError(err) ? 'drive-quota' : 'drive-error' };
  } finally {
    lock.releaseLock();
  }
}

/** Point d'entrée de l'application web. */
function doPost(e) {
  var result = handle(parseBody(e), PropertiesService.getScriptProperties());
  return ContentService.createTextOutput(JSON.stringify(result)).setMimeType(ContentService.MimeType.JSON);
}
