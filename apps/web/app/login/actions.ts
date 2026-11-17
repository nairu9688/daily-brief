'use server';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { fixtureMode, isAllowedEmail, siteOrigin } from '@/lib/env';
import { createSupabase } from '@/lib/supabase/server';

export type LoginState = { step: 'email' | 'code'; email?: string; message?: string; error?: string };

const Email = z.email().max(254);
const Code = z.string().regex(/^\d{6,10}$/);

/** Message identique que l'adresse soit autorisée ou non : la page ne révèle pas l'adresse autorisée. */
const SENT = 'Si cette adresse est autorisée, un lien de connexion vient de partir. Ouvre-le, ou saisis ici le code du courriel.';

async function requestOrigin(): Promise<string | null> {
  const h = await headers();
  const host = h.get('host');
  return host ? `${h.get('x-forwarded-proto') ?? 'http'}://${host}` : null;
}

/**
 * Envoie le lien magique. ALLOWED_EMAIL est vérifié AVANT tout appel à Supabase : une autre adresse
 * ne déclenche aucun courriel (pas d'abus du quota d'envoi, pas de compte créé), avec la même réponse.
 */
export async function sendLink(_prev: LoginState, form: FormData): Promise<LoginState> {
  const email = Email.safeParse(String(form.get('email') ?? '').trim().toLowerCase());
  if (!email.success) return { step: 'email', error: 'Adresse invalide.' };
  if (fixtureMode()) return { step: 'email', error: 'Mode fixture : pas de connexion, l’appli est ouverte.' };
  const sent: LoginState = { step: 'code', email: email.data, message: SENT };
  // Configuration vérifiée avant l'adresse : l'erreur, s'il y en a une, est la même pour toutes.
  const origin = siteOrigin(await requestOrigin());
  if (!origin) return { step: 'email', error: 'SITE_URL n’est pas configurée.' };
  if (!isAllowedEmail(email.data)) return sent;
  const supabase = await createSupabase();
  const { error } = await supabase.auth.signInWithOtp({ email: email.data, options: { emailRedirectTo: `${origin}/auth/confirm`, shouldCreateUser: true } });
  // Un échec d'envoi (quota, panne) donne la même réponse qu'une autre adresse : la page ne révèle
  // jamais si l'adresse est autorisée. Il est journalisé côté serveur, sans l'adresse ni le message.
  if (error) {
    const { status, code } = error as { status?: unknown; code?: unknown };
    console.error(`[daily-brief] envoi du lien impossible : statut ${String(status ?? '?')}, code ${String(code ?? '?')}`);
  }
  return sent;
}

/**
 * Code à usage unique du même courriel : utile depuis l'appli installée sur l'écran d'accueil, où le
 * lien s'ouvrirait dans le navigateur et non dans l'appli.
 */
export async function verifyCode(prev: LoginState, form: FormData): Promise<LoginState> {
  const email = Email.safeParse(String(form.get('email') ?? '').trim().toLowerCase());
  const code = Code.safeParse(String(form.get('code') ?? '').replace(/\s/g, ''));
  const retry: LoginState = { ...prev, step: 'code', error: 'Code invalide ou expiré.' };
  if (!email.success || !code.success || !isAllowedEmail(email.data)) return retry;
  const supabase = await createSupabase();
  const { error } = await supabase.auth.verifyOtp({ email: email.data, token: code.data, type: 'email' });
  if (error) return retry;
  redirect('/');
}
