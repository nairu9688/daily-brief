/**
 * Budget de requêtes : un plafond par poste et un plafond total. `take` réserve une requête
 * avant l'appel ; une requête refusée n'est jamais envoyée.
 */
export class RequestBudget<K extends string> {
  private readonly used = new Map<K, number>();
  private spent = 0;
  /** Vrai après un échec du rappel : plus aucune requête n'est réservée (prudence). */
  private blocked = false;

  constructor(
    private readonly limits: Record<K, number>,
    private readonly total: number,
    /** Rappel avant chaque réservation, avec le total qui en résulte ; s'il lève, la requête est refusée. */
    private readonly onTake?: (spent: number) => void,
  ) {}

  /** Réserve une requête du poste ; faux si le poste ou le total est épuisé. */
  take(bucket: K): boolean {
    const n = this.used.get(bucket) ?? 0;
    if (this.blocked || !(n < this.limits[bucket]) || !(this.spent < this.total)) return false;
    try {
      this.onTake?.(this.spent + 1);
    } catch {
      // Le compte n'a pas pu être enregistré : la requête est refusée, et les suivantes aussi.
      this.blocked = true;
      return false;
    }
    this.used.set(bucket, n + 1);
    this.spent += 1;
    return true;
  }

  remaining(bucket: K): number {
    if (this.blocked) return 0;
    const left = Math.min(this.limits[bucket] - (this.used.get(bucket) ?? 0), this.total - this.spent);
    return Number.isFinite(left) ? Math.max(0, left) : 0;
  }

  get spentTotal(): number {
    return this.spent;
  }

  /** Requêtes réservées par poste (0 pour un poste inutilisé). */
  usage(): Record<K, number> {
    return Object.fromEntries(Object.keys(this.limits).map((k) => [k, this.used.get(k as K) ?? 0])) as Record<K, number>;
  }
}
