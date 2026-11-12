// Snaps a rough quadrilateral (from the ML model) onto the real paper edges.
// Each side is refined on its own: sample points along the side, look for the strongest
// brightness step perpendicular to it, fit a robust line through the hits (RANSAC, so
// spiral holes/wire and stray text do not pull the line), and intersect adjacent lines.
// A side without a clear step is searched again in a wider band, taking the outermost line
// that most samples agree on (spiral wire, holes, ruling and text lie inside the paper
// edge); if that fails too, the side keeps the model's line.
import type { Corners, Point } from '../../types'

export interface GrayImage {
  data: Uint8Array
  width: number
  height: number
}

/** Long side of the image the refinement runs on. */
export const REFINE_SIZE = 1600

/** Corners may lie this far outside the image (fraction of width/height). */
export const OUTSIDE_MARGIN = 0.05

/** Minimum quad area as a fraction of the image area. */
export const MIN_AREA_RATIO = 0.03

const SAMPLES = 48
/** Search distance on each side of the model's edge, as a fraction of the long image side. */
const SEARCH = 0.035
/** Second, wider search for a side that did not snap (fraction of the long image side). */
const SEARCH_WIDE = 0.12
/** Wide search: steps kept per sample and polarity, lines extracted, and their minimum support. */
const MAX_PEAKS = 4
const WIDE_LINES = 4
const WIDE_SHARE = 0.6
/** Minimum brightness step (grey levels, after smoothing) that counts as an edge. */
const MIN_STEP = 6
/** RANSAC inlier distance in px (at REFINE_SIZE). */
const INLIER_PX = 2.5
/** A side is refined only if at least this share of its samples agree on one line. */
const MIN_INLIER_SHARE = 0.35

export function toGray(rgba: Uint8ClampedArray, width: number, height: number): GrayImage {
  const data = new Uint8Array(width * height)
  for (let i = 0, j = 0; j < data.length; i += 4, j++) data[j] = (rgba[i] * 77 + rgba[i + 1] * 150 + rgba[i + 2] * 29) >> 8
  return { data, width, height }
}

/** Bilinear sample at continuous coordinates (pixel i spans [i, i+1], centre at i + 0.5). */
function sample(g: GrayImage, x: number, y: number): number {
  const px = x - 0.5
  const py = y - 0.5
  const x0 = Math.floor(px)
  const y0 = Math.floor(py)
  const ax = px - x0
  const ay = py - y0
  const w = g.width
  const d = g.data
  const i = y0 * w + x0
  return (d[i] * (1 - ax) + d[i + 1] * ax) * (1 - ay) + (d[i + w] * (1 - ax) + d[i + w + 1] * ax) * ay
}

/** Line in normal form: n·p = c, |n| = 1. */
interface Line {
  nx: number
  ny: number
  c: number
}

const lineThrough = (a: Point, b: Point): Line | null => {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const len = Math.hypot(dx, dy)
  if (len < 1e-9) return null
  const nx = -dy / len
  const ny = dx / len
  return { nx, ny, c: nx * a.x + ny * a.y }
}

/** Total least squares line through points. */
function fitLine(pts: Point[]): Line | null {
  const n = pts.length
  if (n < 2) return null
  let mx = 0
  let my = 0
  for (const p of pts) {
    mx += p.x
    my += p.y
  }
  mx /= n
  my /= n
  let sxx = 0
  let syy = 0
  let sxy = 0
  for (const p of pts) {
    const dx = p.x - mx
    const dy = p.y - my
    sxx += dx * dx
    syy += dy * dy
    sxy += dx * dy
  }
  // Direction = principal eigenvector; the normal is perpendicular to it.
  const theta = 0.5 * Math.atan2(2 * sxy, sxx - syy)
  const nx = -Math.sin(theta)
  const ny = Math.cos(theta)
  return { nx, ny, c: nx * mx + ny * my }
}

function intersect(a: Line, b: Line): Point | null {
  const det = a.nx * b.ny - a.ny * b.nx
  if (Math.abs(det) < 1e-9) return null
  return { x: (a.c * b.ny - a.ny * b.c) / det, y: (a.nx * b.c - a.c * b.nx) / det }
}

