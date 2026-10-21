// Copies large runtime assets from node_modules into /public/vendor so they can be
// lazy-loaded at runtime (never part of the main JS bundle) and work offline:
//   opencv.js            edge detection
//   tesseract/           OCR worker + WASM core
//   tessdata/            OCR language models (English, Croatian)
//   fonts/DejaVuSans.ttf Unicode font for PDF text layers / text annotations
//   pdfjs/               pdf.js CMaps, standard fonts and image decoders (WASM)
import { copyFileSync, cpSync, mkdirSync, readdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'

const require = createRequire(import.meta.url)
const pkgDir = (name, from = require) => dirname(from.resolve(`${name}/package.json`))
const out = join(import.meta.dirname, '..', 'public', 'vendor')

function copy(src, destDir, name) {
  mkdirSync(destDir, { recursive: true })
  copyFileSync(src, join(destDir, name))
}

copy(join(pkgDir('@techstark/opencv-js'), 'dist', 'opencv.js'), out, 'opencv.js')

const tesseractDir = pkgDir('tesseract.js')
copy(join(tesseractDir, 'dist', 'worker.min.js'), join(out, 'tesseract'), 'worker.min.js')
// tesseract.js-core is a nested dependency of tesseract.js (version must match).
const coreDir = pkgDir('tesseract.js-core', createRequire(join(tesseractDir, 'package.json')))
for (const f of readdirSync(coreDir)) {
  // *.wasm.js builds embed the WASM binary, so the separate .wasm files are not needed.
  if (/^tesseract-core.*lstm\.wasm\.js$/.test(f)) copy(join(coreDir, f), join(out, 'tesseract'), f)
}

for (const lang of ['eng', 'hrv']) {
  const src = join(pkgDir(`@tesseract.js-data/${lang}`), '4.0.0_best_int', `${lang}.traineddata.gz`)
  copy(src, join(out, 'tessdata'), `${lang}.traineddata.gz`)
}

copy(join(pkgDir('dejavu-fonts-ttf'), 'ttf', 'DejaVuSans.ttf'), join(out, 'fonts'), 'DejaVuSans.ttf')

const pdfjsDir = pkgDir('pdfjs-dist')
for (const d of ['cmaps', 'standard_fonts', 'wasm']) cpSync(join(pdfjsDir, d), join(out, 'pdfjs', d), { recursive: true })

console.log('Vendor assets copied to public/vendor')
