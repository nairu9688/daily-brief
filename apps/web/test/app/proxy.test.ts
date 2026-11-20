// @vitest-environment node
import { unstable_doesMiddlewareMatch } from 'next/experimental/testing/server';
import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { access, isPrivatePath, isPublicPath } from '@/lib/access';
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
  vi.stubEnv('FIXTURE_VISITOR', '');
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://ref.supabase.co');
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'sb_publishable_test');
  vi.stubEnv('ALLOWED_EMAIL', 'nanigeek@gmail.com');
});

describe('décision d’accès', () => {
  it('le contenu est public ; seule la page Santé demande l’utilisateur autorisé', () => {
    for (const p of ['/login', '/auth/confirm', '/manifest.webmanifest', '/icons/icon-192.png']) expect(isPublicPath(p)).toBe(true);
    for (const p of ['/', '/vocab', '/threads', '/threads/x', '/archive', '/edition/2026-11-06', '/audio/2026-11-06/fr', '/pdf/2026-11-06', '/auth/signout', '/santeX']) {
      expect(isPrivatePath(p), p).toBe(false);
      expect(access(p, null, false), p).toBe('public');
      expect(access(p, 'intrus@exemple.fr', false), p).toBe('public');
    }
    for (const p of ['/sante', '/sante/', '/sante/x']) expect(isPrivatePath(p), p).toBe(true);
    expect(access('/sante', null, false)).toBe('login');
    expect(access('/sante', 'intrus@exemple.fr', false)).toBe('refuse');
    expect(access('/sante', 'nanigeek@gmail.com', true)).toBe('allow');
  });
});

describe('CSP', () => {
  it('porte le nonce, l’origine Supabase pour l’audio et rien d’autre de distant', () => {
    const csp = buildCsp({ nonce: 'abc', supabaseOrigin: 'https://ref.supabase.co', dev: false, upgrade: true });
    expect(csp).toContain("script-src 'self' 'nonce-abc' 'strict-dynamic'");
    expect(csp).toContain("media-src 'self' https://ref.supabase.co");
    expect(csp).toContain("img-src 'self' data: https://upload.wikimedia.org https://thumb.wikimedia.org");
    expect(csp).not.toContain('pexels');
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

  it('ouvre les pages de contenu sans session, avec une CSP à nonce', async () => {
    for (const path of ['/', '/vocab', '/threads', '/archive', '/edition/2026-11-06', '/audio/2026-11-06/fr', '/pdf/2026-11-06']) {
      const r = await proxy(req(path));
      expect(r.status, path).toBe(200);
      expect(r.headers.get('location'), path).toBeNull();
      expect(r.headers.get('content-security-policy'), path).toMatch(/'nonce-[A-Za-z0-9+/=]+'/);
    }
    m.email = 'intrus@exemple.fr';
    expect((await proxy(req('/vocab'))).headers.get('location')).toBeNull();
  });

  it('renvoie /sante vers /login sans session, et vers /login?erreur=refuse pour une autre adresse', async () => {
    const login = await proxy(req('/sante'));
    expect(login.status).toBe(303);
    expect(login.headers.get('location')).toBe('http://brief.example/login');
    m.email = 'intrus@exemple.fr';
    expect((await proxy(req('/sante'))).headers.get('location')).toBe('http://brief.example/login?erreur=refuse');
    m.email = 'nanigeek@gmail.com';
    expect((await proxy(req('/sante'))).headers.get('location')).toBeNull();
  });

  it('laisse passer l’utilisateur autorisé avec une CSP à nonce, et recopie la session rafraîchie', async () => {
    m.email = 'NaniGeek@gmail.com';
    m.refreshed = true;
    const r = await proxy(req('/', { https: true }));
    expect(r.headers.get('location')).toBeNull();
    expect(r.headers.get('content-security-policy')).toMatch(/'nonce-[A-Za-z0-9+/=]+'/);
    expect(r.cookies.get('sb-ref-auth-token')?.value).toBe('neuf');
  });

  it('laisse passer une action serveur sans session (l’action répond « Session expirée »), même sur /sante', async () => {
    const action = (path: string) => new NextRequest(`http://brief.example${path}`, { method: 'POST', headers: { 'next-action': 'abc123', 'content-type': 'text/plain' } });
    for (const path of ['/vocab', '/sante']) {
      const r = await proxy(action(path));
      expect(r.headers.get('location'), path).toBeNull();
      expect(r.status, path).toBe(200);
      expect(r.headers.get('content-security-policy'), path).toContain('nonce-');
    }
    expect((await proxy(req('/sante'))).status).toBe(303);
    m.email = 'intrus@exemple.fr';
    expect((await proxy(action('/sante'))).headers.get('location')).toBeNull();
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
    for (const path of ['/', '/sante']) {
      const r = await proxy(req(path));
      expect(r.headers.get('location'), path).toBeNull();
      expect(r.headers.get('content-security-policy')).toContain("media-src 'self';");
    }
  });

  it('en mode fixture visiteur (FIXTURE_VISITOR=1), /sante renvoie vers /login comme sans session', async () => {
    vi.stubEnv('FIXTURE', '1');
    vi.stubEnv('FIXTURE_VISITOR', '1');
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', '');
    expect((await proxy(req('/'))).headers.get('location')).toBeNull();
    expect((await proxy(req('/sante'))).headers.get('location')).toBe('http://brief.example/login');
  });

  it('refuse le mode fixture sur Vercel', async () => {
    vi.stubEnv('FIXTURE', '1');
    vi.stubEnv('VERCEL', '1');
    await expect(proxy(req('/'))).rejects.toThrow(/interdit sur Vercel/);
  });
});
