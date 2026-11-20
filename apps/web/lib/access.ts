/** Chemins ouverts sans session hors du contenu : connexion, retour du lien magique, manifeste et icônes. */
export function isPublicPath(path: string): boolean {
  return path === '/login' || path === '/auth/confirm' || path === '/manifest.webmanifest' || path.startsWith('/icons/');
}

/** Pages réservées à l'utilisateur autorisé : la page Santé seulement (le contenu du brief est public). */
export function isPrivatePath(path: string): boolean {
  return path === '/sante' || path.startsWith('/sante/');
}

export type Access = 'public' | 'allow' | 'login' | 'refuse';

/**
 * Décision du proxy pour une requête. Le brief se lit sans connexion (lecture publique, 0005) : tout
 * chemin est public, sauf /sante, qui demande l'utilisateur autorisé (sans session : vers /login ;
 * session d'une autre adresse : vers /login?erreur=refuse, la RLS ne lui montrerait aucun passage).
 */
export function access(path: string, email: string | null, allowed: boolean): Access {
  if (isPublicPath(path) || !isPrivatePath(path)) return 'public';
  if (!email) return 'login';
  return allowed ? 'allow' : 'refuse';
}
