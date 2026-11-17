// @vitest-environment node
import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => ({
  email: 'nanigeek@gmail.com' as string | null,
  auth: {
    verifyOtp: vi.fn(async (_: unknown) => ({ error: null as null | Error })),
    exchangeCodeForSession: vi.fn(async (_: unknown) => ({ error: null as null | Error })),
    getClaims: vi.fn(async () => ({ data: { claims: { email: m.email } }, error: null })),
    signOut: vi.fn(async () => ({ error: null })),
  },
}));
vi.mock('@/lib/supabase/server', () => ({ createSupabase: async () => ({ auth: m.auth }) }));

import { GET } from '@/app/auth/confirm/route';
import { POST } from '@/app/auth/signout/route';

const get = (qs: string) => GET(new NextRequest(`https://brief.example/auth/confirm${qs}`));

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('ALLOWED_EMAIL', 'nanigeek@gmail.com');
  vi.stubEnv('FIXTURE', '');
  m.email = 'nanigeek@gmail.com';
});

describe('retour du lien magique', () => {
  it('accepte token_hash et renvoie toujours vers /', async () => {
    const r = await get('?token_hash=abc&type=email&next=https://evil.example');
    expect(r.status).toBe(303);
    expect(r.headers.get('location')).toBe('https://brief.example/');
    expect(m.auth.verifyOtp).toHaveBeenCalledWith({ token_hash: 'abc', type: 'email' });
  });

  it('accepte un code PKCE', async () => {
    await get('?code=xyz');
    expect(m.auth.exchangeCodeForSession).toHaveBeenCalledWith('xyz');
  });

  it('renvoie vers /login pour un lien incomplet, inconnu ou expiré', async () => {
    expect((await get('')).headers.get('location')).toBe('https://brief.example/login?erreur=lien');
    expect((await get('?token_hash=abc&type=recovery')).headers.get('location')).toBe('https://brief.example/login?erreur=lien');
    m.auth.verifyOtp.mockResolvedValueOnce({ error: new Error('expired') });
    expect((await get('?token_hash=abc&type=magiclink')).headers.get('location')).toBe('https://brief.example/login?erreur=lien');
  });

  it('déconnecte aussitôt une autre adresse', async () => {
    m.email = 'intrus@exemple.fr';
    expect((await get('?code=xyz')).headers.get('location')).toBe('https://brief.example/login?erreur=refuse');
    expect(m.auth.signOut).toHaveBeenCalled();
  });

  it('déconnecte en POST', async () => {
    const r = await POST(new NextRequest('https://brief.example/auth/signout', { method: 'POST' }));
    expect(r.headers.get('location')).toBe('https://brief.example/login');
    expect(m.auth.signOut).toHaveBeenCalled();
  });
});
