import { describe, expect, it } from 'vitest'
import { NO_ADJUSTMENTS, type Corners, type ScanParams } from '../../types'
import { createImg, luminance, rotateImg, type Img } from './buffer'
import {
  blackAndWhite,
  brightnessContrast,
  denoise,
  grayscale,
  removeShadows,
  sharpen,
  whiten,
} from './enhance'
import { applyHomography, homography, outputSize, warpPerspective } from './perspective'
import { processScan } from './pipeline'

function fill(w: number, h: number, fn: (x: number, y: number) => [number, number, number]): Img {
  const img = createImg(w, h)
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const [r, g, b] = fn(x, y)
      const i = (y * w + x) * 4
      img.data.set([r, g, b, 255], i)
    }
  return img
}

const mean = (a: ArrayLike<number>) => Array.from(a).reduce((s, v) => s + v, 0) / a.length
const std = (a: ArrayLike<number>) => {
  const m = mean(a)
  return Math.sqrt(Array.from(a).reduce((s, v) => s + (v - m) ** 2, 0) / a.length)
}
const px = (img: Img, x: number, y: number) => Array.from(img.data.slice((y * img.width + x) * 4, (y * img.width + x) * 4 + 3))

describe('perspective', () => {
  it('homography maps the four corners exactly', () => {
    const from = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 50 },
      { x: 0, y: 50 },
    ]
    const to = [
      { x: 10, y: 20 },
      { x: 90, y: 5 },
      { x: 120, y: 80 },
      { x: 3, y: 70 },
    ]
    const H = homography(from, to)
    from.forEach((p, i) => {
      const q = applyHomography(H, p.x, p.y)
      expect(q.x).toBeCloseTo(to[i].x, 6)
      expect(q.y).toBeCloseTo(to[i].y, 6)
    })
  })

  it('rejects degenerate corners', () => {
    const p = { x: 1, y: 1 }
    expect(() => homography([p, p, p, p], [p, p, p, p])).toThrow()
  })

  it('flattens a skewed white quad on a dark background into a white page', () => {
    // White quadrilateral drawn into a dark image.
    const corners: Corners = [
      { x: 30, y: 20 },
      { x: 170, y: 40 },
      { x: 160, y: 180 },
      { x: 20, y: 150 },
    ]
    const inside = (x: number, y: number) => {
      // point-in-convex-polygon via cross products
      for (let i = 0; i < 4; i++) {
        const a = corners[i]
        const b = corners[(i + 1) % 4]
        if ((b.x - a.x) * (y - a.y) - (b.y - a.y) * (x - a.x) < 0) return false
      }
      return true
    }
    const src = fill(200, 200, (x, y) => (inside(x + 0.5, y + 0.5) ? [250, 250, 250] : [20, 20, 20]))
    const out = warpPerspective(src, corners, 120, 120)
    // Ignore a 3 px border (bilinear blending with the background at the edges).
    const vals: number[] = []
    for (let y = 3; y < 117; y++) for (let x = 3; x < 117; x++) vals.push(out.data[(y * 120 + x) * 4])
    expect(Math.min(...vals)).toBeGreaterThan(240)
  })

  it('output size follows measured proportions or the chosen paper format', () => {
    const c: Corners = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 200 },
      { x: 0, y: 200 },
    ]
    expect(outputSize(c, 'auto', 1000)).toEqual({ width: 100, height: 200 })
    const a4 = outputSize(c, 'a4', 1000)
    expect(a4.height / a4.width).toBeCloseTo(Math.SQRT2, 2)
    const letter = outputSize(c, 'letter', 1000)
    expect(letter.height / letter.width).toBeCloseTo(11 / 8.5, 2)
    expect(Math.max(...Object.values(outputSize(c, 'auto', 50)))).toBe(50)
  })
})

