import { defineConfig, minimal2023Preset } from '@vite-pwa/assets-generator/config'

// Generates favicon.ico, pwa-64/192/512, maskable-icon-512 (with safe-zone padding)
// and apple-touch-icon-180 from public/favicon.svg. Run: npm run icons
export default defineConfig({
  preset: {
    ...minimal2023Preset,
    maskable: { ...minimal2023Preset.maskable, resizeOptions: { background: '#0f172a' } },
    apple: { ...minimal2023Preset.apple, resizeOptions: { background: '#0f172a' } },
  },
  images: ['public/favicon.svg'],
})
