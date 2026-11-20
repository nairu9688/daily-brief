// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => ({ email: null as string | null, calls: 0 }));
vi.mock('@/lib/supabase/server', () => ({
  createSupabase: async () => ({ auth: { getClaims: async () => (m.calls++, { data: m.email ? { claims: { email: m.email } } : null, error: null }) } }),
}));

import { currentUser } from '@/lib/auth';

beforeEach(() => {
  m.email = null;
  m.calls = 0;
  vi.stubEnv('FIXTURE', '');
  vi.stubEnv('FIXTURE_VISITOR', '');
  vi.stubEnv('VERCEL', '');
  vi.stubEnv('ALLOWED_EMAIL', 'nanigeek@gmail.com');
});

describe('utilisateur de la requête', () => {
  it('rend l’utilisateur autorisé seulement : un visiteur ou une autre adresse donnent null', async () => {
    expect(await currentUser()).toBeNull();
    m.email = 'intrus@exemple.fr';
    expect(await currentUser()).toBeNull();
    m.email = 'NaniGeek@gmail.com';
    expect(await currentUser()).toEqual({ email: 'NaniGeek@gmail.com' });
  });

  it('en mode fixture, l’utilisateur est connecté, sauf avec FIXTURE_VISITOR=1, sans appeler Supabase', async () => {
    vi.stubEnv('FIXTURE', '1');
    expect(await currentUser()).toEqual({ email: 'fixture@localhost' });
    vi.stubEnv('FIXTURE_VISITOR', '1');
    expect(await currentUser()).toBeNull();
    expect(m.calls).toBe(0);
  });
});
