// Main-thread facade for scan rendering. Uses a Web Worker with OffscreenCanvas when the
// browser supports it (Chrome, Safari 16.4+), otherwise runs the same code on the main thread.
import { renderScan, type CanvasEnv, type RenderRequest, type RenderResult } from './render-core'

const domEnv: CanvasEnv = {
  create: (w, h) => {
    const c = document.createElement('canvas')
    c.width = w
    c.height = h
    return c
  },
  toBlob: (c, type, quality) =>
    new Promise((resolve, reject) =>
      (c as HTMLCanvasElement).toBlob((b) => (b ? resolve(b) : reject(new Error('Image encoding failed'))), type, quality),
    ),
}

function supportsWorker() {
  if (typeof Worker === 'undefined' || typeof OffscreenCanvas === 'undefined') return false
  try {
    return !!new OffscreenCanvas(1, 1).getContext('2d')
  } catch {
    return false
  }
}

type Pending = { resolve: (r: RenderResult) => void; reject: (e: Error) => void; req: RenderRequest }

let worker: Worker | null = null
let workerBroken = !supportsWorker()
let nextId = 1
const pending = new Map<number, Pending>()

function getWorker(): Worker | null {
  if (workerBroken) return null
  if (worker) return worker
  try {
    worker = new Worker(new URL('../../workers/imaging.worker.ts', import.meta.url), { type: 'module' })
  } catch {
    workerBroken = true
    return null
  }
  worker.onmessage = (e: MessageEvent<{ id: number; result?: RenderResult; error?: string }>) => {
    const p = pending.get(e.data.id)
    if (!p) return
    pending.delete(e.data.id)
    if (e.data.result) p.resolve(e.data.result)
    else p.reject(new Error(e.data.error ?? 'Processing failed'))
  }
  worker.onerror = (e) => {
    // Worker failed to start (e.g. module workers unsupported): fall back for everything queued.
    console.warn('Imaging worker failed, using main thread', e.message)
    e.preventDefault()
    workerBroken = true
    worker?.terminate()
    worker = null
    const queued = [...pending.values()]
    pending.clear()
    queued.forEach((p) => renderScan(p.req, domEnv).then(p.resolve, p.reject))
  }
  return worker
}

export function renderScanImage(req: RenderRequest): Promise<RenderResult> {
  const w = getWorker()
  if (!w) return renderScan(req, domEnv)
  const id = nextId++
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject, req })
    w.postMessage({ id, req })
  })
}
