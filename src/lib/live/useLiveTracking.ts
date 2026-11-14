// Live document tracking on the camera preview. Each step copies the video onto a small
// canvas (the GPU scales it; the full 12 MP frame is never copied), hands it to the live
// worker (scanic LEAN) and waits for the answer before the next step. At most MAX_RATE
// detections per second; on a slow phone the rate is lowered instead of starving the preview.
// Stops while the page is hidden (app in background, screen locked).
import { useEffect, useRef, useState } from 'react'
import type { Corners } from '../../types'
import type { LiveRequest, LiveResponse } from '../../workers/live.worker'
import { Tracker, type Frame, type Hint } from './tracking'

/** Long side of the frame sent to the model. */
export const LIVE_SIDE = 256
const MAX_RATE = 15
/** Below this rate the phone counts as slow and the interval is stretched. */
const SLOW_RATE = 5
const MAX_INTERVAL_MS = 1000

export interface LiveTarget {
  /** Latest tracked corners in frame pixels (null: no paper). */
  corners: Corners | null
  frame: Frame | null
}

export interface LiveStats {
  status: 'loading' | 'running' | 'paused' | 'error'
  error?: string
  loadMs?: number
  /** Detections in the last second. */
  fps: number
  /** Mean model time in the worker, ms. */
  inferMs: number
  /** Mean grab + transfer + model + reply, ms. */
  totalMs: number
  /** Current pause between detection starts, ms. */
  intervalMs: number
}

interface Options {
  /** Auto-shutter enabled. */
  auto: boolean
  /** Called when the tracker decides an auto shot should be taken. */
  onAutoShot: () => void
}

export function useLiveTracking(video: React.RefObject<HTMLVideoElement | null>, active: boolean, opts: Options) {
  const target = useRef<LiveTarget>({ corners: null, frame: null })
  const stats = useRef<LiveStats>({ status: 'loading', fps: 0, inferMs: 0, totalMs: 0, intervalMs: 1000 / MAX_RATE })
  const tracker = useRef(new Tracker())
  const onAutoShot = useRef(opts.onAutoShot)
  onAutoShot.current = opts.onAutoShot
  const auto = useRef(opts.auto)
  auto.current = opts.auto
  const [hint, setHint] = useState<Hint | null>(null)
  const [present, setPresent] = useState(false)

  useEffect(() => {
    if (!active) return
    let stopped = false
    let busy = false
    let timer = 0
    let startedAt = 0
    let interval = 1000 / MAX_RATE
    const samples: { t: number; infer: number; total: number }[] = []
    const canvas = document.createElement('canvas')
    let worker: Worker
    try {
      worker = new Worker(new URL('../../workers/live.worker.ts', import.meta.url), { type: 'module' })
    } catch {
      stats.current = { ...stats.current, status: 'error', error: 'Live tracking unavailable' }
      return
    }
    const send = (m: LiveRequest, transfer: Transferable[] = []) => worker.postMessage(m, transfer)
    let ready = false

    const clear = () => {
      target.current = { corners: null, frame: null }
      tracker.current.reset()
      setHint(null)
      setPresent(false)
    }

    const schedule = (delay: number) => {
      clearTimeout(timer)
      timer = window.setTimeout(() => void step(), Math.max(0, delay))
    }

    const step = async () => {
      if (stopped || busy || !ready) return
      if (document.hidden) {
        stats.current = { ...stats.current, status: 'paused' }
        return // resumed by visibilitychange
      }
      const v = video.current
      if (!v || !v.videoWidth) return schedule(200)
      busy = true
      const k = LIVE_SIDE / Math.max(v.videoWidth, v.videoHeight)
      canvas.width = Math.round(v.videoWidth * k)
      canvas.height = Math.round(v.videoHeight * k)
      canvas.getContext('2d')!.drawImage(v, 0, 0, canvas.width, canvas.height)
      startedAt = performance.now()
      let frame: ImageBitmap
      try {
        frame = await createImageBitmap(canvas)
      } catch {
        busy = false
        return schedule(500)
      }
      if (stopped) return frame.close()
      send({ type: 'detect', frame }, [frame])
    }

    worker.onmessage = (e: MessageEvent<LiveResponse>) => {
      const m = e.data
      if (stopped) return
      if (m.type === 'ready') {
        ready = true
        stats.current = { ...stats.current, status: 'running', loadMs: m.ms }
        void step()
        return
      }
      busy = false
      if (m.type === 'error') {
        stats.current = { ...stats.current, status: 'error', error: m.error }
        return schedule(1000)
      }
      const now = performance.now()
      const total = now - startedAt
      samples.push({ t: now, infer: m.ms, total })
      while (samples.length && now - samples[0].t > 1000) samples.shift()
      const mean = (f: (x: (typeof samples)[number]) => number) => samples.reduce((a, x) => a + f(x), 0) / samples.length
      const meanTotal = mean((x) => x.total)
      // Slow phone (< SLOW_RATE/s even back to back): leave the main thread room for the preview.
      interval = meanTotal > 1000 / SLOW_RATE ? Math.min(MAX_INTERVAL_MS, meanTotal * 2) : 1000 / MAX_RATE
      stats.current = {
        status: 'running',
        loadMs: stats.current.loadMs,
        fps: samples.length,
        inferMs: mean((x) => x.infer),
        totalMs: meanTotal,
        intervalMs: interval,
      }

      const frame = { width: m.width, height: m.height }
      const out = tracker.current.update(now, m.corners, frame, auto.current)
      target.current = { corners: out.present ? (m.corners ?? target.current.corners) : null, frame }
      setHint(out.hint)
      setPresent(out.present)
      if (out.shoot) onAutoShot.current()
      if (!document.hidden) schedule(interval - total)
    }

    const onVisibility = () => {
      if (document.hidden) {
        clearTimeout(timer)
        clear()
      } else {
        stats.current = { ...stats.current, status: 'running' }
        samples.length = 0
        schedule(0)
      }
    }
    document.addEventListener('visibilitychange', onVisibility)
    send({ type: 'init' })

    return () => {
      stopped = true
      clearTimeout(timer)
      document.removeEventListener('visibilitychange', onVisibility)
      worker.terminate()
      canvas.width = canvas.height = 1
      clear()
    }
  }, [video, active])

  return { target, stats, tracker, hint, present }
}
