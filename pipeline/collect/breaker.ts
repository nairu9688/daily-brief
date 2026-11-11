import { HttpError, isTimeout, messageOf } from './http';
import type { SourceRun } from './types';

/** 401/403 : clé refusée ; 402 : quota épuisé (TheNewsAPI) ; 429 : trop de requêtes. */
const FATAL_STATUS = new Set([401, 402, 403, 429]);

/**
 * Disjoncteur d'une source : après un refus d'accès, un quota épuisé ou un délai dépassé,
 * la source n'est plus appelée pendant le reste du passage.
 */
export class Breaker {
  reason: string | null = null;

  get open(): boolean {
    return this.reason !== null;
  }

  /** Enregistre l'erreur ; renvoie vrai si elle coupe la source. */
  trip(e: unknown): boolean {
    if (e instanceof HttpError && FATAL_STATUS.has(e.status)) this.reason = `HTTP ${e.status}`;
    else if (isTimeout(e)) this.reason = 'délai dépassé';
    return this.open;
  }
}

/** Ajoute l'erreur au bilan de la source ; renvoie vrai si elle coupe la source. */
export function recordFailure(run: SourceRun, breaker: Breaker, where: string, e: unknown): boolean {
  if (breaker.trip(e)) {
    run.stoppedBy = breaker.reason;
    run.errors.push(`${where} : ${messageOf(e)} — source coupée`);
    return true;
  }
  run.errors.push(`${where} : ${messageOf(e)}`);
  return false;
}
