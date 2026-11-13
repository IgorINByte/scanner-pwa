import { describe, expect, it } from 'vitest'
import { MAX_CANVAS_PIXELS, scaleFor } from './decode'

describe('scaleFor', () => {
  it('keeps a 12 MP camera frame at full size', () => {
    expect(scaleFor(4032, 3024, 4500)).toBe(1)
  })

  it('caps the long side', () => {
    expect(scaleFor(9000, 3000, 4500)).toBeCloseTo(0.5)
  })

  it("stays under Safari's canvas limit for square images", () => {
    const s = scaleFor(4500, 4500, 4500)
    expect(Math.round(4500 * s) ** 2).toBeLessThanOrEqual(MAX_CANVAS_PIXELS)
    expect(MAX_CANVAS_PIXELS).toBeLessThan(16_777_216)
  })
})
