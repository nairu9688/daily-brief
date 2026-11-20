import { describe, expect, it } from 'vitest';
import { allowedEmail, ConfigError, fixtureMode, fixtureToday, fixtureVisitor, isAllowedEmail, isServiceKey, supabaseConfig } from '@/lib/env';

const jwt = (payload: object) => `eyJhbGciOiJIUzI1NiJ9.${Buffer.from(JSON.stringify(payload)).toString('base64url')}.sig`;

describe('configuration de l’appli', () => {
  it('FIXTURE=1 active le mode fixture, sauf sur Vercel', () => {
    expect(fixtureMode({ FIXTURE: '1' })).toBe(true);
    expect(fixtureMode({ FIXTURE: 'true' })).toBe(false);
    expect(fixtureMode({})).toBe(false);
    expect(() => fixtureMode({ FIXTURE: '1', VERCEL: '1' })).toThrow(ConfigError);
  });

  it('refuse FIXTURE=1 en production, sauf avec l’accord explicite des tests de bout en bout', () => {
    expect(() => fixtureMode({ FIXTURE: '1', NODE_ENV: 'production' })).toThrow(/production/);
    expect(() => fixtureMode({ FIXTURE: '1', NODE_ENV: 'production', FIXTURE_ALLOW_START: 'true' })).toThrow(ConfigError);
    expect(fixtureMode({ FIXTURE: '1', NODE_ENV: 'production', FIXTURE_ALLOW_START: '1' })).toBe(true);
    expect(fixtureMode({ FIXTURE: '1', NODE_ENV: 'development' })).toBe(true);
    expect(fixtureMode({ NODE_ENV: 'production' })).toBe(false);
    expect(() => fixtureMode({ FIXTURE: '1', NODE_ENV: 'production', FIXTURE_ALLOW_START: '1', VERCEL: '1' })).toThrow(/Vercel/);
  });

  it('FIXTURE_VISITOR=1 simule un visiteur sans session, en mode fixture seulement', () => {
    expect(fixtureVisitor({ FIXTURE: '1', FIXTURE_VISITOR: '1' })).toBe(true);
    expect(fixtureVisitor({ FIXTURE: '1' })).toBe(false);
    expect(fixtureVisitor({ FIXTURE: '1', FIXTURE_VISITOR: 'true' })).toBe(false);
    expect(fixtureVisitor({ FIXTURE_VISITOR: '1' })).toBe(false);
    expect(() => fixtureVisitor({ FIXTURE: '1', FIXTURE_VISITOR: '1', VERCEL: '1' })).toThrow(/Vercel/);
  });

  it('« aujourd’hui » du mode fixture vaut la date de la fixture, ou FIXTURE_TODAY', () => {
    expect(fixtureToday({})).toBe('2026-11-06');
    expect(fixtureToday({ FIXTURE_TODAY: '2026-11-07' })).toBe('2026-11-07');
    expect(fixtureToday({ FIXTURE_TODAY: 'demain' })).toBe('2026-11-06');
  });

  it('lit l’URL et la clé publique de Supabase', () => {
    expect(supabaseConfig({ NEXT_PUBLIC_SUPABASE_URL: 'https://abc.supabase.co/', NEXT_PUBLIC_SUPABASE_ANON_KEY: jwt({ role: 'anon' }) })).toEqual({
      url: 'https://abc.supabase.co',
      anonKey: jwt({ role: 'anon' }),
      origin: 'https://abc.supabase.co',
    });
    expect(supabaseConfig({ NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:54321', NEXT_PUBLIC_SUPABASE_ANON_KEY: 'sb_publishable_x' }).origin).toBe('http://127.0.0.1:54321');
  });

  it('refuse une configuration absente, en http, ou avec identifiants', () => {
    expect(() => supabaseConfig({})).toThrow(/NEXT_PUBLIC_SUPABASE_URL/);
    expect(() => supabaseConfig({ NEXT_PUBLIC_SUPABASE_URL: 'http://abc.supabase.co', NEXT_PUBLIC_SUPABASE_ANON_KEY: 'k' })).toThrow(/https/);
    expect(() => supabaseConfig({ NEXT_PUBLIC_SUPABASE_URL: 'https://u:p@abc.supabase.co', NEXT_PUBLIC_SUPABASE_ANON_KEY: 'k' })).toThrow(/identifiants/);
  });

  it('refuse toute clé de service, JWT ou clé secrète', () => {
    expect(isServiceKey(jwt({ role: 'service_role' }))).toBe(true);
    expect(isServiceKey('sb_secret_abc')).toBe(true);
    expect(isServiceKey(jwt({ role: 'anon' }))).toBe(false);
    expect(() => supabaseConfig({ NEXT_PUBLIC_SUPABASE_URL: 'https://abc.supabase.co', NEXT_PUBLIC_SUPABASE_ANON_KEY: jwt({ role: 'service_role' }) })).toThrow(/clé de service/);
  });

  it('compare l’email autorisé sans casse ni espaces, et n’autorise jamais un email vide', () => {
    const env = { ALLOWED_EMAIL: ' Nanigeek@Gmail.com ' };
    expect(allowedEmail(env)).toBe('nanigeek@gmail.com');
    expect(isAllowedEmail('NANIGEEK@gmail.com ', env)).toBe(true);
    expect(isAllowedEmail('autre@gmail.com', env)).toBe(false);
    expect(isAllowedEmail('', { ALLOWED_EMAIL: '' })).toBe(false);
    expect(isAllowedEmail(null, env)).toBe(false);
    expect(allowedEmail({})).toBeNull();
  });
});
