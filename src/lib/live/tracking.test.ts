import { describe, expect, it } from 'vitest'
import type { Corners } from '../../types'
import { coverage, orientationMismatch, Tracker } from './tracking'

const F = { width: 192, height: 256 }
const quad = (x0: number, y0: number, x1: number, y1: number, d = 0): Corners => [
  { x: x0 + d, y: y0 },
  { x: x1 + d, y: y0 },
  { x: x1 + d, y: y1 },
  { x: x0 + d, y: y1 },
]
const BIG = quad(20, 30, 172, 240) // 79 % of the width, portrait paper
const SMALL = quad(60, 80, 130, 180) // 36 %
const WIDE = quad(10, 90, 182, 200) // landscape paper in a portrait frame

/** Feeds the same corners every 66 ms (15 det/s) for `ms`, returns the last output. */
function feed(tr: Tracker, c: Corners | null, from: number, ms: number) {
  let out = tr.update(from, c, F)
  let shots = out.shoot ? 1 : 0
  for (let t = from + 66; t <= from + ms; t += 66) {
    out = tr.update(t, c, F)
    if (out.shoot) shots++
  }
  return { out, shots }
}

describe('geometry helpers', () => {
  it('measures coverage along the shorter side', () => {
    expect(coverage(BIG, F)).toBeCloseTo(152 / 192)
    expect(coverage(SMALL, F)).toBeLessThan(0.7)
  })
  it('detects landscape paper in a portrait frame', () => {
    expect(orientationMismatch(WIDE, F)).toBe(true)
    expect(orientationMismatch(BIG, F)).toBe(false)
  })
})

describe('Tracker', () => {
  it('asks to move closer only after the state lasted 0.5 s', () => {
    const tr = new Tracker()
    expect(feed(tr, SMALL, 0, 300).out.hint).toBeNull()
    expect(feed(tr, SMALL, 366, 300).out.hint).toBe('closer')
  })

  it('asks to rotate before asking to move closer', () => {
    const tr = new Tracker()
    expect(feed(tr, WIDE, 0, 700).out.hint).toBe('rotate')
  })

  it('says hold still while the frame keeps moving, and never shoots then', () => {
    const tr = new Tracker()
    let shots = 0
    let hint = null
    for (let i = 0, t = 0; i < 30; i++, t += 66) {
      const r = tr.update(t, quad(20, 30, 172, 240, i % 2 ? 0 : 12), F)
      hint = r.hint
      if (r.shoot) shots++
    }
    expect(hint).toBe('still')
    expect(shots).toBe(0)
  })

  it('auto-shoots once after ~1 s of a still, large frame', () => {
    const tr = new Tracker()
    const early = feed(tr, BIG, 0, 800)
    expect(early.shots).toBe(0)
    const r = feed(tr, BIG, 866, 400)
    expect(r.shots).toBe(1)
  })

  it('does not shoot the same placement twice, re-arms after the paper left', () => {
    const tr = new Tracker()
    let r = feed(tr, BIG, 0, 1200)
    expect(r.shots).toBe(1)
    tr.shot()
    r = feed(tr, BIG, 1266, 2000)
    expect(r.shots).toBe(0)
    feed(tr, null, 3300, 600)
    r = feed(tr, BIG, 4000, 1500)
    expect(r.shots).toBe(1)
  })

  it('tolerates a single missed detection', () => {
    const tr = new Tracker()
    feed(tr, BIG, 0, 500)
    expect(tr.update(566, null, F).present).toBe(true)
    expect(tr.update(1000, null, F).present).toBe(false)
  })
})
