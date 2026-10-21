// Copies the OpenCV.js build into /public so it can be lazy-loaded with a <script> tag
// and precached by the service worker (it is never part of the main JS bundle).
import { copyFileSync, mkdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'

const require = createRequire(import.meta.url)
const src = join(dirname(require.resolve('@techstark/opencv-js/package.json')), 'dist', 'opencv.js')
const destDir = join(import.meta.dirname, '..', 'public', 'vendor')
mkdirSync(destDir, { recursive: true })
copyFileSync(src, join(destDir, 'opencv.js'))
console.log('Copied opencv.js -> public/vendor/opencv.js')
