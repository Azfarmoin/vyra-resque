
/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,

  // Keep these packages out of the server bundle.
  experimental: {
    serverComponentsExternalPackages: ['pdfkit', 'geotiff'],
  },

  async headers() {
    return [
      {
        source: '/sw.js',
        headers: [
          {
            key: 'Cache-Control',
            value: 'no-cache, no-store, must-revalidate',
          },
          {
            key: 'Service-Worker-Allowed',
            value: '/',
          },
        ],
      },
      {
        source: '/offline.html',
        headers: [
          {
            key: 'Cache-Control',
            value: 'no-cache',
          },
        ],
      },
    ];
  },
};

module.exports = nextConfig;
