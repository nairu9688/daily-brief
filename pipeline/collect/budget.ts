/**
 * Budget de requêtes : un plafond par poste et un plafond total. `take` réserve une requête
 * avant l'appel ; une requête refusée n'est jamais envoyée.
 */
export class RequestBudget<K extends string> {
  private readonly used = new Map<K, number>();
  private spent = 0;

  constructor(
    private readonly limits: Record<K, number>,
    private readonly total: number,
    /** Rappel après chaque réservation réussie, avec le total dépensé. */
    private readonly onTake?: (spent: number) => void,
  ) {}

  /** Réserve une requête du poste ; faux si le poste ou le total est épuisé. */
  take(bucket: K): boolean {
    const n = this.used.get(bucket) ?? 0;
    if (!(n < this.limits[bucket]) || !(this.spent < this.total)) return false;
    this.used.set(bucket, n + 1);
    this.spent += 1;
    this.onTake?.(this.spent);
    return true;
  }

  remaining(bucket: K): number {
    return Math.max(0, Math.min(this.limits[bucket] - (this.used.get(bucket) ?? 0), this.total - this.spent));
  }

  get spentTotal(): number {
    return this.spent;
  }

  /** Requêtes réservées par poste (0 pour un poste inutilisé). */
  usage(): Record<K, number> {
    return Object.fromEntries(Object.keys(this.limits).map((k) => [k, this.used.get(k as K) ?? 0])) as Record<K, number>;
  }
}
