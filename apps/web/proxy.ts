import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';
import { access } from '@/lib/access';
import { buildCsp } from '@/lib/csp';
import { EDITION_COOKIE, isLang } from '@/lib/edition-choice';
import { fixtureMode, isAllowedEmail, supabaseConfig } from '@/lib/env';

/**
 * Proxy (ex-middleware, Next 16, runtime Node) : pour chaque page,
 * 1. retient l'onglet d'édition (`?ed=en` → cookie `ed`, visible dès cette requête) ;
 * 2. rafraîchit la session Supabase et renvoie vers /login sans session, ou avec une autre adresse
 *    que ALLOWED_EMAIL (le mode FIXTURE=1 n'a pas de connexion) ;
 * 3. pose la CSP avec un nonce propre à la requête.
 */
export async function proxy(request: NextRequest) {
  const fixture = fixtureMode();
  const config = fixture ? null : supabaseConfig();
  const nonce = btoa(crypto.randomUUID());
  const https = request.nextUrl.protocol === 'https:' || request.headers.get('x-forwarded-proto') === 'https';
  const csp = buildCsp({ nonce, supabaseOrigin: config?.origin ?? null, dev: process.env.NODE_ENV === 'development', upgrade: https });

  const ed = request.nextUrl.searchParams.get('ed');
  if (isLang(ed)) request.cookies.set(EDITION_COOKIE, ed);

  const next = () => {
    const headers = new Headers(request.headers);
    headers.set('x-nonce', nonce);
    headers.set('content-security-policy', csp);
    return NextResponse.next({ request: { headers } });
  };
  let response = next();
  const pending: { name: string; value: string; options?: Parameters<typeof response.cookies.set>[2] }[] = [];

  if (config) {
    const supabase = createServerClient(config.url, config.anonKey, {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (list) => {
          for (const { name, value } of list) request.cookies.set(name, value);
          response = next();
          pending.push(...list);
        },
      },
    });
    const { data } = await supabase.auth.getClaims();
    const email = typeof data?.claims?.email === 'string' ? data.claims.email : null;
    const decision = access(request.nextUrl.pathname, email, isAllowedEmail(email));
    if (decision === 'login' || decision === 'refuse') {
      const url = request.nextUrl.clone();
      url.pathname = '/login';
      url.search = decision === 'refuse' ? '?erreur=refuse' : '';
      response = NextResponse.redirect(url);
    }
  }

  for (const { name, value, options } of pending) response.cookies.set(name, value, options);
  if (isLang(ed)) response.cookies.set(EDITION_COOKIE, ed, { path: '/', maxAge: 60 * 60 * 24 * 365, sameSite: 'lax', httpOnly: true, secure: https });
  response.headers.set('Content-Security-Policy', csp);
  return response;
}

export const config = {
  // Tout sauf les fichiers statiques de Next, le manifeste et les icônes (lus sans session par le navigateur).
  matcher: ['/((?!_next/static|_next/image|icons/|manifest.webmanifest|favicon.ico).*)'],
};
