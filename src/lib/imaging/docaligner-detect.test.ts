import { describe, expect, it } from 'vitest'
import { decodeHeatmaps } from './docaligner-detect'

const HW = 16

/** Four heatmap channels with one square blob each (and optional noise blobs). */
function heatmaps(blobs: { x: number; y: number; r: number; v?: number }[][]): Float32Array {
  const d = new Float32Array(4 * HW * HW)
  blobs.forEach((list, c) =>
    list.forEach(({ x, y, r, v = 0.9 }) => {
      for (let yy = y - r; yy <= y + r; yy++) for (let xx = x - r; xx <= x + r; xx++) d[c * HW * HW + yy * HW + xx] = v
    }),
  )
  return d
}

describe('decodeHeatmaps', () => {
  it('returns the centroid of each corner blob, normalised', () => {
    const r = decodeHeatmaps(heatmaps([[{ x: 2, y: 3, r: 1 }], [{ x: 13, y: 2, r: 1 }], [{ x: 12, y: 12, r: 1 }], [{ x: 3, y: 13, r: 1 }]]), HW)
    expect(r).not.toBeNull()
    expect(r!.points[0].x).toBeCloseTo(2.5 / HW)
    expect(r!.points[0].y).toBeCloseTo(3.5 / HW)
    expect(r!.points[2].x).toBeCloseTo(12.5 / HW)
    expect(r!.score).toBeCloseTo(0.9)
  })

  it('takes the largest blob when a channel has several', () => {
    const r = decodeHeatmaps(
      heatmaps([[{ x: 2, y: 2, r: 0 }, { x: 9, y: 9, r: 2, v: 0.5 }], [{ x: 13, y: 2, r: 1 }], [{ x: 12, y: 12, r: 1 }], [{ x: 3, y: 13, r: 1 }]]),
      HW,
    )
    expect(r!.points[0].x).toBeCloseTo(9.5 / HW)
  })

  it('returns null when a corner is below the threshold', () => {
    expect(decodeHeatmaps(heatmaps([[{ x: 2, y: 3, r: 1 }], [{ x: 13, y: 2, r: 1, v: 0.2 }], [{ x: 12, y: 12, r: 1 }], [{ x: 3, y: 13, r: 1 }]]), HW)).toBeNull()
  })
})
