import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import basicSsl from '@vitejs/plugin-basic-ssl'
import { VitePWA } from 'vite-plugin-pwa'

// GitHub Pages serves the app from https://<user>.github.io/scanner-pwa/
const BASE = '/scanner-pwa/'

export default defineConfig(({ command, isPreview }) => ({
  // Dev server stays at / (handy for phone testing); build and preview use the Pages path.
  base: command === 'build' || isPreview ? BASE : '/',
  plugins: [
    react(),
    tailwindcss(),
    // Self-signed HTTPS for the dev server so the camera works when testing on a phone over LAN.
    command === 'serve' && basicSsl(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg', 'favicon.ico', 'apple-touch-icon-180x180.png'],
      manifest: {
        name: 'Scanner',
        short_name: 'Scanner',
        description: 'Scan documents with your phone. Everything stays on your device.',
        theme_color: '#0f172a',
        background_color: '#0f172a',
        display: 'standalone',
        orientation: 'portrait',
        // Relative to the manifest URL, so they resolve to the base path wherever it is hosted.
        id: './',
        start_url: './',
        scope: './',
        icons: [
          { src: 'pwa-64x64.png', sizes: '64x64', type: 'image/png' },
          { src: 'pwa-192x192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png' },
          { src: 'maskable-icon-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // The app shell and OpenCV.js (~11 MB) are precached, so scanning works fully offline after install.
        globPatterns: ['**/*.{js,mjs,css,html,svg,png,ico,webmanifest}'],
        // OCR engine/models, fonts and pdf.js data are only downloaded when first used,
        // then kept in a runtime cache for offline use.
        globIgnores: ['vendor/tesseract/**', 'vendor/tessdata/**', 'vendor/fonts/**', 'vendor/pdfjs/**'],
        maximumFileSizeToCacheInBytes: 16 * 1024 * 1024,
        runtimeCaching: [
          {
            urlPattern: ({ url }) => /\/vendor\/(tesseract|tessdata|fonts|pdfjs)\//.test(url.pathname),
            handler: 'CacheFirst',
            options: {
              cacheName: 'on-demand-assets',
              expiration: { maxEntries: 400 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
      },
    }),
  ],
  server: { host: true },
}))
