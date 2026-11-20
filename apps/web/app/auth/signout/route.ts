import { NextResponse, type NextRequest } from 'next/server';
import { fixtureMode } from '@/lib/env';
import { createSupabase } from '@/lib/supabase/server';

/** Déconnexion (POST seulement : un lien ou une image ne peut pas déconnecter), puis retour au Brief, public. */
export async function POST(request: NextRequest) {
  // scope 'local' : seule la session de cet appareil est fermée ; l'appli installée (PWA) reste connectée.
  if (!fixtureMode()) await (await createSupabase()).auth.signOut({ scope: 'local' });
  return NextResponse.redirect(new URL('/', request.nextUrl.origin), { status: 303 });
}
