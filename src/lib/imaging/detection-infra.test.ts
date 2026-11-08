import sharp from 'sharp'
import { describe, expect, it } from 'vitest'
import type { Corners } from '../../types'
import { isHeif, orientedSize, readImageHeader } from './image-header'
import { maxCornerError, quadIoU, scoreDetection, summarize, toNormalised, toPixels } from './quad-metrics'

const square = (x: number, y: number, s: number): Corners => [
  { x, y },
  { x: x + s, y },
  { x: x + s, y: y + s },
  { x, y: y + s },
]

describe('quad metrics', () => {
  it('IoU of identical quads is 1, disjoint is 0', () => {
    expect(quadIoU(square(0, 0, 10), square(0, 0, 10))).toBeCloseTo(1)
    expect(quadIoU(square(0, 0, 10), square(20, 20, 10))).toBe(0)
  })

  it('IoU of half-overlapping squares is 1/3', () => {
    expect(quadIoU(square(0, 0, 10), square(5, 0, 10))).toBeCloseTo(50 / 150)
  })

  it('IoU does not depend on winding', () => {
    const b = [...square(5, 0, 10)].reverse() as Corners
    expect(quadIoU(square(0, 0, 10), b)).toBeCloseTo(1 / 3)
  })

  it('corner error is relative to the diagonal', () => {
    expect(maxCornerError(square(0, 0, 10), square(3, 4, 10), 30, 40)).toBeCloseTo(5 / 50)
  })

  it('round-trips normalised ground truth', () => {
    const c = square(10, 20, 30)
    const back = toPixels(toNormalised(c, 100, 200), 100, 200)
    back.forEach((p, i) => {
      expect(p.x).toBeCloseTo(c[i].x, 1)
      expect(p.y).toBeCloseTo(c[i].y, 1)
    })
  })

  it('scores no-document images by whether detection rejected them', () => {
    const det = { corners: square(0, 0, 10), ms: 5 }
    expect(scoreDetection('a', null, { ...det, detection: 'none' }, 10, 10).iou).toBe(1)
    expect(scoreDetection('a', null, { ...det, detection: 'found' }, 10, 10).iou).toBe(0)
    const s = summarize([scoreDetection('a', null, { ...det, detection: 'none' }, 10, 10)])
    expect(s.hitRate90).toBe(1)
  })
})

describe('image header', () => {
  it('reads JPEG size and EXIF orientation', async () => {
    const buf = await sharp({ create: { width: 64, height: 32, channels: 3, background: '#fff' } })
      .jpeg()
      .withMetadata({ orientation: 6 })
      .toBuffer()
    const h = readImageHeader(new Uint8Array(buf))
    expect(h).toEqual({ width: 64, height: 32, orientation: 6 })
    expect(orientedSize(h!)).toEqual({ width: 32, height: 64 })
  })

  it('reads PNG and WebP sizes', async () => {
    const base = sharp({ create: { width: 50, height: 70, channels: 3, background: '#000' } })
    expect(readImageHeader(new Uint8Array(await base.clone().png().toBuffer()))).toMatchObject({ width: 50, height: 70 })
    expect(readImageHeader(new Uint8Array(await base.clone().webp().toBuffer()))).toMatchObject({ width: 50, height: 70 })
    expect(readImageHeader(new Uint8Array(await base.clone().webp({ lossless: true }).toBuffer()))).toMatchObject({
      width: 50,
      height: 70,
    })
  })

  it('recognises HEIF containers', () => {
    const b = new Uint8Array(16)
    b.set(new TextEncoder().encode('ftypheic'), 4)
    expect(isHeif(b)).toBe(true)
    expect(readImageHeader(b)).toBe(null)
  })
})
