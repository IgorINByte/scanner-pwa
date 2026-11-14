// DocAligner lcnet050 point-regression model (DocsaidLab, Apache-2.0), used only by the live
// preview benchmark. Self-hosted under public/docaligner-dev/ (not precached: it is fetched
// only when the developer option is on). Outputs: `points` (4 x normalised x,y) and `has_obj`.
import * as ort from 'onnxruntime-web/wasm'
import ortWasmUrl from 'onnxruntime-web/ort-wasm-simd-threaded.wasm?url'
import type { Corners } from '../../types'
import { orderCorners } from '../geometry'

const INPUT = 256

ort.env.wasm.wasmPaths = { wasm: ortWasmUrl }
ort.env.wasm.numThreads = 1

const modelUrl = () =>
  new URL(`${import.meta.env.BASE_URL}docaligner-dev/lcnet050_p_multi_decoder_l3_d64_256_fp32.onnx`, self.location.href).href

let session: Promise<ort.InferenceSession> | null = null

function getSession() {
  session ??= (async () => {
    const res = await fetch(modelUrl())
    if (!res.ok) throw new Error(`lcnet050 download failed (${res.status})`)
    return ort.InferenceSession.create(new Uint8Array(await res.arrayBuffer()), { executionProviders: ['wasm'], graphOptimizationLevel: 'all' })
  })()
  session.catch(() => (session = null))
  return session
}

export const initLcnet050 = () => getSession().then(() => undefined)

/** Pixels (any size) -> 256 x 256 NCHW BGR 0..1, the model's training layout. */
function toTensor(px: Uint8ClampedArray, w: number, h: number): ort.Tensor {
  const n = INPUT * INPUT
  const f = new Float32Array(n * 3)
  for (let y = 0; y < INPUT; y++) {
    const sy = Math.min(h - 1, Math.floor(((y + 0.5) * h) / INPUT))
    for (let x = 0; x < INPUT; x++) {
      const sx = Math.min(w - 1, Math.floor(((x + 0.5) * w) / INPUT))
      const i = (sy * w + sx) * 4
      const p = y * INPUT + x
      f[p] = px[i + 2] / 255
      f[n + p] = px[i + 1] / 255
      f[2 * n + p] = px[i] / 255
    }
  }
  return new ort.Tensor('float32', f, [1, 3, INPUT, INPUT])
}

/** Corners in the frame's pixels, or null when the model reports no document. */
export async function runLcnet050(px: Uint8ClampedArray, w: number, h: number): Promise<{ corners: Corners; score: number } | null> {
  const s = await getSession()
  const input = toTensor(px, w, h)
  const out = await s.run({ [s.inputNames[0]]: input })
  input.dispose()
  const points = (out.points ?? Object.values(out).find((t) => t.size === 8))!.data as Float32Array
  const hasObj = (out.has_obj ?? Object.values(out).find((t) => t.size === 1))?.data as Float32Array | undefined
  const score = hasObj ? hasObj[0] : 1
  const pts = [0, 1, 2, 3].map((i) => ({ x: points[i * 2] * w, y: points[i * 2 + 1] * h }))
  for (const t of Object.values(out)) t.dispose()
  if (score <= 0.5) return null
  return { corners: orderCorners(pts), score }
}
