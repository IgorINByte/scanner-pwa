import type { Corners, Point } from '../types'

export const dist = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y)

export function fullFrame(w: number, h: number): Corners {
  return [
    { x: 0, y: 0 },
    { x: w, y: 0 },
    { x: w, y: h },
    { x: 0, y: h },
  ]
}

export function isFullFrame(c: Corners, w: number, h: number) {
  const f = fullFrame(w, h)
  return c.every((p, i) => Math.abs(p.x - f[i].x) < 1 && Math.abs(p.y - f[i].y) < 1)
}

/** Orders 4 points clockwise (screen coordinates) starting at the top-left: TL, TR, BR, BL. */
export function orderCorners(pts: Point[]): Corners {
  const cx = pts.reduce((s, p) => s + p.x, 0) / pts.length
  const cy = pts.reduce((s, p) => s + p.y, 0) / pts.length
  const sorted = [...pts].sort((a, b) => Math.atan2(a.y - cy, a.x - cx) - Math.atan2(b.y - cy, b.x - cx))
  let start = 0
  sorted.forEach((p, i) => {
    if (p.x + p.y < sorted[start].x + sorted[start].y) start = i
  })
  return [0, 1, 2, 3].map((i) => sorted[(start + i) % 4]) as Corners
}

export function scaleCorners(c: Corners, s: number): Corners {
  return c.map((p) => ({ x: p.x * s, y: p.y * s })) as Corners
}

/** How far a corner may lie outside the image, as a fraction of its width/height (crop editor). */
export const CORNER_MARGIN = 0.05

/** Clamps a point to the image grown by CORNER_MARGIN on every side. */
export function clampToMargin(p: Point, w: number, h: number): Point {
  return {
    x: Math.min(w * (1 + CORNER_MARGIN), Math.max(-w * CORNER_MARGIN, p.x)),
    y: Math.min(h * (1 + CORNER_MARGIN), Math.max(-h * CORNER_MARGIN, p.y)),
  }
}

const insideMargin = (p: Point, w: number, h: number) => {
  const q = clampToMargin(p, w, h)
  return Math.abs(q.x - p.x) < 1e-9 && Math.abs(q.y - p.y) < 1e-9
}

/** Intersection of line a1-a2 with line b1-b2, or null if they are (nearly) parallel. */
function intersect(a1: Point, a2: Point, b1: Point, b2: Point): Point | null {
  const d = (a2.x - a1.x) * (b2.y - b1.y) - (a2.y - a1.y) * (b2.x - b1.x)
  const la = Math.hypot(a2.x - a1.x, a2.y - a1.y)
  const lb = Math.hypot(b2.x - b1.x, b2.y - b1.y)
  if (Math.abs(d) < 1e-3 * la * lb) return null
  const t = ((b1.x - a1.x) * (b2.y - b1.y) - (b1.y - a1.y) * (b2.x - b1.x)) / d
  return { x: a1.x + t * (a2.x - a1.x), y: a1.y + t * (a2.y - a1.y) }
}

/** Midpoint of side i (top, right, bottom, left = corners i and i+1). */
export const sideMidpoint = (c: Corners, i: number): Point => {
  const a = c[i]
  const b = c[(i + 1) % 4]
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
}

function shiftSide(c: Corners, i: number, t: number): Corners {
  const a = c[i]
  const b = c[(i + 1) % 4]
  const len = Math.hypot(b.x - a.x, b.y - a.y) || 1
  const n = { x: -(b.y - a.y) / len, y: (b.x - a.x) / len }
  const a2 = { x: a.x + n.x * t, y: a.y + n.y * t }
  const b2 = { x: b.x + n.x * t, y: b.y + n.y * t }
  // The moved side's ends slide along the neighbouring sides, so those keep their direction.
  const prev = c[(i + 3) % 4]
  const next = c[(i + 2) % 4]
  const out = [...c] as Corners
  out[i] = intersect(a2, b2, prev, a) ?? a2
  out[(i + 1) % 4] = intersect(a2, b2, b, next) ?? b2
  return out
}

/**
 * Moves side i parallel to itself by the part of `delta` across the side. The side's ends
 * slide along the neighbouring sides; the move is shortened so no corner leaves the margin.
 */
export function moveSide(c: Corners, i: number, delta: Point, w: number, h: number): Corners {
  const a = c[i]
  const b = c[(i + 1) % 4]
  const len = Math.hypot(b.x - a.x, b.y - a.y) || 1
  const t = (delta.x * -(b.y - a.y) + delta.y * (b.x - a.x)) / len
  const ok = (q: Corners) => q.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y) && insideMargin(p, w, h))
  const full = shiftSide(c, i, t)
  if (ok(full)) return full
  let lo = 0
  let hi = 1
  for (let k = 0; k < 24; k++) {
    const mid = (lo + hi) / 2
    if (ok(shiftSide(c, i, t * mid))) lo = mid
    else hi = mid
  }
  return lo > 0 ? shiftSide(c, i, t * lo) : c
}
