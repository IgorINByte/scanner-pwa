import { describe, expect, it } from 'vitest'
import type { Corners } from '../../types'
import { isValidQuad, refineQuad, type GrayImage } from './refine'

const W = 800
const H = 600

/** Light page (200) on a slightly lighter background (225): low contrast, like case A. */
function page(quad: Corners, holes = false): GrayImage {
  const data = new Uint8Array(W * H).fill(225)
  const inside = (x: number, y: number) => {
    for (let i = 0; i < 4; i++) {
      const a = quad[i]
      const b = quad[(i + 1) % 4]
      if ((b.x - a.x) * (y - a.y) - (b.y - a.y) * (x - a.x) < 0) return false
    }
    return true
  }
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (inside(x + 0.5, y + 0.5)) data[y * W + x] = 200
  if (holes) {
    // Spiral binding: dark holes just inside the left edge.
    for (let cy = 120; cy < 480; cy += 30)
      for (let y = cy - 6; y <= cy + 6; y++) for (let x = 112; x <= 124; x++) if ((x - 118) ** 2 + (y - cy) ** 2 <= 36) data[y * W + x] = 40
  }
  return { data, width: W, height: H }
}

const truth: Corners = [
  { x: 100, y: 80 },
  { x: 700, y: 100 },
  { x: 680, y: 520 },
  { x: 120, y: 500 },
]
const rough = truth.map((p, i) => ({ x: p.x + [9, -8, 7, -10][i], y: p.y + [-7, 9, -9, 8][i] })) as Corners
const maxErr = (a: Corners, b: Corners) => Math.max(...a.map((p, i) => Math.hypot(p.x - b[i].x, p.y - b[i].y)))

describe('refineQuad', () => {
  it('snaps a rough quad onto a low-contrast page edge', () => {
    const r = refineQuad(page(truth), rough)
    expect(r.snapped).toEqual([true, true, true, true])
    expect(maxErr(r.corners, truth)).toBeLessThan(2)
  })

  it('ignores spiral holes along a side', () => {
    const r = refineQuad(page(truth, true), rough)
    expect(r.snapped[3]).toBe(true)
    expect(maxErr(r.corners, truth)).toBeLessThan(2.5)
  })

  it('finds a spiral side far from the model line (wide search, outermost line)', () => {
    const g = page(truth, true)
    // Dark wire coils crossing the left edge every 30 px, as on a spiral notebook.
    for (let cy = 110; cy < 490; cy += 30)
      for (let y = cy - 3; y <= cy + 3; y++) for (let x = 92; x <= 126; x++) g.data[y * W + x] = 50
    // Model's left side 60 px out on the background, beyond the normal search band.
    const off = rough.map((p, i) => (i === 0 || i === 3 ? { x: p.x - 60, y: p.y } : p)) as Corners
    const r = refineQuad(g, off)
    expect(r.snapped).toEqual([true, true, true, true])
    expect(maxErr(r.corners, truth)).toBeLessThan(3)
  })

  it('keeps the model line where there is no edge', () => {
    const blank: GrayImage = { data: new Uint8Array(W * H).fill(210), width: W, height: H }
    const r = refineQuad(blank, rough)
    expect(r.snapped).toEqual([false, false, false, false])
    expect(maxErr(r.corners, rough)).toBeLessThan(1e-6)
  })
})

describe('isValidQuad', () => {
  it('accepts a normal page and corners slightly outside the image', () => {
    expect(isValidQuad(truth, W, H)).toBe(true)
    expect(isValidQuad([{ x: -30, y: -20 }, { x: 820, y: 10 }, { x: 780, y: 620 }, { x: 10, y: 590 }], W, H)).toBe(true)
  })

  it('rejects crossed, concave, too small or too far outside', () => {
    expect(isValidQuad([truth[0], truth[2], truth[1], truth[3]], W, H)).toBe(false)
    expect(isValidQuad([truth[0], truth[1], { x: 400, y: 150 }, truth[3]], W, H)).toBe(false)
    expect(isValidQuad([{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }], W, H)).toBe(false)
    expect(isValidQuad([{ x: -60, y: 0 }, { x: 800, y: 0 }, { x: 800, y: 600 }, { x: 0, y: 600 }], W, H)).toBe(false)
  })
})
