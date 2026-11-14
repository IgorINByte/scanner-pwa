import { describe, expect, it } from 'vitest'
import type { Corners } from '../../types'
import { bigEnough, orientationMismatch, paperLongSidePx, requiredPaperPx, SETTLE_MIN_MS, Tracker, type Rgb } from './tracking'

/** Live frame (portrait, as on iPhone) and the 12 MP camera frame it is taken from. */
const F = { width: 192, height: 256 }
const SRC = { width: 3024, height: 4032 }
const K = 4032 / 256 // live px -> camera px
const GREY: Rgb = [180, 180, 175]

const quad = (x0: number, y0: number, x1: number, y1: number, d = 0): Corners => [
  { x: x0 + d, y: y0 },
  { x: x1 + d, y: y0 },
  { x: x1 + d, y: y1 },
  { x: x0 + d, y: y1 },
]
/** Portrait paper whose long side is `px` camera pixels, centred. */
const portrait = (px: number): Corners => {
  const h = px / K
  const w = h / Math.SQRT2
  return quad(96 - w / 2, 128 - h / 2, 96 + w / 2, 128 + h / 2)
}
const BIG = portrait(2600)
const SMALL = portrait(1900)
/** The 08:23 case: landscape A4 on an upright phone, 58 % of the frame width. */
const LANDSCAPE_58 = quad(40, 88, 152, 167)

/** Feeds the same corners every 66 ms (15 det/s) for `ms`; returns the last output and shot count. */
function feed(tr: Tracker, c: Corners | null, from: number, ms: number, color: (t: number) => Rgb = () => GREY) {
  let out = tr.update(from, c, F, { source: SRC, color: color(from) })
  let shots = out.shoot ? 1 : 0
  for (let t = from + 66; t <= from + ms; t += 66) {
    out = tr.update(t, c, F, { source: SRC, color: color(t) })
    if (out.shoot) shots++
  }
  return { out, shots }
}

describe('size test (shared by "Move closer" and auto-shutter)', () => {
  it('measures the paper in camera pixels', () => {
    expect(paperLongSidePx(BIG, F, SRC)).toBeCloseTo(2600, 0)
    expect(requiredPaperPx(SRC)).toBe(2300)
    expect(bigEnough(BIG, F, SRC)).toBe(true)
    expect(bigEnough(SMALL, F, SRC)).toBe(false)
  })

  it('asks less of a low-resolution camera', () => {
    expect(requiredPaperPx({ width: 1080, height: 1920 })).toBeCloseTo(1440)
  })

  it('the 08:23 landscape sheet is too small and wrongly oriented', () => {
    expect(orientationMismatch(LANDSCAPE_58, F)).toBe(true)
    expect(paperLongSidePx(LANDSCAPE_58, F, SRC)).toBeLessThan(2300)
  })
})

describe('Tracker', () => {
  it('shows "Move closer" after 0.5 s and never shoots below 2300 px', () => {
    const tr = new Tracker()
    expect(feed(tr, SMALL, 0, 300).out.hint).toBeNull()
    const r = feed(tr, SMALL, 366, 4000)
    expect(r.out.hint).toBe('closer')
    expect(r.shots).toBe(0)
  })

  it('08:23 case: asks to rotate and does not shoot', () => {
    const tr = new Tracker()
    const r = feed(tr, LANDSCAPE_58, 0, 4000)
    expect(r.out.hint).toBe('rotate')
    expect(r.shots).toBe(0)
  })

  it('hint and shutter never disagree about size', () => {
    for (let px = 1500; px <= 3400; px += 100) {
      const tr = new Tracker()
      const r = feed(tr, portrait(px), 0, 3000)
      const ok = bigEnough(portrait(px), F, SRC)
      expect(r.shots > 0).toBe(ok)
      expect(r.out.hint === 'closer').toBe(!ok)
    }
  })

  it('says hold still while the frame keeps moving, and never shoots then', () => {
    const tr = new Tracker()
    let shots = 0
    let hint = null
    for (let i = 0, t = 0; i < 60; i++, t += 66) {
      const r = tr.update(t, quad(20, 10, 172, 215, i % 2 ? 0 : 12), F, { source: SRC, color: GREY })
      hint = r.hint
      if (r.shoot) shots++
    }
    expect(hint).toBe('still')
    expect(shots).toBe(0)
  })

  it('auto-shoots once a still, large frame has settled', () => {
    const tr = new Tracker()
    expect(feed(tr, BIG, 0, SETTLE_MIN_MS - 100).shots).toBe(0)
    expect(feed(tr, BIG, SETTLE_MIN_MS, 600).shots).toBe(1)
  })

  it('does not shoot the same placement twice, re-arms after the paper left', () => {
    const tr = new Tracker()
    expect(feed(tr, BIG, 0, 2000).shots).toBe(1)
    expect(feed(tr, BIG, 2066, 2000).shots).toBe(0)
    feed(tr, null, 4100, 600)
    expect(feed(tr, BIG, 4800, 1500).shots).toBe(1)
  })

  it('tolerates a single missed detection', () => {
    const tr = new Tracker()
    feed(tr, BIG, 0, 500)
    expect(tr.update(566, null, F, { source: SRC }).present).toBe(true)
    expect(tr.update(1000, null, F, { source: SRC }).present).toBe(false)
  })
})

describe('colour settling (auto-shot must not catch the camera mid white-balance)', () => {
  /** Preview colour drifting from bluish to neutral over the first `ms` (like iPhone AWB on start). */
  const drifting =
    (ms: number) =>
    (t: number): Rgb => {
      const k = Math.min(1, t / ms)
      return [150 + 40 * k, 175 + 10 * k, 215 - 35 * k]
    }

  it('waits while the colour is still changing', () => {
    const tr = new Tracker()
    const color = drifting(3000)
    const early = feed(tr, BIG, 0, 3000, color)
    expect(early.shots).toBe(0)
    expect(early.out.settled).toBe(false)
    const later = feed(tr, BIG, 3066, 1500, color)
    expect(later.shots).toBe(1)
  })

  it('a steady colour still waits for the minimum settle time', () => {
    const tr = new Tracker()
    expect(feed(tr, BIG, 0, SETTLE_MIN_MS - 100).out.settled).toBe(false)
    expect(feed(tr, BIG, SETTLE_MIN_MS, 100).out.settled).toBe(true)
  })
})
