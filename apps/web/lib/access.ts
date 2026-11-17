/** Chemins ouverts sans session : connexion, retour du lien magique, manifeste et icônes. */
export function isPublicPath(path: string): boolean {
  return path === '/login' || path === '/auth/confirm' || path === '/manifest.webmanifest' || path.startsWith('/icons/');
}

export type Access = 'public' | 'allow' | 'login' | 'refuse';

/**
 * Décision du proxy pour une requête : chemin public, utilisateur autorisé, pas de session (vers
 * /login), ou session d'une autre adresse (vers /login?erreur=refuse : la RLS ne lui montrerait rien).
 */
export function access(path: string, email: string | null, allowed: boolean): Access {
  if (isPublicPath(path)) return 'public';
  if (!email) return 'login';
  return allowed ? 'allow' : 'refuse';
}
