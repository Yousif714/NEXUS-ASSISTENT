import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Nexus Assistent',
    short_name: 'Nexus',
    description: 'Persönlicher Assistent für NEXUS und den Zulassungsdienst',
    lang: 'de',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    background_color: '#0f131b',
    theme_color: '#f6f6f7',
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
}
