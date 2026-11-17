import { NextResponse, type NextRequest } from 'next/server';
import { fixtureMode } from '@/lib/env';
import { createSupabase } from '@/lib/supabase/server';

/** Déconnexion (POST seulement : un lien ou une image ne peut pas déconnecter). */
export async function POST(request: NextRequest) {
  if (!fixtureMode()) await (await createSupabase()).auth.signOut();
  return NextResponse.redirect(new URL('/login', request.nextUrl.origin), { status: 303 });
}
