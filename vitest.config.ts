import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const web = (p: string) => fileURLToPath(new URL(`./apps/web/${p}`, import.meta.url));

/**
 * Deux projets, un seul lanceur (`npm test`) : le pipeline et les paquets en Node, l'appli web en jsdom
 * (un fichier qui a besoin de Node, comme les tests PGlite, le déclare par `// @vitest-environment node`).
 */
export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'pipeline',
          include: ['packages/*/test/**/*.test.ts', 'pipeline/test/**/*.test.ts'],
          environment: 'node',
        },
      },
      {
        esbuild: { jsx: 'automatic' },
        resolve: { alias: { '@/': web(''), 'server-only': web('test/server-only.ts') } },
        test: {
          name: 'web',
          include: ['apps/web/test/**/*.test.{ts,tsx}'],
          environment: 'jsdom',
          setupFiles: [web('test/setup.ts')],
        },
      },
    ],
  },
});
