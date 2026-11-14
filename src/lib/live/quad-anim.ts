// One animation step of the live frame overlay (pure, testable): maps the tracked corners
// from live-frame pixels onto an object-fit: cover <video>, glides toward them and fades.
import type { Point } from '../../types'
import type { LiveTarget } from './live-controller'

/** Corners glide toward each new detection with this time constant (ms), at least. */
const MIN_SMOOTH_MS = 80
const FADE_MS = 180

export interface QuadView {
  /** Video element size on screen. */
  width: number
  height: number
  /** Intrinsic video size. */
  videoWidth: number
  videoHeight: number
}

export interface QuadState {
  points: Point[] | null
  opacity: number
}

/** Live-frame point -> on-screen point for object-fit: cover. */
export function toScreen(p: Point, frameWidth: number, v: QuadView): Point {
  const s = Math.max(v.width / v.videoWidth, v.height / v.videoHeight)
  const ox = (v.width - v.videoWidth * s) / 2
  const oy = (v.height - v.videoHeight * s) / 2
  const k = (v.videoWidth / frameWidth) * s
  return { x: ox + p.x * k, y: oy + p.y * k }
}

export function stepQuad(prev: QuadState, target: LiveTarget, view: QuadView, dt: number, intervalMs: number): QuadState {
  let points = prev.points
  const { corners, frame } = target
  if (corners && frame) {
    const goal = corners.map((p) => toScreen(p, frame.width, view))
    // Reappearing after a fade-out: start at the new place instead of sliding across.
    if (!points || prev.opacity < 0.05) points = goal
    else {
      const a = 1 - Math.exp(-dt / Math.max(MIN_SMOOTH_MS, intervalMs * 0.8))
      points = points.map((p, i) => ({ x: p.x + (goal[i].x - p.x) * a, y: p.y + (goal[i].y - p.y) * a }))
    }
  }
  const want = corners ? 1 : 0
  const opacity = prev.opacity + (want - prev.opacity) * (1 - Math.exp(-dt / FADE_MS))
  return { points, opacity }
}
