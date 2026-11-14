/// <reference lib="webworker" />
// Live preview worker: runs the light scanic LEAN model on a small, already downscaled camera
// frame. One request at a time; the caller waits for the answer before sending the next frame.
// The exact capture-time detection (DocAligner + LEAN on the full frame) is separate.
import type { Corners } from '../types'
import { detectWithModel, initModel } from '../lib/imaging/ml-detect'

export type LiveRequest = { type: 'init' } | { type: 'detect'; frame: ImageBitmap }

export type LiveResponse =
  | { type: 'ready'; ms: number }
  | { type: 'result'; corners: Corners | null; ms: number; width: number; height: number }
  | { type: 'error'; error: string }

const post = (m: LiveResponse) => self.postMessage(m)

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
    const t = performance.now()
    const r = await detectWithModel(frame)
    const width = frame.width
    const height = frame.height
    frame.close()
    post({ type: 'result', corners: r?.success ? r.corners : null, ms: performance.now() - t, width, height })
  } catch (err) {
    if (m.type === 'detect') m.frame.close()
    post({ type: 'error', error: err instanceof Error ? err.message : String(err) })
  }
}
