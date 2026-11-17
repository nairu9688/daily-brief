/** Content-Security-Policy d'une réponse, avec le nonce de la requête (posée par proxy.ts). */
export type CspOptions = { nonce: string; supabaseOrigin: string | null; dev: boolean; upgrade: boolean };

export function buildCsp({ nonce, supabaseOrigin, dev, upgrade }: CspOptions): string {
  const media = ["'self'", ...(supabaseOrigin ? [supabaseOrigin] : [])];
  const directives = [
    "default-src 'self'",
    // 'strict-dynamic' : seuls les scripts portant le nonce (ceux de Next) et ce qu'ils chargent s'exécutent.
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${dev ? " 'unsafe-eval'" : ''}`,
    // Attributs style (couleurs des pastilles, hauteurs des barres) : pas de feuille externe.
    "style-src 'self' 'unsafe-inline'",
    // Photos : seulement le CDN de Pexels (leçon SSRF du lot 2 : pas d'optimiseur d'images côté serveur).
    "img-src 'self' data: https://images.pexels.com",
    // Audio : la route /audio redirige vers une URL signée du projet Supabase.
    `media-src ${media.join(' ')}`,
    "connect-src 'self'",
    "font-src 'self'",
    "manifest-src 'self'",
    "worker-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ];
  if (upgrade) directives.push('upgrade-insecure-requests');
  return directives.join('; ');
}
