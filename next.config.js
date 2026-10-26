/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
<<<<<<< HEAD
  // pdfkit reads its font files at runtime and geotiff ships worker code; keep both out of the server bundle.
  experimental: { serverComponentsExternalPackages: ['pdfkit', 'geotiff'] },
  async headers() {
    return [
      // The service worker must always be re-checked so a new release reaches installed apps.
      { source: '/sw.js', headers: [{ key: 'Cache-Control', value: 'no-cache, no-store, must-revalidate' }, { key: 'Service-Worker-Allowed', value: '/' }] },
      { source: '/offline.html', headers: [{ key: 'Cache-Control', value: 'no-cache' }] },
    ]
  },
=======
>>>>>>> a060b8ffeee783089b8a5367755aa94cb1169895
}

module.exports = nextConfig
