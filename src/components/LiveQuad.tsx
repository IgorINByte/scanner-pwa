import { useEffect, useRef } from 'react'
import type { LiveStats, LiveTarget } from '../lib/live/useLiveTracking'
import type { Point } from '../types'

/** Corners glide toward each new detection with this time constant (ms), at least. */
const MIN_SMOOTH_MS = 80
const FADE_MS = 180

/**
 * Smoothed live document frame over an object-cover <video>. Runs its own animation loop and
 * writes the SVG directly, so detections never re-render React at 60 fps.
 */
export default function LiveQuad({
  target,
  stats,
  video,
}: {
  target: React.RefObject<LiveTarget>
  stats: React.RefObject<LiveStats>
  video: React.RefObject<HTMLVideoElement | null>
}) {
  const svg = useRef<SVGSVGElement>(null)
  const poly = useRef<SVGPolygonElement>(null)

  useEffect(() => {
    let raf = 0
    let last = performance.now()
    let shown: Point[] | null = null
    let opacity = 0

    const tick = (now: number) => {
      raf = requestAnimationFrame(tick)
      const dt = Math.min(100, now - last)
      last = now
      const v = video.current
      const { corners, frame } = target.current
      if (!v?.videoWidth || !svg.current || !poly.current) return

      // Frame pixels -> element pixels for object-fit: cover.
      const ew = v.clientWidth
      const eh = v.clientHeight
      const s = Math.max(ew / v.videoWidth, eh / v.videoHeight)
      const ox = (ew - v.videoWidth * s) / 2
      const oy = (eh - v.videoHeight * s) / 2

      if (corners && frame) {
        const k = (v.videoWidth / frame.width) * s
        const goal = corners.map((p) => ({ x: ox + p.x * k, y: oy + p.y * k }))
        // Reappearing after a fade-out: start at the new place instead of sliding across.
        if (!shown || opacity < 0.05) shown = goal
        else {
          const a = 1 - Math.exp(-dt / Math.max(MIN_SMOOTH_MS, stats.current.intervalMs * 0.8))
          shown = shown.map((p, i) => ({ x: p.x + (goal[i].x - p.x) * a, y: p.y + (goal[i].y - p.y) * a }))
        }
      }
      const want = corners ? 1 : 0
      opacity += (want - opacity) * (1 - Math.exp(-dt / FADE_MS))
      if (shown) poly.current.setAttribute('points', shown.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' '))
      svg.current.style.opacity = opacity.toFixed(3)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [target, stats, video])

  return (
    <svg ref={svg} className="pointer-events-none absolute inset-0 size-full" style={{ opacity: 0 }} aria-hidden>
      <polygon ref={poly} fill="rgba(34,211,238,0.22)" stroke="rgb(34,211,238)" strokeWidth={2.5} strokeLinejoin="round" />
    </svg>
  )
}
