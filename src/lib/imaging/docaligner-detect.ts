// ML corner detector: DocAligner lcnet100 heatmap model (DocsaidLab, Apache-2.0), run with
// onnxruntime-web (wasm, 1 thread). The model is self-hosted under public/docaligner/ and the
// ORT wasm is emitted by Vite into assets/; both are precached, never fetched from a CDN.
// Runs wherever it is called from: normally inside the detection worker.
import * as ort from 'onnxruntime-web/wasm'
import ortWasmUrl from 'onnxruntime-web/ort-wasm-simd-threaded.wasm?url'
import type { Corners, Point } from '../../types'
import { orderCorners } from '../geometry'

const INPUT = 256
/** Heatmap value a corner blob must reach (DocAligner's default). */
const HEAT_THRESHOLD = 0.3

ort.env.wasm.wasmPaths = { wasm: ortWasmUrl }
ort.env.wasm.numThreads = 1

/** Absolute URL of the self-hosted model (works under the /scanner-pwa/ base). */
const modelUrl = () => new URL(`${import.meta.env.BASE_URL}docaligner/lcnet100_h_e_bifpn_256_fp32.onnx`, self.location.href).href

let session: Promise<ort.InferenceSession> | null = null

function getSession() {
  session ??= (async () => {
    const res = await fetch(modelUrl())
    if (!res.ok) throw new Error(`Corner model download failed (${res.status})`)
    return ort.InferenceSession.create(new Uint8Array(await res.arrayBuffer()), { executionProviders: ['wasm'], graphOptimizationLevel: 'all' })
  })()
  session.catch(() => (session = null))
  return session
}

/** Fetches and compiles the model and runtime ahead of the first scan. */
export async function initModel(): Promise<void> {
  await getSession()
}

export interface ModelResult {
  /** Corners in the source's pixels, ordered TL, TR, BR, BL. */
  corners: Corners
  /** Mean heatmap peak of the four corners, 0..1. */
  score: number
  /** All four corner blobs were found. */
  success: boolean
}

/**
 * DocAligner's heatmap decode: for each of the 4 channels (hw x hw), the centroid of the
 * largest 4-connected blob >= HEAT_THRESHOLD, normalised to 0..1. Null if a corner is missing.
 */
export function decodeHeatmaps(data: Float32Array, hw: number): { points: Point[]; score: number } | null {
  const n = hw * hw
  const seen = new Uint8Array(n)
  const stack: number[] = []
  const points: Point[] = []
  let score = 0
  for (let c = 0; c < 4; c++) {
    const off = c * n
    seen.fill(0)
    let best = { size: 0, sx: 0, sy: 0 }
    let peak = 0
    for (let i = 0; i < n; i++) {
      const v = data[off + i]
      if (v > peak) peak = v
      if (seen[i] || v < HEAT_THRESHOLD) continue
      let size = 0
      let sx = 0
      let sy = 0
      seen[i] = 1
      stack.push(i)
      while (stack.length) {
        const q = stack.pop()!
        const x = q % hw
        const y = (q - x) / hw
        size++
        sx += x
        sy += y
        const visit = (r: number) => {
          if (!seen[r] && data[off + r] >= HEAT_THRESHOLD) {
            seen[r] = 1
            stack.push(r)
          }
        }
        if (x > 0) visit(q - 1)
        if (x < hw - 1) visit(q + 1)
        if (y > 0) visit(q - hw)
        if (y < hw - 1) visit(q + hw)
      }
      if (size > best.size) best = { size, sx, sy }
    }
    if (!best.size) return null
    points.push({ x: (best.sx / best.size + 0.5) / hw, y: (best.sy / best.size + 0.5) / hw })
    score += peak / 4
  }
  return { points, score }
}

/** 256 x 256 stretched copy as NCHW BGR in 0..1 (the model was trained on OpenCV images). */
function toTensor(image: ImageBitmap): ort.Tensor {
  const canvas = new OffscreenCanvas(INPUT, INPUT)
  let px: Uint8ClampedArray
  try {
    const ctx = canvas.getContext('2d', { willReadFrequently: true })!
    ctx.imageSmoothingQuality = 'high'
    ctx.drawImage(image, 0, 0, INPUT, INPUT)
    px = ctx.getImageData(0, 0, INPUT, INPUT).data
  } finally {
    // Release the backing store right away (Safari keeps canvas memory until resized).
    canvas.width = canvas.height = 1
  }
  const n = INPUT * INPUT
  const f = new Float32Array(n * 3)
  for (let p = 0; p < n; p++) {
    f[p] = px[p * 4 + 2] / 255
    f[n + p] = px[p * 4 + 1] / 255
    f[2 * n + p] = px[p * 4] / 255
  }
  return new ort.Tensor('float32', f, [1, 3, INPUT, INPUT])
}

/** Runs the model; returns null if it found no complete set of corners. */
export async function detectWithModel(image: ImageBitmap): Promise<ModelResult | null> {
  const s = await getSession()
  const input = toTensor(image)
  const out = await s.run({ [s.inputNames[0]]: input })
  input.dispose()
  const heat = out[s.outputNames[0]]
  const r = decodeHeatmaps(heat.data as Float32Array, heat.dims[3])
  for (const t of Object.values(out)) t.dispose()
  if (!r) return null
  const corners = orderCorners(r.points.map((p) => ({ x: p.x * image.width, y: p.y * image.height })))
  return { corners, score: r.score, success: true }
}
