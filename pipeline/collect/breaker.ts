import { z } from 'zod';
import { HttpError, isTimeout, messageOf } from './http';
import type { SourceRun } from './types';

/** 401/403 : clé refusée ; 402 : quota épuisé (TheNewsAPI) ; 429 : trop de requêtes. */
const FATAL_STATUS = new Set([401, 402, 403, 429]);

/**
 * Disjoncteur d'une source : après un refus d'accès, un quota épuisé ou un délai dépassé,
 * la source n'est plus appelée pendant le reste du passage.
 */
export class Breaker {
  /** Échecs non fatals consécutifs avant coupure. */
  static readonly MAX_CONSECUTIVE = 3;
  reason: string | null = null;
  private consecutive = 0;

  get open(): boolean {
    return this.reason !== null;
  }

  /** Enregistre l'erreur ; renvoie vrai si elle coupe la source. */
  trip(e: unknown): boolean {
    if (this.open) return true;
    if (e instanceof HttpError && FATAL_STATUS.has(e.status)) this.reason = `HTTP ${e.status}`;
    else if (isTimeout(e)) this.reason = 'délai dépassé';
    else if (++this.consecutive >= Breaker.MAX_CONSECUTIVE) this.reason = `source coupée après ${Breaker.MAX_CONSECUTIVE} échecs consécutifs`;
    return this.open;
  }

  /** Une requête a réussi : le compte des échecs consécutifs repart de zéro. */
  success(): void {
    this.consecutive = 0;
  }
}

/**
 * Message d'une erreur de réponse d'API, sans aucun fragment du corps : une réponse non JSON
 * (page HTML d'erreur) ou d'une forme inattendue (nombre de champs invalides) est résumée.
 */
export function describeError(e: unknown): string {
  if (e instanceof SyntaxError) return 'réponse non JSON';
  if (e instanceof z.ZodError) return `réponse inattendue (${e.issues.length} champs invalides)`;
  return messageOf(e);
}

/** Ajoute l'erreur au bilan de la source ; renvoie vrai si elle coupe la source. */
export function recordFailure(run: SourceRun, breaker: Breaker, where: string, e: unknown): boolean {
  if (breaker.open) return true;
  if (breaker.trip(e)) {
    run.stoppedBy = breaker.reason;
    run.errors.push(`${where} : ${describeError(e)} — ${breaker.reason?.startsWith('source coupée') ? breaker.reason : 'source coupée'}`);
    return true;
  }
  run.errors.push(`${where} : ${describeError(e)}`);
  return false;
}
