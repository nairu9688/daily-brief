// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { FileTarget } from '@/lib/data/types';

const m = vi.hoisted(() => ({ user: { email: 'x' } as object | null, audio: null as FileTarget | null, pdf: null as FileTarget | null, calls: [] as string[] }));
vi.mock('@/lib/auth', () => ({ currentUser: async () => m.user }));
vi.mock('@/lib/data', () => ({
  getDataSource: async () => ({
    audio: async (d: string, l: string) => (m.calls.push(`audio ${d} ${l}`), m.audio),
    pdf: async (d: string) => (m.calls.push(`pdf ${d}`), m.pdf),
  }),
}));

import { GET as audio } from '@/app/audio/[date]/[lang]/route';
import { GET as pdf } from '@/app/pdf/[date]/route';

const call = (date: string, lang: string) => audio(new Request('http://x'), { params: Promise.resolve({ date, lang }) });

beforeEach(() => Object.assign(m, { user: { email: 'x' }, audio: null, pdf: null, calls: [] }));

describe('routes de fichiers', () => {
  it('redirige vers l’URL signée, sans cache ni Referer', async () => {
    m.audio = { kind: 'redirect', url: 'https://ref.supabase.co/storage/v1/object/sign/audio/2026-11-06/fr.mp3?token=t' };
    const r = await call('2026-11-06', 'fr');
    expect(r.status).toBe(307);
    expect(r.headers.get('location')).toBe(m.audio.url);
    expect(r.headers.get('cache-control')).toBe('private, no-store');
    expect(r.headers.get('referrer-policy')).toBe('no-referrer');
  });

  it('sert les octets du mode fixture', async () => {
    m.audio = { kind: 'bytes', body: new Uint8Array([0xff, 0xf3]), contentType: 'audio/mpeg' };
    const r = await call('2026-11-06', 'en');
    expect(r.headers.get('content-type')).toBe('audio/mpeg');
    expect(new Uint8Array(await r.arrayBuffer())).toEqual(new Uint8Array([0xff, 0xf3]));
  });

  it('404 pour des paramètres invalides ou un fichier absent, 401 sans utilisateur', async () => {
    expect((await call('2026-02-30', 'fr')).status).toBe(404);
    expect((await call('2026-11-06', 'de')).status).toBe(404);
    expect(m.calls).toEqual([]);
    expect((await call('2026-11-06', 'es')).status).toBe(404);
    m.user = null;
    expect((await call('2026-11-06', 'fr')).status).toBe(401);
    expect((await pdf(new Request('http://x'), { params: Promise.resolve({ date: '2026-11-06' }) })).status).toBe(401);
  });
});
