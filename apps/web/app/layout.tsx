import type { Metadata, Viewport } from 'next';
import { GeistMono } from 'geist/font/mono';
import { GeistSans } from 'geist/font/sans';
import { headers } from 'next/headers';
import type { ReactNode } from 'react';
import './globals.css';

export const metadata: Metadata = {
  title: 'Daily Brief',
  description: 'Briefing d’actualité quotidien, privé.',
  applicationName: 'Daily Brief',
  appleWebApp: { capable: true, title: 'Daily Brief', statusBarStyle: 'black-translucent' },
  icons: { icon: '/icons/icon.svg', apple: '/icons/apple-touch-icon.png' },
  robots: { index: false, follow: false },
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#F4F4F1' },
    { media: '(prefers-color-scheme: dark)', color: '#0B0B0C' },
  ],
};

/**
 * Racine : polices Geist auto-hébergées (paquet `geist`, construit sur next/font/local, aucune
 * police servie par un CDN). Lire les en-têtes rend toutes les pages dynamiques : Next y applique
 * le nonce de la CSP posée par proxy.ts, et aucune donnée privée n'est figée au build.
 */
export default async function RootLayout({ children }: { children: ReactNode }) {
  await headers();
  return (
    <html lang="fr" className={`${GeistSans.variable} ${GeistMono.variable}`}>
      <body>{children}</body>
    </html>
  );
}
