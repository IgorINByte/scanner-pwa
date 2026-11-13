// Main-thread facade for document detection. All OpenCV work runs in the detection worker;
// the main thread only sends a Blob or a transferred ImageBitmap and gets corners back.
// Browsers without worker OffscreenCanvas fall back to running the same code here.
import type { Corners } from '../../types'
import { getCv, loadOpenCv, setCvStatus } from '../opencv'
import type { DetectionKind } from './detect-core'
import { decodeForDetection, detectBitmap, type DetectionSource, type DetectOptions, type DetectResult } from './detect-run'
import { initModel } from './docaligner-detect'
import { initModel as initLean } from './ml-detect'
import type { DetectWorkerRequest, DetectWorkerResponse } from '../../workers/detect.worker'

export interface Detection {
  corners: Corners
  detection: DetectionKind
  /** Which detector produced the corners: model, classical, or none (full image). */
  source: DetectionSource
  /** 0..1 */
  confidence: number
}

type Pending = { resolve: (r: DetectResult) => void; reject: (e: Error) => void; run: () => Promise<DetectResult> }

function supportsWorker() {
  if (typeof Worker === 'undefined' || typeof OffscreenCanvas === 'undefined') return false
  try {
    return !!new OffscreenCanvas(1, 1).getContext('2d')
  } catch {
    return false
  }
}

let worker: Worker | null = null
let workerBroken = !supportsWorker()
let nextId = 1
const pending = new Map<number, Pending>()

const domCanvas = (w: number, h: number) => {
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  return c
}

const mainThreadCv = async () => {
  await loadOpenCv()
  return getCv()
}

async function detectOnMainThread(source: Blob | ImageBitmap, srcWidth: number, srcHeight: number, side?: number, opts?: DetectOptions) {
  const bitmap = source instanceof Blob ? await decodeForDetection(source, srcWidth, srcHeight) : source
  try {
    return await detectBitmap(mainThreadCv, bitmap, srcWidth, srcHeight, domCanvas, side, opts)
  } finally {
    bitmap.close()
  }
}

function getWorker(): Worker | null {
  if (workerBroken) return null
  if (worker) return worker
  try {
    worker = new Worker(new URL('../../workers/detect.worker.ts', import.meta.url), { type: 'module' })
  } catch {
    workerBroken = true
    return null
  }
  worker.onmessage = (e: MessageEvent<DetectWorkerResponse>) => {
    const m = e.data
    if (m.type === 'status') {
      setCvStatus(m.status)
      return
    }
    const p = pending.get(m.id)
    if (!p) return
    pending.delete(m.id)
    if (m.type === 'result') p.resolve(m.result)
    else p.reject(new Error(m.error))
  }
  worker.onerror = (e) => {
    console.warn('Detection worker failed, using main thread', e.message)
    e.preventDefault()
    workerBroken = true
    worker?.terminate()
    worker = null
    const queued = [...pending.values()]
    pending.clear()
    queued.forEach((p) => p.run().then(p.resolve, p.reject))
  }
  return worker
}

/** Starts loading the ML model and OpenCV ahead of time (and retries after an error). */
export function warmupDetector(): void {
  const w = getWorker()
  if (w) w.postMessage({ type: 'load' } satisfies DetectWorkerRequest)
  else {
    void initModel().catch(() => {})
    void initLean().catch(() => {})
    void loadOpenCv().catch(() => {})
  }
}

/**
 * Detects the document in a source image or frame.
 * A transferred ImageBitmap is consumed (closed) by this call.
 */
export function detect(source: Blob | ImageBitmap, srcWidth: number, srcHeight: number, side?: number, opts?: DetectOptions): Promise<DetectResult> {
  const run = () => detectOnMainThread(source, srcWidth, srcHeight, side, opts)
  const w = getWorker()
  if (!w) return run()
  const id = nextId++
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject, run })
    const msg: DetectWorkerRequest = { type: 'detect', id, source, srcWidth, srcHeight, side, opts }
    w.postMessage(msg, source instanceof ImageBitmap ? [source] : [])
  })
}

export async function detectCorners(source: Blob, width: number, height: number): Promise<Detection> {
  const r = await detect(source, width, height)
  return { corners: r.corners, detection: r.detection, source: r.source, confidence: r.confidence }
}
