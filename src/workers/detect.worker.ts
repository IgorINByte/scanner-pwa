/// <reference lib="webworker" />
// Document detection worker: owns the ML model (scanic) and the OpenCV.js instance, so
// model inference, the ~11 MB OpenCV module and all pixel work stay off the UI thread.
import { decodeForDetection, detectBitmap, type DetectOptions } from '../lib/imaging/detect-run'
import { initModel } from '../lib/imaging/ml-detect'
import { OPENCV_URL, whenCvReady, type CV } from '../lib/opencv'

export type DetectWorkerRequest =
  | { type: 'load' }
  | {
      type: 'detect'
      id: number
      /** A stored source image, or a frame/bitmap transferred from the main thread. */
      source: Blob | ImageBitmap
      srcWidth: number
      srcHeight: number
      side?: number
      /** Test hooks (fixture page). */
      opts?: DetectOptions
    }

export type DetectWorkerResponse =
  | { type: 'status'; status: 'loading' | 'ready' | 'error'; error?: string }
  | { type: 'result'; id: number; result: import('../lib/imaging/detect-run').DetectResult }
  | { type: 'error'; id: number; error: string }

const post = (m: DetectWorkerResponse) => self.postMessage(m)
let cvPromise: Promise<CV> | null = null

function loadCv(): Promise<CV> {
  if (cvPromise) return cvPromise
  post({ type: 'status', status: 'loading' })
  cvPromise = (async () => {
    const res = await fetch(OPENCV_URL)
    if (!res.ok) throw new Error(`OpenCV download failed (${res.status})`)
    // Module workers cannot importScripts(); evaluate the UMD build in global scope, where
    // it assigns self.cv.
    ;(0, eval)(await res.text())
    const mod = (self as unknown as { cv?: CV }).cv
    if (!mod) throw new Error('OpenCV did not initialise')
    return whenCvReady(mod)
  })()
  cvPromise.then(
    () => post({ type: 'status', status: 'ready' }),
    (e) => {
      cvPromise = null
      post({ type: 'status', status: 'error', error: e instanceof Error ? e.message : String(e) })
    },
  )
  return cvPromise
}

const createCanvas = (w: number, h: number) => new OffscreenCanvas(w, h)

self.onmessage = async (e: MessageEvent<DetectWorkerRequest>) => {
  const msg = e.data
  if (msg.type === 'load') {
    void initModel().catch((e) => console.warn('ML detector failed to load', e))
    void loadCv().catch(() => {})
    return
  }
  let bitmap: ImageBitmap | null = null
  try {
    bitmap = msg.source instanceof Blob ? await decodeForDetection(msg.source, msg.srcWidth, msg.srcHeight) : msg.source
    const result = await detectBitmap(loadCv, bitmap, msg.srcWidth, msg.srcHeight, createCanvas, msg.side, msg.opts)
    post({ type: 'result', id: msg.id, result })
  } catch (err) {
    post({ type: 'error', id: msg.id, error: err instanceof Error ? err.message : String(err) })
  } finally {
    bitmap?.close()
  }
}
