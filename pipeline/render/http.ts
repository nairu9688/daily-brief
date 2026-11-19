/** Sous-ensemble de `fetch` utilisé par le rendu : injectable dans les tests, aucun appel réseau réel. */
export type FetchLike = (
  url: string,
  init?: { headers?: Record<string, string>; signal?: AbortSignal },
) => Promise<{
  ok: boolean;
  status: number;
  headers: { get(name: string): string | null };
  json(): Promise<unknown>;
  arrayBuffer(): Promise<ArrayBuffer>;
  /** Corps en flux (fetch de Node) : la lecture bornée s'arrête dès que la taille maximale est dépassée. */
  body?: ReadableStream<Uint8Array> | null;
}>;

/**
 * Agent exigé par la politique de Wikimedia (API et médias : une requête sans agent descriptif est
 * refusée) ; générique, sans nom ni adresse de personne.
 */
export const WIKIMEDIA_USER_AGENT = 'DailyBrief/1.0 (personal news digest)';
