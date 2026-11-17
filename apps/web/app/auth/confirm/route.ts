import { NextResponse, type NextRequest } from 'next/server';
import { isAllowedEmail } from '@/lib/env';
import { createSupabase } from '@/lib/supabase/server';

const TYPES = new Set(['email', 'magiclink']);

/**
 * Retour du lien magique. Deux formes : `token_hash` + `type` (modèle de courriel recommandé, marche
 * même si le lien s'ouvre dans un autre navigateur) ou `code` (flux PKCE par défaut). La destination
 * est toujours `/` : aucun paramètre ne choisit où l'on est renvoyé (pas de redirection ouverte).
 */
export async function GET(request: NextRequest) {
  const url = request.nextUrl;
  const to = (path: string) => NextResponse.redirect(new URL(path, url.origin), { status: 303 });
  const supabase = await createSupabase();
  const tokenHash = url.searchParams.get('token_hash');
  const type = url.searchParams.get('type');
  const code = url.searchParams.get('code');
  const { error } =
    tokenHash && type && TYPES.has(type)
      ? await supabase.auth.verifyOtp({ token_hash: tokenHash, type: type as 'email' | 'magiclink' })
      : code
        ? await supabase.auth.exchangeCodeForSession(code)
        : { error: new Error('lien incomplet') };
  if (error) return to('/login?erreur=lien');
  const { data } = await supabase.auth.getClaims();
  if (!isAllowedEmail(typeof data?.claims?.email === 'string' ? data.claims.email : null)) {
    await supabase.auth.signOut();
    return to('/login?erreur=refuse');
  }
  return to('/');
}
