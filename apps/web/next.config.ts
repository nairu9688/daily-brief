import type { NextConfig } from 'next';

/**
 * Les paquets internes exportent leur TypeScript source : Next les transpile. Les en-têtes fixes sont
 * posés ici ; la CSP, qui porte un nonce par requête, est posée par proxy.ts.
 */
const config: NextConfig = {
  transpilePackages: ['@daily-brief/schema', '@daily-brief/maps'],
  poweredByHeader: false,
  reactStrictMode: true,
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), payment=()' },
        ],
      },
    ];
  },
};

export default config;
