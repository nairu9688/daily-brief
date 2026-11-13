import type { Context, OpenThread } from '@daily-brief/schema';

export type Topic = Context['yesterdayTopics'][number];

/** Anomalie de données d'un Thread : `detail` est un fragment de phrase, sans le nom du Thread. */
export type StoreAnomaly = { threadId: string; kind: 'future-event'; detail: string };

/**
 * Accès aux Threads et aux sujets publiés. Le store Supabase arrive au lot 4 ; ses réponses sont
 * revalidées par `runContext`, qui ne fait confiance à aucune donnée externe.
 *
 * Chaque appel reçoit un `AbortSignal` déclenché au dépassement du délai : le store doit cesser
 * le travail et ne rien écrire une fois le signal levé (Supabase : `.abortSignal(signal)`).
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
   * Optionnel : anomalies de données, signalées en avertissement par `runContext` (qui formate le
   * message). Ne bloque jamais le contexte : une erreur, un délai ou un résultat invalide devient
   * un simple avertissement.
   */
  anomalies?(date: string, signal?: AbortSignal): Promise<StoreAnomaly[]>;
}

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
