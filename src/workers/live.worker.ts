/// <reference lib="webworker" />
// Live preview worker: runs the light scanic LEAN model on a small, already downscaled camera
// frame. One request at a time; the caller waits for the answer before sending the next frame.
// The exact capture-time detection (DocAligner + LEAN on the full frame) is separate.
import type { Corners } from '../types'
import type { Rgb } from '../lib/live/tracking'
import { detectWithModel, initModel } from '../lib/imaging/ml-detect'

export type LiveRequest = { type: 'init' } | { type: 'detect'; frame: ImageBitmap }

export type LiveResponse =
  | { type: 'ready'; ms: number }
  | { type: 'result'; corners: Corners | null; ms: number; width: number; height: number; color: Rgb }
  | { type: 'error'; error: string }

const post = (m: LiveResponse) => self.postMessage(m)
let tiny: OffscreenCanvas | null = null

/** Mean colour of the frame (16 x 16 average), used to tell when white balance has settled. */
function meanColor(frame: ImageBitmap): Rgb {
  tiny ??= new OffscreenCanvas(16, 16)
  const ctx = tiny.getContext('2d', { willReadFrequently: true })!
  ctx.drawImage(frame, 0, 0, 16, 16)
  const d = ctx.getImageData(0, 0, 16, 16).data
  const sum: Rgb = [0, 0, 0]
  for (let i = 0; i < d.length; i += 4) {
    sum[0] += d[i]
    sum[1] += d[i + 1]
    sum[2] += d[i + 2]
  }
  const n = d.length / 4
  return [sum[0] / n, sum[1] / n, sum[2] / n]
}

self.onmessage = async (e: MessageEvent<LiveRequest>) => {
  const m = e.data
  try {
    if (m.type === 'init') {
      const t = performance.now()
      await initModel()
      post({ type: 'ready', ms: performance.now() - t })
      return
    }
    const { frame } = m
    // Read everything from the bitmap before the model may consume it.
    const width = frame.width
    const height = frame.height
    const color = meanColor(frame)
    const t = performance.now()
    const r = await detectWithModel(frame)
    const ms = performance.now() - t
    frame.close()
    post({ type: 'result', corners: r?.success ? r.corners : null, ms, width, height, color })
  } catch (err) {
    if (m.type === 'detect') m.frame.close()
    post({ type: 'error', error: err instanceof Error ? err.message : String(err) })
  }
}
