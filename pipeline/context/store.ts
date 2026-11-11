import type { Context, OpenThread } from '@daily-brief/schema';

export type Topic = Context['yesterdayTopics'][number];

/**
 * Accès aux Threads et aux sujets publiés. Le store Supabase arrive au lot 4 ; ses réponses sont
 * revalidées par `runContext`, qui ne fait confiance à aucune donnée externe.
 */
export interface ContextStore {
  /** Nom affiché dans le rapport (« vide », « mémoire », « supabase »). */
  readonly name: string;
  /** Threads ouverts. */
  openThreads(signal?: AbortSignal): Promise<OpenThread[]>;
  /** Sujets publiés la veille de `date` (AAAA-MM-JJ), toutes langues. */
  yesterdayTopics(date: string, signal?: AbortSignal): Promise<Topic[]>;
  /** R12 : ferme les Threads sans événement depuis `days` jours à la date `date` ; renvoie leurs id. */
  closeStaleThreads(date: string, days?: number, signal?: AbortSignal): Promise<string[]>;
  /**
   * Optionnel : anomalies de données à signaler en avertissement (ex. événement daté trop loin dans
   * le futur). Ne bloque jamais le contexte.
   */
  anomalies?(date: string, signal?: AbortSignal): Promise<string[]>;
}

/**
 * Chaque appel reçoit un `AbortSignal` déclenché au dépassement du délai : le store doit cesser
 * le travail et ne rien écrire une fois le signal levé (Supabase : `.abortSignal(signal)`).
 */

/** Store sans base : aucun Thread, aucun sujet, rien à fermer. */
export class EmptyContextStore implements ContextStore {
  readonly name = 'vide';

  async openThreads(): Promise<OpenThread[]> {
    return [];
  }

  async yesterdayTopics(): Promise<Topic[]> {
    return [];
  }

  async closeStaleThreads(): Promise<string[]> {
    return [];
  }
}
