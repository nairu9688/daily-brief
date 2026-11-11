import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { z } from 'zod';

const LedgerSchema = z.strictObject({ day: z.iso.date(), used: z.number().int().min(0) });

/** Jour du quota (UTC) : le compteur TheNewsAPI repart de zéro chaque jour. */
export const utcDay = (now: Date): string => now.toISOString().slice(0, 10);

/**
 * Requêtes déjà consommées aujourd'hui par les passages précédents (relance le même jour).
 * Fichier absent ou d'un autre jour : 0. Fichier illisible : le quota est réputé épuisé
 * (mieux vaut se passer de TheNewsAPI que dépasser le plafond).
 */
export function readDailyUsage(path: string, day: string, cap: number): { used: number; error?: string } {
  if (!existsSync(path)) return { used: 0 };
  try {
    const ledger = LedgerSchema.parse(JSON.parse(readFileSync(path, 'utf8')));
    return { used: ledger.day === day ? ledger.used : 0 };
  } catch {
    return { used: cap, error: `${path} illisible : quota TheNewsAPI réputé épuisé (supprime le fichier pour réinitialiser)` };
  }
}

export function writeDailyUsage(path: string, day: string, used: number): void {
  writeFileSync(path, JSON.stringify({ day, used }, null, 2) + '\n');
}
