// Live document tracking on the camera preview, always on while the camera is live (no
// developer option involved). Each step copies the video onto a small canvas (the GPU scales
// it; the full 12 MP frame is never copied) and hands it to the live worker (scanic LEAN).
// The loop itself lives in LiveController; this hook wires it to the page.
import { useEffect, useRef, useState } from 'react'
import { LiveController, MAX_RATE, type LiveStats, type LiveTarget } from './live-controller'
import type { Hint, Rgb } from './tracking'

export type { LiveStats, LiveTarget } from './live-controller'

/** Long side of the frame sent to the model. */
export const LIVE_SIDE = 256

interface Options {
  /** Auto-shutter enabled. */
  auto: boolean
  /** Called when the tracker decides an auto shot should be taken. */
  onAutoShot: () => void
}

/** Mean colour of a small canvas; undefined if pixels cannot be read (settling then goes by time). */
function meanColor(src: HTMLCanvasElement, tiny: HTMLCanvasElement): Rgb | undefined {
  try {
    const ctx = tiny.getContext('2d', { willReadFrequently: true })
    if (!ctx) return undefined
    ctx.drawImage(src, 0, 0, tiny.width, tiny.height)
    const d = ctx.getImageData(0, 0, tiny.width, tiny.height).data
    const sum: Rgb = [0, 0, 0]
    for (let i = 0; i < d.length; i += 4) {
      sum[0] += d[i]
      sum[1] += d[i + 1]
      sum[2] += d[i + 2]
    }
    const n = d.length / 4
    return [sum[0] / n, sum[1] / n, sum[2] / n]
  } catch {
    return undefined
  }
}

export function useLiveTracking(video: React.RefObject<HTMLVideoElement | null>, active: boolean, opts: Options) {
  const target = useRef<LiveTarget>({ corners: null, frame: null })
  const stats = useRef<LiveStats>({ status: 'loading', fps: 0, inferMs: 0, totalMs: 0, intervalMs: 1000 / MAX_RATE })
  const controller = useRef<LiveController | null>(null)
  const onAutoShot = useRef(opts.onAutoShot)
  onAutoShot.current = opts.onAutoShot
  const auto = useRef(opts.auto)
  auto.current = opts.auto
  const [hint, setHint] = useState<Hint | null>(null)
  const [present, setPresent] = useState(false)

  useEffect(() => {
    if (!active) return
    let worker: Worker
    try {
      worker = new Worker(new URL('../../workers/live.worker.ts', import.meta.url), { type: 'module' })
    } catch (e) {
      console.warn('[live] worker unavailable', e)
      stats.current = { ...stats.current, status: 'error', error: 'Live tracking unavailable' }
      return
    }
    worker.onerror = (e) => {
      console.warn('[live] worker error', e.message)
      stats.current = { ...stats.current, status: 'error', error: e.message || 'Worker error' }
    }
    const canvas = document.createElement('canvas')
    const tiny = document.createElement('canvas')
    tiny.width = tiny.height = 16

    const c = new LiveController(
      {
        worker,
        async grab() {
          const v = video.current
          if (!v || !v.videoWidth) return null
          const k = LIVE_SIDE / Math.max(v.videoWidth, v.videoHeight)
          canvas.width = Math.round(v.videoWidth * k)
          canvas.height = Math.round(v.videoHeight * k)
          canvas.getContext('2d')!.drawImage(v, 0, 0, canvas.width, canvas.height)
          const color = meanColor(canvas, tiny)
          const frame = await createImageBitmap(canvas)
          return { frame, color, source: { width: v.videoWidth, height: v.videoHeight } }
        },
        now: () => performance.now(),
        hidden: () => document.hidden,
        setTimeout: (fn, ms) => window.setTimeout(fn, ms),
        clearTimeout: (id) => window.clearTimeout(id),
        log: (msg, err) => console.warn(msg, err ?? ''),
      },
      {
        onState: (h, p) => {
          setHint(h)
          setPresent(p)
        },
        onAutoShot: () => onAutoShot.current(),
        autoShot: () => auto.current,
      },
    )
    controller.current = c
    // The overlay and the developer readout read these refs.
    target.current = c.target
    const sync = window.setInterval(() => (stats.current = c.stats), 100)
    const onVisibility = () => c.setHidden(document.hidden)
    document.addEventListener('visibilitychange', onVisibility)

    return () => {
      document.removeEventListener('visibilitychange', onVisibility)
      clearInterval(sync)
      c.stop()
      controller.current = null
      canvas.width = canvas.height = 1
      tiny.width = tiny.height = 1
    }
  }, [video, active])

  /** Marks a manual shot so the same placement is not auto-shot again. */
  const shot = () => controller.current?.tracker.shot()

  return { target, stats, hint, present, shot }
}