/** Finds edge points along the side a→b; `inward` is the unit normal pointing into the quad. */
function edgePoints(g: GrayImage, a: Point, b: Point, inward: Point): { pts: Point[]; sampled: number; sign: 1 | -1 } {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const len = Math.hypot(dx, dy)
  const tx = dx / len
  const ty = dy / len
  const r = Math.max(12, Math.round(SEARCH * Math.max(g.width, g.height)))
  const across = 2 // tangential half-width of the averaging strip
  const hits: { p: Point; sign: number }[] = []
  let sampled = 0
  const prof = new Float32Array(2 * r + 1)
  for (let s = 0; s < SAMPLES; s++) {
    // Stay away from the corners, where the neighbouring side interferes.
    const t = 0.08 + (0.84 * s) / (SAMPLES - 1)
    const cx = a.x + dx * t
    const cy = a.y + dy * t
    let inside = true
    for (let k = -r; k <= r && inside; k++) {
      for (const e of [-across, across]) {
        const x = cx + inward.x * k + tx * e
        const y = cy + inward.y * k + ty * e
        if (x < 0.5 || y < 0.5 || x >= g.width - 1.5 || y >= g.height - 1.5) inside = false
      }
    }
    if (!inside) continue
    sampled++
    for (let k = -r; k <= r; k++) {
      let v = 0
      for (let e = -across; e <= across; e++) v += sample(g, cx + inward.x * k + tx * e, cy + inward.y * k + ty * e)
      prof[k + r] = v / (2 * across + 1)
    }
    // Central difference over 2 px; prefer steps close to the model's line.
    let best = -1
    let bestScore = 0
    let bestStep = 0
    let meanAbs = 0
    for (let i = 2; i < prof.length - 2; i++) {
      const step = prof[i + 2] - prof[i - 2]
      meanAbs += Math.abs(step)
      const score = Math.abs(step) * (1 - (0.5 * Math.abs(i - r)) / r)
      if (score > bestScore) {
        bestScore = score
        best = i
        bestStep = step
      }
    }
    meanAbs /= prof.length - 4
    if (best < 0 || Math.abs(bestStep) < MIN_STEP || Math.abs(bestStep) < 2 * meanAbs) continue
    // Sub-pixel peak: parabola through the step magnitudes around the best position.
    let k = best - r
    if (best > 2 && best < prof.length - 3) {
      const m0 = Math.abs(prof[best + 1] - prof[best - 3])
      const m1 = Math.abs(bestStep)
      const m2 = Math.abs(prof[best + 3] - prof[best - 1])
      const den = m0 - 2 * m1 + m2
      if (den < 0) k += Math.max(-0.5, Math.min(0.5, (0.5 * (m0 - m2)) / den))
    }
    hits.push({ p: { x: cx + inward.x * k, y: cy + inward.y * k }, sign: Math.sign(bestStep) })
  }
  // Paper is either brighter or darker than the background along a whole side: keep the
  // majority polarity so holes and text (opposite polarity) drop out early.
  const pos = hits.filter((h) => h.sign > 0).length
  const keep = pos >= hits.length - pos ? 1 : -1
  return { pts: hits.filter((h) => h.sign === keep).map((h) => h.p), sampled, sign: keep }
}

/**
 * Wider search for a side that did not snap: per sample, the MAX_PEAKS outermost steps of
 * each polarity (index 0: brighter inside, 1: darker inside), looking inwards from the
 * background. `s` is the sample index along the side.
 */
