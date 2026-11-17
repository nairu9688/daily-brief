import { renameSync, rmSync, writeFileSync } from 'node:fs';

/**
 * Écriture atomique (texte ou octets) : fichier temporaire (`<chemin>.tmp`) puis renommage, pour qu'une coupure ne laisse jamais
 * un fichier tronqué. En cas d'échec, le fichier temporaire est retiré si possible et l'erreur est remontée.
 */
export function writeAtomic(path: string, text: string | Uint8Array): void {
  const tmp = `${path}.tmp`;
  try {
    writeFileSync(tmp, text);
    renameSync(tmp, path);
  } catch (e) {
    try {
      rmSync(tmp, { force: true });
    } catch {
      /* le temporaire n'est pas un fichier simple : on le laisse */
    }
    throw e;
  }
}
