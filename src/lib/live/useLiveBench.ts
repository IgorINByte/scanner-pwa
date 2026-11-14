// Developer benchmark: live corner detection on the camera preview. Each step copies the
// video onto a small canvas (the GPU scales it; the full 12 MP frame is never copied),
// hands it to the live worker and waits for the answer before taking the next frame.
import { useEffect, useRef, useState } from 'react'
import type { Corners } from '../../types'
import type { LiveModel, LiveRequest, LiveResponse } from '../../workers/live.worker'

/** Long side of the frame sent to the model. */
export const LIVE_SIDE = 256

export interface LiveStats {
  model: LiveModel
  status: 'loading' | 'running' | 'paused' | 'error'
  error?: string
  loadMs?: number
  /** Detections per second over the last second. */
  fps: number
  /** Mean model time in the worker, ms. */
  inferMs: number
  /** Mean grab + transfer + model + reply, ms. */
  totalMs: number
  /** Last result, in frame pixels. */
  corners: Corners | null
  frame: { width: number; height: number } | null
}

export function useLiveBench(video: React.RefObject<HTMLVideoElement | null>, model: LiveModel | null, active: boolean) {
  const [stats, setStats] = useState<LiveStats | null>(null)
  const samples = useRef<{ t: number; infer: number; total: number }[]>([])

  useEffect(() => {
    if (!model || !active) return
    let stopped = false
    let raf = 0
    let sentAt = 0
    let loadMs: number | undefined
    const worker = new Worker(new URL('../../workers/live.worker.ts', import.meta.url), { type: 'module' })
    const canvas = document.createElement('canvas')
    const send = (m: LiveRequest, transfer: Transferable[] = []) => worker.postMessage(m, transfer)
    setStats({ model, status: 'loading', fps: 0, inferMs: 0, totalMs: 0, corners: null, frame: null })

    const next = () => {
      raf = requestAnimationFrame(() => void step())
    }

    const step = async () => {
      if (stopped) return
      const v = video.current
      if (document.hidden || !v || !v.videoWidth) {
        setStats((s) => s && { ...s, status: 'paused' })
        samples.current = []
        return next()
      }
      const k = LIVE_SIDE / Math.max(v.videoWidth, v.videoHeight)
      canvas.width = Math.round(v.videoWidth * k)
      canvas.height = Math.round(v.videoHeight * k)
      canvas.getContext('2d')!.drawImage(v, 0, 0, canvas.width, canvas.height)
      sentAt = performance.now()
      const frame = await createImageBitmap(canvas)
      if (stopped) return frame.close()
      send({ type: 'detect', model, frame }, [frame])
    }

    worker.onmessage = (e: MessageEvent<LiveResponse>) => {
      const m = e.data
      if (stopped) return
      if (m.type === 'ready') {
        loadMs = m.ms
        setStats((s) => s && { ...s, status: 'running', loadMs })
        void step()
      } else if (m.type === 'error') {
        setStats((s) => s && { ...s, status: 'error', error: m.error })
      } else {
        const now = performance.now()
        const list = samples.current
        list.push({ t: now, infer: m.ms, total: now - sentAt })
        while (list.length && now - list[0].t > 1000) list.shift()
        const mean = (f: (x: (typeof list)[number]) => number) => list.reduce((a, x) => a + f(x), 0) / list.length
        setStats({
          model,
          status: 'running',
          loadMs,
          fps: list.length,
          inferMs: mean((x) => x.infer),
          totalMs: mean((x) => x.total),
          corners: m.corners,
          frame: { width: m.width, height: m.height },
        })
        next()
      }
    }
    send({ type: 'init', model })

    return () => {
      stopped = true
      cancelAnimationFrame(raf)
      worker.terminate()
      canvas.width = canvas.height = 1
      samples.current = []
      setStats(null)
    }
  }, [video, model, active])

  return stats
}
