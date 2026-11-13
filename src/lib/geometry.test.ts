import { describe, expect, it } from 'vitest'
import type { Corners } from '../types'
import { clampToMargin, moveSide, sideMidpoint } from './geometry'

const W = 1000
const H = 800
const quad: Corners = [
  { x: 100, y: 100 },
  { x: 900, y: 120 },
  { x: 880, y: 700 },
  { x: 120, y: 680 },
]

describe('clampToMargin', () => {
  it('allows corners up to 5 % outside the image, no further', () => {
    expect(clampToMargin({ x: -30, y: 830 }, W, H)).toEqual({ x: -30, y: 830 })
    expect(clampToMargin({ x: -80, y: 900 }, W, H)).toEqual({ x: -50, y: 840 })
  })
})

describe('moveSide', () => {
  it('moves the side parallel to itself, ends sliding along the neighbouring sides', () => {
    const out = moveSide(quad, 0, { x: 0, y: -50 }, W, H)
    // Top side keeps its direction.
    const dir = (c: Corners) => Math.atan2(c[1].y - c[0].y, c[1].x - c[0].x)
    expect(dir(out)).toBeCloseTo(dir(quad), 6)
    // New ends lie on the old left and right sides' lines.
    const onLine = (p: { x: number; y: number }, a: { x: number; y: number }, b: { x: number; y: number }) =>
      (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x)
    expect(onLine(out[0], quad[3], quad[0])).toBeCloseTo(0, 3)
    expect(onLine(out[1], quad[1], quad[2])).toBeCloseTo(0, 3)
    // The other corners do not move; the side moved up by ~50 px.
    expect(out[2]).toEqual(quad[2])
    expect(out[3]).toEqual(quad[3])
    expect(sideMidpoint(quad, 0).y - sideMidpoint(out, 0).y).toBeCloseTo(50, 0)
  })

  it('ignores the part of the drag along the side', () => {
    const out = moveSide(quad, 3, { x: 0, y: 200 }, W, H)
    expect(Math.hypot(out[0].x - quad[0].x, out[0].y - quad[0].y)).toBeLessThan(10) // only the ~7 px across the slightly tilted side
  })

  it('stops at the 5 % margin outside the image', () => {
    const out = moveSide(quad, 0, { x: 0, y: -1000 }, W, H)
    expect(Math.min(out[0].y, out[1].y)).toBeGreaterThanOrEqual(-H * 0.05 - 1e-6)
    expect(Math.min(out[0].y, out[1].y)).toBeLessThan(-H * 0.05 + 1)
  })
})
