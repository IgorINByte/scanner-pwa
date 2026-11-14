import { useEffect, useRef } from 'react'
import { stepQuad, type QuadState } from '../lib/live/quad-anim'
import type { LiveStats, LiveTarget } from '../lib/live/useLiveTracking'

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
    let state: QuadState = { points: null, opacity: 0 }

    const tick = (now: number) => {
      raf = requestAnimationFrame(tick)
      const dt = Math.min(100, now - last)
      last = now
      const v = video.current
      if (!v?.videoWidth || !svg.current || !poly.current) return
      const view = { width: v.clientWidth, height: v.clientHeight, videoWidth: v.videoWidth, videoHeight: v.videoHeight }
      state = stepQuad(state, target.current, view, dt, stats.current.intervalMs)
      if (state.points) poly.current.setAttribute('points', state.points.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' '))
      svg.current.style.opacity = state.opacity.toFixed(3)
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
