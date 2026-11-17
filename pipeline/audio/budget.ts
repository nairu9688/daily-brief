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
