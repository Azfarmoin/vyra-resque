import type { MetadataRoute } from 'next'

// Makes VYRA installable (Android Chrome, desktop Chrome/Edge). `start_url` is the report form so an
// installed app opens straight to the thing people need in an emergency, even with no connection.
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: '/report',
    name: 'VYRA: Vulnerability, Yielded Response & Assistance',
    short_name: 'VYRA',
    description: 'Report an emergency, even without internet. Reports are saved on your device and sent when you are back online.',
    start_url: '/report?source=pwa',
    scope: '/',
    display: 'standalone',
    orientation: 'portrait',
    background_color: '#F6F0E7',
    theme_color: '#F6F0E7',
    categories: ['utilities', 'medical'],
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
    shortcuts: [
      { name: 'Report an emergency', url: '/report', icons: [{ src: '/icons/icon-192.png', sizes: '192x192' }] },
      { name: 'Reports on this device', url: '/report/saved', icons: [{ src: '/icons/icon-192.png', sizes: '192x192' }] },
    ],
  }
}
