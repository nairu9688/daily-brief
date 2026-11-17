import { beforeEach, describe, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => ({
  auth: {
    signInWithOtp: vi.fn(async (_: unknown) => ({ error: null as null | { message: string } })),
    verifyOtp: vi.fn(async (_: unknown) => ({ error: null as null | { message: string } })),
  },
  host: 'localhost:3000',
}));
vi.mock('@/lib/supabase/server', () => ({ createSupabase: async () => ({ auth: m.auth }) }));
vi.mock('next/headers', () => ({ headers: async () => new Headers({ host: m.host }) }));
vi.mock('next/navigation', () => ({
  redirect: (to: string) => {
    throw new Error(`REDIRECT ${to}`);
  },
}));

import { sendLink, verifyCode } from '@/app/login/actions';

const form = (fields: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.set(k, v);
  return f;
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('ALLOWED_EMAIL', 'nanigeek@gmail.com');
  vi.stubEnv('FIXTURE', '');
  vi.stubEnv('SITE_URL', '');
  m.host = 'localhost:3000';
});

describe('connexion par lien magique', () => {
  it('envoie le lien à l’adresse autorisée, retour sur /auth/confirm', async () => {
    const r = await sendLink({ step: 'email' }, form({ email: ' NaniGeek@gmail.com ' }));
    expect(r).toMatchObject({ step: 'code', email: 'nanigeek@gmail.com' });
    expect(m.auth.signInWithOtp).toHaveBeenCalledWith({ email: 'nanigeek@gmail.com', options: { emailRedirectTo: 'http://localhost:3000/auth/confirm', shouldCreateUser: true } });
  });

  it('n’envoie rien à une autre adresse, avec la même réponse', async () => {
    const ok = await sendLink({ step: 'email' }, form({ email: 'nanigeek@gmail.com' }));
    const other = await sendLink({ step: 'email' }, form({ email: 'intrus@exemple.fr' }));
    expect(other.message).toBe(ok.message);
    expect(m.auth.signInWithOtp).toHaveBeenCalledTimes(1);
  });

  it('n’envoie rien sans ALLOWED_EMAIL', async () => {
    vi.stubEnv('ALLOWED_EMAIL', '');
    await sendLink({ step: 'email' }, form({ email: 'nanigeek@gmail.com' }));
    expect(m.auth.signInWithOtp).not.toHaveBeenCalled();
  });

  it('prend SITE_URL en production et refuse un Host forgé', async () => {
    m.host = 'evil.example';
    expect(await sendLink({ step: 'email' }, form({ email: 'nanigeek@gmail.com' }))).toEqual({ step: 'email', error: 'SITE_URL n’est pas configurée.' });
    expect(await sendLink({ step: 'email' }, form({ email: 'intrus@exemple.fr' }))).toEqual({ step: 'email', error: 'SITE_URL n’est pas configurée.' });
    vi.stubEnv('SITE_URL', 'https://daily-brief.vercel.app');
    await sendLink({ step: 'email' }, form({ email: 'nanigeek@gmail.com' }));
    expect(m.auth.signInWithOtp).toHaveBeenCalledWith(expect.objectContaining({ options: expect.objectContaining({ emailRedirectTo: 'https://daily-brief.vercel.app/auth/confirm' }) }));
  });

  it('refuse une adresse invalide', async () => {
    expect((await sendLink({ step: 'email' }, form({ email: 'pas une adresse' }))).error).toBe('Adresse invalide.');
  });

  it('un échec d’envoi donne la même réponse qu’une autre adresse, et n’est journalisé que côté serveur', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const other = await sendLink({ step: 'email' }, form({ email: 'intrus@exemple.fr' }));
    m.auth.signInWithOtp.mockResolvedValueOnce({ error: Object.assign(new Error('rate limit for nanigeek@gmail.com'), { status: 429, code: 'over_email_send_rate_limit' }) });
    const failed = await sendLink({ step: 'email' }, form({ email: 'nanigeek@gmail.com' }));
    expect(failed).toEqual({ ...other, email: 'nanigeek@gmail.com' });
    expect(failed.error).toBeUndefined();
    expect(log).toHaveBeenCalledTimes(1);
    const logged = log.mock.calls[0].map(String).join(' ');
    expect(logged).toContain('over_email_send_rate_limit');
    expect(logged).not.toContain('nanigeek');
    log.mockRestore();
  });

  it('vérifie le code reçu puis renvoie vers le Brief', async () => {
    await expect(verifyCode({ step: 'code' }, form({ email: 'nanigeek@gmail.com', code: '123 456' }))).rejects.toThrow('REDIRECT /');
    expect(m.auth.verifyOtp).toHaveBeenCalledWith({ email: 'nanigeek@gmail.com', token: '123456', type: 'email' });
  });

  it('refuse un code mal formé, une autre adresse, ou un code expiré', async () => {
    expect((await verifyCode({ step: 'code' }, form({ email: 'nanigeek@gmail.com', code: 'abc' }))).error).toBe('Code invalide ou expiré.');
    expect((await verifyCode({ step: 'code' }, form({ email: 'intrus@exemple.fr', code: '123456' }))).error).toBe('Code invalide ou expiré.');
    expect(m.auth.verifyOtp).not.toHaveBeenCalled();
    m.auth.verifyOtp.mockResolvedValueOnce({ error: { message: 'expired' } });
    expect((await verifyCode({ step: 'code' }, form({ email: 'nanigeek@gmail.com', code: '123456' }))).error).toBe('Code invalide ou expiré.');
  });
});