function edgeCandidates(g: GrayImage, a: Point, b: Point, inward: Point): { byPolarity: { p: Point; s: number }[][]; sampled: number } {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const len = Math.hypot(dx, dy)
  const tx = dx / len
  const ty = dy / len
  const r = Math.max(24, Math.round(SEARCH_WIDE * Math.max(g.width, g.height)))
  const across = 2
  const byPolarity: { p: Point; s: number }[][] = [[], []]
  let sampled = 0
  const prof = new Float32Array(2 * r + 1)
  for (let s = 0; s < SAMPLES; s++) {
    const t = 0.08 + (0.84 * s) / (SAMPLES - 1)
    const cx = a.x + dx * t
    const cy = a.y + dy * t
    // The outer end of the band may leave the image (a model line far out on the
    // background): start the profile at the first position inside the image.
    const inImage = (k: number) =>
      [-across, across].every((e) => {
        const x = cx + inward.x * k + tx * e
        const y = cy + inward.y * k + ty * e
        return x >= 0.5 && y >= 0.5 && x < g.width - 1.5 && y < g.height - 1.5
      })
    let k0 = -r
    while (k0 < 0 && !inImage(k0)) k0++
    if (!inImage(k0) || !inImage(r)) continue
    sampled++
    for (let k = k0; k <= r; k++) {
      let v = 0
      for (let e = -across; e <= across; e++) v += sample(g, cx + inward.x * k + tx * e, cy + inward.y * k + ty * e)
      prof[k + r] = v / (2 * across + 1)
    }
    const step = (i: number) => prof[i + 2] - prof[i - 2]
    for (const [n, sign] of [[0, 1], [1, -1]] as const) {
      let found = 0
      // Local maxima of the step, from the outside in.
      for (let i = k0 + r + 3; i < prof.length - 3 && found < MAX_PEAKS; i++) {
        const v = sign * step(i)
        if (v < MIN_STEP || v < sign * step(i - 1) || v <= sign * step(i + 1)) continue
        byPolarity[n].push({ p: { x: cx + inward.x * (i - r), y: cy + inward.y * (i - r) }, s })
        found++
      }
    }
  }
  return { byPolarity, sampled }
}

/** `pair` can skip candidate pairs (e.g. points too close together to fix a direction). */
function ransacLine(pts: Point[], pair?: (i: number, j: number) => boolean): { line: Line; inliers: Point[] } | null {
  let best: Point[] = []
  // Few points: trying every pair is cheap and deterministic.
  for (let i = 0; i < pts.length; i++) {
    for (let j = i + 1; j < pts.length; j++) {
      if (pair && !pair(i, j)) continue
      const l = lineThrough(pts[i], pts[j])
      if (!l) continue
      const inl = pts.filter((p) => Math.abs(l.nx * p.x + l.ny * p.y - l.c) <= INLIER_PX)
      if (inl.length > best.length) best = inl
    }
  }
  const line = fitLine(best)
  if (!line) return null
  // One refit pass with the inliers of the least-squares line.
  const inl = pts.filter((p) => Math.abs(line.nx * p.x + line.ny * p.y - line.c) <= INLIER_PX)
  return { line: fitLine(inl) ?? line, inliers: inl }
}

/** Robust line through `pts` if enough samples agree and it stays close to the model's direction. */
function acceptFit(pts: Point[], sampled: number, model: Line): { line: Line; inliers: number } | null {
  const fit = pts.length >= 6 ? ransacLine(pts) : null
  if (!fit || fit.inliers.length < Math.max(6, MIN_INLIER_SHARE * sampled)) return null
  // Reject a fit that turned away from the model's side (e.g. locked onto a text line).
  const cos = Math.abs(fit.line.nx * model.nx + fit.line.ny * model.ny)
  return cos > Math.cos((12 * Math.PI) / 180) ? { line: fit.line, inliers: fit.inliers.length } : null
}

/**
 * Wide retry for one side. Spiral wire, holes, the margin rule and text all give straight
 * runs of steps too, but they lie inside the paper edge: of the lines that most samples
 * agree on, take the outermost. `sign` is the polarity the snapped sides agree on (the
 * paper is brighter or darker than the background all round), so a shadow cannot win;
 * 0 when no side snapped.
 */
