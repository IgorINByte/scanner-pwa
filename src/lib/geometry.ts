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
