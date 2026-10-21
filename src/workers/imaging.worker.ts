/// <reference lib="webworker" />
// Heavy pixel processing (perspective warp, filters, adjustments) off the UI thread.
import { renderScan, type CanvasEnv, type RenderRequest } from '../lib/imaging/render-core'

const env: CanvasEnv = {
  create: (w, h) => new OffscreenCanvas(w, h),
  toBlob: (c, type, quality) => (c as OffscreenCanvas).convertToBlob({ type, quality }),
}

self.onmessage = async (e: MessageEvent<{ id: number; req: RenderRequest }>) => {
  const { id, req } = e.data
  try {
    const result = await renderScan(req, env)
    self.postMessage({ id, result })
  } catch (err) {
    self.postMessage({ id, error: err instanceof Error ? err.message : String(err) })
  }
}
