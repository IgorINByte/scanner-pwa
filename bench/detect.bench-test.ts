// Node benchmark for corner detection: runs detect-core on every image in test-images/
// that has ground truth and prints the same metrics as the browser harness.
//   npm run bench                 print results
//   BENCH_OUT=label npm run bench also append a section to docs/detection-benchmark.md
import { appendFileSync, existsSync, readFileSync, readdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import sharp from 'sharp'
import { expect, it } from 'vitest'
import { detectInImage, workingSize } from '../src/lib/imaging/detect-core'
import { scoreDetection, summarize, toMarkdown, type GroundTruth, type ImageScore } from '../src/lib/imaging/quad-metrics'
import { whenCvReady } from '../src/lib/opencv'

const ROOT = join(import.meta.dirname, '..')
const IMAGES = join(ROOT, 'test-images')
const GT_FILE = join(IMAGES, 'ground-truth.json')
const INPUT_MAX_SIDE = 4500

it('detection benchmark', async () => {
  if (!existsSync(GT_FILE)) {
    console.warn('No test-images/ground-truth.json yet — label images in the harness first (npm run dev, /harness.html).')
    return
  }
  const gt: GroundTruth = JSON.parse(readFileSync(GT_FILE, 'utf8'))
  // Loaded with require(): letting Vite transform the 11 MB UMD build hangs the run.
  const cv = await whenCvReady(createRequire(import.meta.url)('@techstark/opencv-js'))
  const files = readdirSync(IMAGES).filter((f) => f in gt.images)
  const scores: ImageScore[] = []
  for (const file of files) {
    // Same geometry as the app: oriented, capped at 4500 px, then scaled to the working size.
    const meta = await sharp(join(IMAGES, file)).rotate().toBuffer({ resolveWithObject: true })
    const ow = meta.info.width
    const oh = meta.info.height
    const s = Math.min(1, INPUT_MAX_SIDE / Math.max(ow, oh))
    const sw = Math.round(ow * s)
    const sh = Math.round(oh * s)
    const ws = workingSize(sw, sh)
    const { data, info } = await sharp(meta.data).resize(ws.width, ws.height, { fit: 'fill' }).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
    const img = { data: new Uint8ClampedArray(data.buffer, data.byteOffset, data.length), width: info.width, height: info.height }
    const t0 = performance.now()
    const r = detectInImage(cv, img)
    const ms = performance.now() - t0
    scores.push(scoreDetection(file, gt.images[file].corners, { ...r, ms }, info.width, info.height))
  }
  const label = process.env.BENCH_OUT
  const md = toMarkdown(scores, label ?? 'Node benchmark')
  console.log('\n' + md)
  if (label) appendFileSync(join(ROOT, 'docs', 'detection-benchmark.md'), '\n' + md)
  expect(summarize(scores).n).toBe(files.length)
})
