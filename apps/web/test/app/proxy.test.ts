// @vitest-environment node
import { unstable_doesMiddlewareMatch } from 'next/experimental/testing/server';
import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { access, isPublicPath } from '@/lib/access';
import { buildCsp } from '@/lib/csp';

const m = vi.hoisted(() => ({ email: null as string | null, refreshed: false }));
vi.mock('@supabase/ssr', () => ({
  createServerClient: (_url: string, _key: string, opts: { cookies: { setAll: (l: { name: string; value: string; options?: object }[]) => void } }) => ({
    auth: {
      getClaims: async () => {
        if (m.refreshed) opts.cookies.setAll([{ name: 'sb-ref-auth-token', value: 'neuf', options: { path: '/' } }]);
        return { data: m.email ? { claims: { email: m.email } } : null, error: null };
      },
    },
  }),
}));

import { config, proxy } from '@/proxy';

const req = (path: string, init?: { https?: boolean }) => new NextRequest(`${init?.https ? 'https' : 'http'}://brief.example${path}`);

beforeEach(() => {
  m.email = null;
  m.refreshed = false;
  vi.stubEnv('FIXTURE', '');
  vi.stubEnv('VERCEL', '');
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://ref.supabase.co');
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'sb_publishable_test');
  vi.stubEnv('ALLOWED_EMAIL', 'nanigeek@gmail.com');
});

describe('décision d’accès', () => {
  it('laisse passer les chemins publics, renvoie vers /login sans session ou avec une autre adresse', () => {
    for (const p of ['/login', '/auth/confirm', '/manifest.webmanifest', '/icons/icon-192.png']) expect(isPublicPath(p)).toBe(true);
    expect(access('/', null, false)).toBe('login');
    expect(access('/', 'intrus@exemple.fr', false)).toBe('refuse');
    expect(access('/vocab', 'nanigeek@gmail.com', true)).toBe('allow');
    expect(access('/auth/signout', null, false)).toBe('login');
  });
});

describe('CSP', () => {
  it('porte le nonce, l’origine Supabase pour l’audio et rien d’autre de distant', () => {
    const csp = buildCsp({ nonce: 'abc', supabaseOrigin: 'https://ref.supabase.co', dev: false, upgrade: true });
    expect(csp).toContain("script-src 'self' 'nonce-abc' 'strict-dynamic'");
    expect(csp).toContain("media-src 'self' https://ref.supabase.co");
    expect(csp).toContain("img-src 'self' data: https://images.pexels.com");
    expect(csp).toContain("connect-src 'self'");
    expect(csp).toContain('upgrade-insecure-requests');
    expect(csp).not.toContain('unsafe-eval');
    expect(buildCsp({ nonce: 'n', supabaseOrigin: null, dev: true, upgrade: false })).toContain("'unsafe-eval'");
  });
});

describe('proxy', () => {
  it('ne laisse hors du proxy que les fichiers statiques, le manifeste et les icônes, à l’adresse exacte', () => {
    const runs = (url: string) => unstable_doesMiddlewareMatch({ config, url });
    for (const url of ['/_next/static/chunks/a.js', '/icons/icon-192.png', '/manifest.webmanifest', '/favicon.ico']) expect(runs(url), url).toBe(false);
    for (const url of ['/', '/vocab', '/favicon.icoX', '/manifest.webmanifest/x', '/manifest.webmanifestX', '/audio/2026-11-06/fr']) expect(runs(url), url).toBe(true);
  });

  it('renvoie vers /login sans session, et vers /login?erreur=refuse pour une autre adresse', async () => {
    const login = await proxy(req('/vocab'));
    expect(login.status).toBe(303);
    expect(login.headers.get('location')).toBe('http://brief.example/login');
    m.email = 'intrus@exemple.fr';
    expect((await proxy(req('/'))).headers.get('location')).toBe('http://brief.example/login?erreur=refuse');
  });

  it('laisse passer l’utilisateur autorisé avec une CSP à nonce, et recopie la session rafraîchie', async () => {
    m.email = 'NaniGeek@gmail.com';
    m.refreshed = true;
    const r = await proxy(req('/', { https: true }));
    expect(r.headers.get('location')).toBeNull();
    expect(r.headers.get('content-security-policy')).toMatch(/'nonce-[A-Za-z0-9+/=]+'/);
    expect(r.cookies.get('sb-ref-auth-token')?.value).toBe('neuf');
  });

  it('laisse /login ouvert sans session', async () => {
    expect((await proxy(req('/login'))).headers.get('location')).toBeNull();
  });

  it('retient l’édition choisie dans un cookie, et ignore une valeur inconnue', async () => {
    m.email = 'nanigeek@gmail.com';
    const r = await proxy(req('/?ed=es', { https: true }));
    expect(r.cookies.get('ed')).toMatchObject({ value: 'es', httpOnly: true, secure: true, sameSite: 'lax' });
    expect((await proxy(req('/?ed=de'))).cookies.get('ed')).toBeUndefined();
  });

  it('en mode fixture, n’appelle pas Supabase et ne demande pas de connexion', async () => {
    vi.stubEnv('FIXTURE', '1');
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', '');
    const r = await proxy(req('/'));
    expect(r.headers.get('location')).toBeNull();
    expect(r.headers.get('content-security-policy')).toContain("media-src 'self';");
  });

  it('refuse le mode fixture sur Vercel', async () => {
    vi.stubEnv('FIXTURE', '1');
    vi.stubEnv('VERCEL', '1');
    await expect(proxy(req('/'))).rejects.toThrow(/interdit sur Vercel/);
  });
});
