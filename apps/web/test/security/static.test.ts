// @vitest-environment node
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import { renderMap } from '@daily-brief/maps';

const WEB = join(process.cwd(), 'apps/web');
// Code livré seulement : ni les tests, ni les scripts de développement (check-bundle nomme les secrets qu'il cherche).
const SKIP = new Set(['node_modules', '.next', 'test', 'e2e', 'public', 'scripts']);

function sources(dir = WEB): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) return SKIP.has(f) ? [] : sources(p);
    return /\.(ts|tsx)$/.test(f) ? [relative(WEB, p)] : [];
  });
}

const read = (f: string) => readFileSync(join(WEB, f), 'utf8');

describe('règles de sécurité du code de l’appli', () => {
  it('n’utilise dangerouslySetInnerHTML que pour la carte SVG', () => {
    expect(sources().filter((f) => read(f).includes('dangerouslySetInnerHTML'))).toEqual(['components/MapSvg.tsx']);
  });

  it('ne mentionne jamais la clé de service', () => {
    expect(sources().filter((f) => /SERVICE_ROLE|service_role|sb_secret/.test(read(f)) && f !== 'lib/env.ts')).toEqual([]);
  });

  it('n’expose au navigateur que les deux variables publiques de Supabase', () => {
    const names = new Set(sources().flatMap((f) => [...read(f).matchAll(/NEXT_PUBLIC_[A-Z_]+/g)].map((x) => x[0])));
    expect([...names].sort()).toEqual(['NEXT_PUBLIC_SUPABASE_ANON_KEY', 'NEXT_PUBLIC_SUPABASE_URL']);
  });

  it('les modules de données et d’authentification sont réservés au serveur', () => {
    for (const f of ['lib/data/index.ts', 'lib/data/fixture.ts', 'lib/data/supabase.ts', 'lib/supabase/server.ts', 'lib/auth.ts', 'lib/file-response.ts']) {
      expect(read(f), f).toMatch(/^import 'server-only';/);
    }
    const clients = sources().filter((f) => read(f).startsWith("'use client'"));
    // Un import de type (`import type`) disparaît à la compilation : seuls les imports de valeur comptent.
    for (const f of clients) expect(read(f), f).not.toMatch(/^import (?!type )[^;]*'@\/lib\/(data|supabase|auth|env)/m);
  });

  it('n’utilise pas next/image (pas d’optimiseur qui irait chercher des URL côté serveur)', () => {
    expect(sources().filter((f) => /from 'next\/image'/.test(read(f)))).toEqual([]);
    expect(read('next.config.ts')).not.toMatch(/remotePatterns|domains/);
  });

  it('la carte SVG échappe les libellés venus de l’édition', () => {
    const svg = renderMap({ projection: 'conic-france', places: [{ name: '<script>alert(1)</script>', lon: 2.35, lat: 48.86 }] }, '"><img src=x onerror=alert(1)>');
    expect(svg).not.toMatch(/<script|<img/);
    expect(svg).toContain('&lt;script&gt;');
  });
});