describe('enhancements', () => {
  const gradient = () => fill(64, 64, (x) => [x * 4, x * 3, x * 2])

  it('grayscale makes R=G=B', () => {
    const img = gradient()
    grayscale(img)
    for (let i = 0; i < img.data.length; i += 4) {
      expect(img.data[i]).toBe(img.data[i + 1])
      expect(img.data[i]).toBe(img.data[i + 2])
    }
  })

  it('brightness raises and contrast spreads values', () => {
    const a = gradient()
    const before = mean(luminance(a))
    brightnessContrast(a, 40, 0)
    expect(mean(luminance(a))).toBeGreaterThan(before + 30)

    const b = gradient()
    const s0 = std(luminance(b))
    brightnessContrast(b, 0, 50)
    expect(std(luminance(b))).toBeGreaterThan(s0)
  })

  it('whiten turns light gray paper white', () => {
    const img = fill(8, 8, () => [215, 215, 215])
    whiten(img, 50)
    expect(px(img, 3, 3)).toEqual([255, 255, 255])
  })

  it('shadow removal evens out a lighting gradient but keeps text dark', () => {
    // Paper lit from the left (bright -> dark) with a dark "text" bar.
    const img = fill(300, 200, (x, y) => {
      const paper = 240 - x * 0.45
      return y > 95 && y < 105 && x > 40 && x < 260 ? [30, 30, 30] : [paper, paper, paper]
    })
    const left = px(img, 10, 20)[0]
    const right = px(img, 290, 20)[0]
    removeShadows(img, 1)
    const left2 = px(img, 10, 20)[0]
    const right2 = px(img, 290, 20)[0]
    expect(Math.abs(left2 - right2)).toBeLessThan(Math.abs(left - right) / 3)
    expect(px(img, 150, 100)[0]).toBeLessThan(80)
  })

  it('black & white produces only pure black and white, text black, solid blocks filled', () => {
    const img = fill(200, 200, (x, y) => {
      if (x > 20 && x < 120 && y > 20 && y < 60) return [15, 15, 15] // solid block
      if (y > 100 && y < 104) return [60, 60, 60] // text line
      return [235, 235, 235]
    })
    blackAndWhite(img)
    for (let i = 0; i < img.data.length; i += 4) expect([0, 255]).toContain(img.data[i])
    expect(px(img, 70, 40)[0]).toBe(0) // centre of the solid block stays black
    expect(px(img, 100, 102)[0]).toBe(0)
    expect(px(img, 100, 160)[0]).toBe(255)
  })

  it('denoise reduces noise; sharpen increases edge contrast', () => {
    let seed = 1
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 60 - 30
    const noisy = fill(64, 64, () => {
      const v = 128 + rnd()
      return [v, v, v]
    })
    const s0 = std(luminance(noisy))
    denoise(noisy, 100)
    expect(std(luminance(noisy))).toBeLessThan(s0 * 0.8)

    const edge = fill(32, 8, (x) => (x < 16 ? [100, 100, 100] : [160, 160, 160]))
    sharpen(edge, 80)
    expect(px(edge, 15, 4)[0]).toBeLessThan(100)
    expect(px(edge, 16, 4)[0]).toBeGreaterThan(160)
  })

  it('rotates 90° clockwise', () => {
    const img = fill(3, 2, (x, y) => [x * 10, y * 10, 0])
    const r = rotateImg(img, 90)
    expect([r.width, r.height]).toEqual([2, 3])
    // top-left of the source ends up top-right
    expect(px(r, 1, 0)).toEqual([0, 0, 0])
    expect(px(r, 0, 0)).toEqual([0, 10, 0])
  })
})

describe('processScan', () => {
  const params = (p: Partial<ScanParams>): ScanParams => ({
    corners: null,
    paper: 'auto',
    filter: 'original',
    adjust: NO_ADJUSTMENTS,
    rotation: 0,
    ...p,
  })

  it('original + no adjustments leaves pixels unchanged', () => {
    const src = fill(20, 10, (x, y) => [x * 10, y * 20, 77])
    const copy = new Uint8ClampedArray(src.data)
    const out = processScan(src, params({}), 1, 1000)
    expect(Array.from(out.data)).toEqual(Array.from(copy))
  })

  it('applies crop with paper format and rotation', () => {
    const src = fill(400, 400, () => [200, 200, 200])
    const corners: Corners = [
      { x: 50, y: 50 },
      { x: 250, y: 50 },
      { x: 250, y: 330 },
      { x: 50, y: 330 },
    ]
    // corners are given in original pixels; src is a 50% downscale of an 800x800 original
    const doubled = corners.map((p) => ({ x: p.x * 2, y: p.y * 2 })) as Corners
    const out = processScan(src, params({ corners: doubled, paper: 'a4', rotation: 90 }), 0.5, 1000)
    // A4 portrait page rotated 90° -> landscape
    expect(out.width).toBeGreaterThan(out.height)
    expect(out.width / out.height).toBeCloseTo(Math.SQRT2, 1)
  })
})
