import { existsSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { z } from 'zod';

const LedgerSchema = z.strictObject({ day: z.iso.date(), used: z.number().int().min(0) });

/** Jour du quota (UTC) : le compteur TheNewsAPI repart de zéro chaque jour. */
export const utcDay = (now: Date): string => now.toISOString().slice(0, 10);

/**
 * Requêtes déjà consommées aujourd'hui par les passages précédents (relance le même jour).
 * Fichier absent ou d'un autre jour : 0. Fichier illisible : le quota est réputé épuisé
 * (mieux vaut se passer de TheNewsAPI que dépasser le plafond), sauf s'il date d'un jour antérieur :
 * le compte repart de zéro avec un `warning` (et sans `error`), pour que l'appelant réécrive le fichier.
 */
export function readDailyUsage(path: string, day: string, cap: number): { used: number; error?: string; warning?: string } {
  if (!existsSync(path)) return { used: 0 };
  try {
    const ledger = LedgerSchema.parse(JSON.parse(readFileSync(path, 'utf8')));
    return { used: ledger.day === day ? ledger.used : 0 };
  } catch {
    // Fichier tronqué d'un jour UTC antérieur : le compte du jour repart de zéro (avertissement).
    try {
      if (utcDay(statSync(path).mtime) < day) return { used: 0, warning: `${path} illisible et daté d'un jour antérieur : compte remis à zéro` };
    } catch {
      /* date inconnue : on garde la réserve prudente */
    }
    return { used: cap, error: `${path} illisible : quota TheNewsAPI réputé épuisé (supprime le fichier pour réinitialiser)` };
  }
}

/** Écriture atomique : fichier temporaire puis renommage, pour qu'une coupure ne laisse jamais un fichier tronqué. */
export function writeDailyUsage(path: string, day: string, used: number): void {
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, JSON.stringify({ day, used }, null, 2) + '\n');
  renameSync(tmp, path);
}

/** À appeler après chaque requête réservée (voir `RequestBudget.onTake`) : le compte survit à un plantage. */
export function recordDailyUsage(path: string, day: string, used: number): void {
  let stored = 0;
  try {
    const ledger = LedgerSchema.parse(JSON.parse(readFileSync(path, 'utf8')));
    if (ledger.day === day) stored = ledger.used;
  } catch {
    /* absent ou illisible : on écrit le compte reçu */
  }
  writeDailyUsage(path, day, Math.max(stored, used));
}