function snapSideWide(g: GrayImage, a: Point, b: Point, inward: Point, model: Line, sign: number): Line | null {
  const { byPolarity, sampled } = edgeCandidates(g, a, b, inward)
  const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
  const minCos = Math.cos((12 * Math.PI) / 180)
  let best: { line: Line; depth: number } | null = null
  for (const n of [0, 1]) {
    if (sign !== 0 && sign !== (n === 0 ? 1 : -1)) continue
    let pts = byPolarity[n]
    for (let round = 0; round < WIDE_LINES && pts.length >= 6; round++) {
      const fit = ransacLine(pts.map((c) => c.p), (i, j) => Math.abs(pts[i].s - pts[j].s) >= SAMPLES / 4)
      if (!fit) break
      const { line } = fit
      const near = (c: { p: Point }) => Math.abs(line.nx * c.p.x + line.ny * c.p.y - line.c) <= INLIER_PX
      const support = new Set(pts.filter(near).map((c) => c.s)).size
      pts = pts.filter((c) => !near(c))
      if (support < WIDE_SHARE * sampled || Math.abs(line.nx * model.nx + line.ny * model.ny) <= minCos) continue
      // Distance from the model side's midpoint to the line, positive inwards.
      const dn = line.nx * inward.x + line.ny * inward.y > 0 ? 1 : -1
      const depth = dn * (line.c - line.nx * mid.x - line.ny * mid.y)
      if (!best || depth < best.depth) best = { line, depth }
    }
  }
  return best ? best.line : null
}

export interface RefineResult {
  corners: Corners
  /** Which sides (top, right, bottom, left) were snapped to an image edge. */
  snapped: [boolean, boolean, boolean, boolean]
}

/** Refines `quad` (pixels of `g`) side by side; see the file header. */
export function refineQuad(g: GrayImage, quad: Corners): RefineResult {
  const cx = quad.reduce((s, p) => s + p.x, 0) / 4
  const cy = quad.reduce((s, p) => s + p.y, 0) / 4
  const lines: Line[] = []
  const snapped: [boolean, boolean, boolean, boolean] = [false, false, false, false]
  const inwards: Point[] = []
  let polarity = 0
  for (let i = 0; i < 4; i++) {
    const a = quad[i]
    const b = quad[(i + 1) % 4]
    const model = lineThrough(a, b)
    if (!model) return { corners: quad, snapped }
    // Point the normal towards the quad's centre.
    const sgn = model.nx * cx + model.ny * cy - model.c > 0 ? 1 : -1
    const inward = { x: model.nx * sgn, y: model.ny * sgn }
    inwards.push(inward)
    const near = edgePoints(g, a, b, inward)
    const fit = acceptFit(near.pts, near.sampled, model)
    lines.push(fit?.line ?? model)
    snapped[i] = fit !== null
    if (fit) polarity += near.sign
  }
  for (let i = 0; i < 4; i++) {
    if (snapped[i]) continue
    const line = snapSideWide(g, quad[i], quad[(i + 1) % 4], inwards[i], lines[i], Math.sign(polarity))
    if (line) {
      lines[i] = line
      snapped[i] = true
    }
  }
  const out: Point[] = []
  for (let i = 0; i < 4; i++) {
    // Corner i is where side i-1 (ending at it) meets side i (starting at it).
    const p = intersect(lines[(i + 3) % 4], lines[i])
    if (!p) return { corners: quad, snapped: [false, false, false, false] }
    out.push(p)
  }
  return { corners: out as Corners, snapped }
}

const cross = (o: Point, a: Point, b: Point) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x)

export function quadArea(c: Corners): number {
  let s = 0
  for (let i = 0; i < 4; i++) s += c[i].x * c[(i + 1) % 4].y - c[(i + 1) % 4].x * c[i].y
  return Math.abs(s) / 2
}

/**
 * A usable document quad: strictly convex (which also rules out crossed corners),
 * at least MIN_AREA_RATIO of the image, and every corner within the allowed margin
 * outside the image.
 */
export function isValidQuad(c: Corners, width: number, height: number, minArea = MIN_AREA_RATIO): boolean {
  if (c.some((p) => !Number.isFinite(p.x) || !Number.isFinite(p.y))) return false
  const mx = OUTSIDE_MARGIN * width
  const my = OUTSIDE_MARGIN * height
  if (c.some((p) => p.x < -mx || p.x > width + mx || p.y < -my || p.y > height + my)) return false
  let sign = 0
  for (let i = 0; i < 4; i++) {
    const z = cross(c[i], c[(i + 1) % 4], c[(i + 2) % 4])
    if (Math.abs(z) < 1e-9) return false
    const s = Math.sign(z)
    if (sign === 0) sign = s
    else if (s !== sign) return false
  }
  // Crossed (bow-tie) corners flip the turn direction, so the test above rejects them too.
  return quadArea(c) >= minArea * width * height
}
