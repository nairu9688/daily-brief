import type { MetadataRoute } from 'next';

/** Manifeste PWA (spec §8.3) : appli installable sur l'écran d'accueil. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    // Identité stable de l'appli installée, indépendante de start_url.
    id: '/',
    name: 'Daily Brief',
    short_name: 'Daily Brief',
    description: 'Briefing d’actualité quotidien, privé.',
    lang: 'fr',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    background_color: '#0B0B0C',
    theme_color: '#0B0B0C',
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
}
