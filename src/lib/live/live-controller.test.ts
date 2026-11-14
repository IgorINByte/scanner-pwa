import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import type { Corners } from '../../types'
import type { LiveRequest, LiveResponse } from '../../workers/live.worker'
import { LiveController, type LiveEnv } from './live-controller'
import { stepQuad, type QuadState } from './quad-anim'
import type { Hint } from './tracking'

const FRAME = { width: 192, height: 256 }
const SOURCE = { width: 3024, height: 4032 }
/** Portrait paper, long side ~1900 camera px: tracked, but too small for Auto. */
const SMALL: Corners = [
  { x: 53, y: 68 },
  { x: 139, y: 68 },
  { x: 139, y: 188 },
  { x: 53, y: 188 },
]

/** Fake environment: a worker that answers every frame with `corners`, and a manual clock. */
function fakeEnv(corners: Corners | null) {
  let now = 0
  const timers = new Map<number, { at: number; fn: () => void }>()
  let nextId = 1
  const sent: LiveRequest['type'][] = []
  const worker: LiveEnv['worker'] = {
    onmessage: null,
    postMessage(m: LiveRequest) {
      sent.push(m.type)
      const reply: LiveResponse =
        m.type === 'init' ? { type: 'ready', ms: 50 } : { type: 'result', corners, ms: 15, ...FRAME }
      queueMicrotask(() => worker.onmessage?.({ data: reply } as MessageEvent<LiveResponse>))
    },
    terminate() {},
  }
  const env: LiveEnv = {
    worker,
    grab: async () => ({ frame: { close() {} } as ImageBitmap, color: [180, 180, 175], source: SOURCE }),
    now: () => now,
    hidden: () => false,
    setTimeout(fn, ms) {
      const id = nextId++
      timers.set(id, { at: now + ms, fn })
      return id
    },
    clearTimeout: (id) => void timers.delete(id),
  }
  /** Advances the clock, running due timers and the async work they start. */
  async function advance(ms: number) {
    const end = now + ms
    for (;;) {
      await new Promise((r) => setTimeout(r, 0))
      const due = [...timers.entries()].filter(([, t]) => t.at <= end).sort((a, b) => a[1].at - b[1].at)[0]
      if (!due) break
      timers.delete(due[0])
      now = Math.max(now, due[1].at)
      due[1].fn()
    }
    now = end
    await new Promise((r) => setTimeout(r, 0))
  }
  return { env, advance, sent }
}

function start(corners: Corners | null) {
  const f = fakeEnv(corners)
  const state = { hint: null as Hint | null, present: false, shots: 0 }
  const c = new LiveController(f.env, {
    onState: (h, p) => {
      state.hint = h
      state.present = p
    },
    onAutoShot: () => state.shots++,
    autoShot: () => true,
  })
  return { ...f, c, state }
}

describe('live tracking without the developer option', () => {
  it('loads the model, runs detections and reports the paper', async () => {
    const { c, state, advance, sent } = start(SMALL)
    await advance(1000)
    expect(sent[0]).toBe('init')
    expect(sent.filter((t) => t === 'detect').length).toBeGreaterThan(10)
    expect(c.stats.status).toBe('running')
    expect(state.present).toBe(true)
    expect(c.target.corners).toEqual(SMALL)
    c.stop()
  })

  it('shows the "Move closer" hint and never auto-shoots a too-small page', async () => {
    const { c, state, advance } = start(SMALL)
    await advance(4000)
    expect(state.hint).toBe('closer')
    expect(state.shots).toBe(0)
    c.stop()
  })

  it('draws the frame: the overlay gets on-screen points and fades in', async () => {
    const { c, advance } = start(SMALL)
    await advance(500)
    const view = { width: 390, height: 600, videoWidth: 3024, videoHeight: 4032 }
    let q: QuadState = { points: null, opacity: 0 }
    for (let i = 0; i < 30; i++) q = stepQuad(q, c.target, view, 16, c.stats.intervalMs)
    expect(q.opacity).toBeGreaterThan(0.9)
    expect(q.points).toHaveLength(4)
    for (const p of q.points!) {
      expect(p.x).toBeGreaterThan(0)
      expect(p.x).toBeLessThan(390)
      expect(p.y).toBeGreaterThan(0)
      expect(p.y).toBeLessThan(600)
    }
    c.stop()
  })

  it('fades the frame out when the paper is gone', async () => {
    const { c, advance } = start(null)
    await advance(800)
    let q: QuadState = { points: null, opacity: 0.8 }
    for (let i = 0; i < 60; i++) q = stepQuad(q, c.target, { width: 390, height: 600, videoWidth: 3024, videoHeight: 4032 }, 16, 67)
    expect(q.opacity).toBeLessThan(0.02)
    c.stop()
  })

  it('the camera screen renders the frame and hints regardless of the developer option', () => {
    const src = readFileSync(new URL('../../screens/CameraScreen.tsx', import.meta.url), 'utf8')
    const quadLine = src.split('\n').find((l) => l.includes('<LiveQuad'))!
    const hintLine = src.split('\n').find((l) => l.includes('live.hint &&'))!
    for (const line of [quadLine, hintLine]) {
      expect(line).toBeDefined()
      expect(line).not.toMatch(/showStats|bench|getLiveStats|dev/i)
    }
    expect(src).toMatch(/useLiveTracking\(videoRef, state === 'live'/)
  })
})
