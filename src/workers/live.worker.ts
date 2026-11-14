/// <reference lib="webworker" />
// Live preview detection worker (developer benchmark): runs one light corner model on a
// small, already downscaled camera frame. One request at a time; the caller waits for the
// answer before sending the next frame.
import type { Corners } from '../types'
import { initLcnet050, runLcnet050 } from '../lib/live/lcnet050'
import { detectWithModel as runLean, initModel as initLean } from '../lib/imaging/ml-detect'

export type LiveModel = 'lcnet050' | 'lean'

export type LiveRequest =
  | { type: 'init'; model: LiveModel }
  | { type: 'detect'; model: LiveModel; frame: ImageBitmap }

export type LiveResponse =
  | { type: 'ready'; model: LiveModel; ms: number }
  | { type: 'result'; corners: Corners | null; score: number; ms: number; width: number; height: number }
  | { type: 'error'; error: string }

const post = (m: LiveResponse) => self.postMessage(m)
let scratch: OffscreenCanvas | null = null

function pixels(frame: ImageBitmap) {
  scratch ??= new OffscreenCanvas(1, 1)
  scratch.width = frame.width
  scratch.height = frame.height
  const ctx = scratch.getContext('2d', { willReadFrequently: true })!
  ctx.drawImage(frame, 0, 0)
  const px = ctx.getImageData(0, 0, frame.width, frame.height).data
  scratch.width = scratch.height = 1
  return px
}

self.onmessage = async (e: MessageEvent<LiveRequest>) => {
  const m = e.data
  try {
    if (m.type === 'init') {
      const t = performance.now()
      await (m.model === 'lcnet050' ? initLcnet050() : initLean())
      post({ type: 'ready', model: m.model, ms: performance.now() - t })
      return
    }
    const { frame } = m
    const t = performance.now()
    let corners: Corners | null = null
    let score = 0
    if (m.model === 'lcnet050') {
      const r = await runLcnet050(pixels(frame), frame.width, frame.height)
      if (r) ({ corners, score } = r)
    } else {
      const r = await runLean(frame)
      if (r?.success) ({ corners, score } = r)
    }
    const width = frame.width
    const height = frame.height
    frame.close()
    post({ type: 'result', corners, score, ms: performance.now() - t, width, height })
  } catch (err) {
    if (m.type === 'detect') m.frame.close()
    post({ type: 'error', error: err instanceof Error ? err.message : String(err) })
  }
}
