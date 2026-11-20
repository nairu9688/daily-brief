import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';
import { access } from '@/lib/access';
import { buildCsp } from '@/lib/csp';
import { EDITION_COOKIE, EDITION_COOKIE_MAX_AGE, isLang } from '@/lib/edition-choice';
import { fixtureMode, fixtureVisitor, isAllowedEmail, supabaseConfig } from '@/lib/env';

/**
 * Proxy (ex-middleware, Next 16, runtime Node) : pour chaque page,
 * 1. retient l'onglet d'édition (`?ed=en` → cookie `ed`, visible dès cette requête). Un préchargement
 *    rend l'écran demandé mais ne change pas le choix retenu (voir plus bas) ;
 * 2. rafraîchit la session Supabase s'il y en a une. Le brief est public : seule /sante renvoie vers
 *    /login sans session, ou avec une autre adresse que ALLOWED_EMAIL (mode FIXTURE=1 : pas de
 *    connexion, l'utilisateur est connecté, sauf FIXTURE_VISITOR=1 qui simule un visiteur) ;
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

  let decision: ReturnType<typeof access> = 'public';
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
    decision = access(request.nextUrl.pathname, email, isAllowedEmail(email));
  } else if (fixture && fixtureVisitor()) {
    decision = access(request.nextUrl.pathname, null, false);
  }
  // Une action serveur (POST avec l'en-tête Next-Action) n'est pas redirigée : le client ne saurait pas
  // lire la page /login. L'action elle-même est le garde-fou : elle vérifie currentUser() avant tout
  // et répond « Session expirée », sans lire ni écrire quoi que ce soit.
  const action = request.method === 'POST' && request.headers.has('next-action');
  if ((decision === 'login' || decision === 'refuse') && !action) {
    const url = request.nextUrl.clone();
    url.pathname = '/login';
    url.search = decision === 'refuse' ? '?erreur=refuse' : '';
    // 303 : le navigateur suit en GET. Un 307 rejouerait vers /login le POST d'une action serveur.
    response = NextResponse.redirect(url, 303);
  }

  for (const { name, value, options } of pending) response.cookies.set(name, value, options);
  // Seul le chargement d'une page (Sec-Fetch-Dest: document, ou navigateur qui ne l'envoie pas) retient le
  // choix : les requêtes RSC de Next (préchargement des onglets, navigation côté client) passent par fetch()
  // et ne doivent pas le changer. Next retire ses propres en-têtes (Next-Router-Prefetch, RSC) avant le proxy.
  // La navigation côté client pose le cookie au clic (EditionTabs) : il n'est donc pas httpOnly (une langue).
  const dest = request.headers.get('sec-fetch-dest');
  const pageLoad = dest === null || dest === 'document';
  if (isLang(ed) && pageLoad) response.cookies.set(EDITION_COOKIE, ed, { path: '/', maxAge: EDITION_COOKIE_MAX_AGE, sameSite: 'lax', httpOnly: false, secure: https });
  response.headers.set('Content-Security-Policy', csp);
  return response;
}

export const config = {
  // Tout sauf les fichiers statiques de Next, le manifeste et les icônes (lus sans session par le navigateur).
  // Exclusions ancrées : /favicon.icoX ou /manifest.webmanifest/x passent par le proxy.
  matcher: ['/((?!_next/static|_next/image|icons/|manifest\\.webmanifest$|favicon\\.ico$).*)'],
};
