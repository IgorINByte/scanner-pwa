// Perspective correction: homography estimation + inverse-mapped bilinear warp.
import type { Corners, PaperFormat, Point } from '../../types'
import { createImg, type Img } from './buffer'

const dist = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y)

const PAPER_RATIO: Record<Exclude<PaperFormat, 'auto'>, number> = {
  a4: Math.SQRT2,
  a5: Math.SQRT2,
  letter: 11 / 8.5,
}

/**
 * Output size of the flattened page. "auto" keeps the measured proportions; a paper
 * format forces its aspect ratio (orientation follows the measured shape).
 */
export function outputSize(c: Corners, paper: PaperFormat, maxSide: number): { width: number; height: number } {
  let w = Math.max(dist(c[0], c[1]), dist(c[3], c[2]))
  let h = Math.max(dist(c[0], c[3]), dist(c[1], c[2]))
  if (paper !== 'auto') {
    const ratio = PAPER_RATIO[paper]
    const long = Math.max(w, h)
    if (h >= w) {
      h = long
      w = long / ratio
    } else {
      w = long
      h = long / ratio
    }
  }
  const s = Math.min(1, maxSide / Math.max(w, h))
  return { width: Math.max(1, Math.round(w * s)), height: Math.max(1, Math.round(h * s)) }
}

/** 3x3 homography (row-major, h33 = 1) mapping each `from` point onto the matching `to` point. */
export function homography(from: Point[], to: Point[]): number[] {
  // Solve the standard 8x8 DLT system with Gaussian elimination (partial pivoting).
  const A: number[][] = []
  for (let i = 0; i < 4; i++) {
    const { x, y } = from[i]
    const { x: u, y: v } = to[i]
    A.push([x, y, 1, 0, 0, 0, -u * x, -u * y, u])
    A.push([0, 0, 0, x, y, 1, -v * x, -v * y, v])
  }
  for (let col = 0; col < 8; col++) {
    let pivot = col
    for (let r = col + 1; r < 8; r++) if (Math.abs(A[r][col]) > Math.abs(A[pivot][col])) pivot = r
    if (Math.abs(A[pivot][col]) < 1e-12) throw new Error('Degenerate corner configuration')
    ;[A[col], A[pivot]] = [A[pivot], A[col]]
    for (let r = 0; r < 8; r++) {
      if (r === col) continue
      const f = A[r][col] / A[col][col]
      for (let k = col; k < 9; k++) A[r][k] -= f * A[col][k]
    }
  }
  const h = A.map((row, i) => row[8] / row[i])
  return [...h, 1]
}

export function applyHomography(H: number[], x: number, y: number): Point {
  const d = H[6] * x + H[7] * y + H[8]
  return { x: (H[0] * x + H[1] * y + H[2]) / d, y: (H[3] * x + H[4] * y + H[5]) / d }
}

/**
 * Warps the quadrilateral `c` of `src` into a width x height rectangle.
 * Every output pixel is inverse-mapped into the source and sampled bilinearly,
 * so no content along the edges is lost or stretched unevenly.
 */
export function warpPerspective(src: Img, c: Corners, width: number, height: number): Img {
  const out = createImg(width, height)
  const H = homography(
    [
      { x: 0, y: 0 },
      { x: width, y: 0 },
      { x: width, y: height },
      { x: 0, y: height },
    ],
    c,
  )
  const sw = src.width
  const sh = src.height
  const s = src.data
  const o = out.data
  let i = 0
  for (let y = 0; y < height; y++) {
    const yc = y + 0.5
    // Incremental evaluation of the projective transform along the row.
    let nx = H[0] * 0.5 + H[1] * yc + H[2]
    let ny = H[3] * 0.5 + H[4] * yc + H[5]
    let nd = H[6] * 0.5 + H[7] * yc + H[8]
    for (let x = 0; x < width; x++) {
      let fx = nx / nd - 0.5
      let fy = ny / nd - 0.5
      nx += H[0]
      ny += H[3]
      nd += H[6]
      if (fx < 0) fx = 0
      else if (fx > sw - 1) fx = sw - 1
      if (fy < 0) fy = 0
      else if (fy > sh - 1) fy = sh - 1
      const x0 = fx | 0
      const y0 = fy | 0
      const x1 = x0 + 1 < sw ? x0 + 1 : x0
      const y1 = y0 + 1 < sh ? y0 + 1 : y0
      const ax = fx - x0
      const ay = fy - y0
      const p00 = (y0 * sw + x0) * 4
      const p10 = (y0 * sw + x1) * 4
      const p01 = (y1 * sw + x0) * 4
      const p11 = (y1 * sw + x1) * 4
      for (let ch = 0; ch < 3; ch++) {
        const top = s[p00 + ch] + (s[p10 + ch] - s[p00 + ch]) * ax
        const bot = s[p01 + ch] + (s[p11 + ch] - s[p01 + ch]) * ax
        o[i + ch] = top + (bot - top) * ay
      }
      o[i + 3] = 255
      i += 4
    }
  }
  return out
}
