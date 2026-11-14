// Live tracking loop, independent of React and of any developer option, so it can be tested
// with a fake worker and fake frames. The React hook (useLiveTracking) only wires it to the
// <video>, the page visibility and component state.
import type { Corners } from '../../types'
import type { LiveRequest, LiveResponse } from '../../workers/live.worker'
import { requiredPaperPx, Tracker, type Frame, type Hint, type Rgb } from './tracking'

export const MAX_RATE = 15
/** Below this rate the phone counts as slow and the interval is stretched. */
const SLOW_RATE = 5
const MAX_INTERVAL_MS = 1000
/** Model download/compile taking longer than this is retried once. */
const INIT_TIMEOUT_MS = 20000

export interface LiveTarget {
  /** Latest tracked corners in frame pixels (null: no paper). */
  corners: Corners | null
  frame: Frame | null
}

export interface LiveStats {
  status: 'loading' | 'running' | 'paused' | 'error'
  error?: string
  loadMs?: number
  /** Detections in the last second. */
  fps: number
  /** Mean model time in the worker, ms. */
  inferMs: number
  /** Mean grab + transfer + model + reply, ms. */
  totalMs: number
  /** Current pause between detection starts, ms. */
  intervalMs: number
  frame?: Frame
  source?: Frame
  paperPx?: number
  requiredPx?: number
  color?: Rgb
  settled?: boolean
  /** Detections that found paper / all, since start. */
  found?: number
  total?: number
}

/** What the controller needs from its environment (browser in the app, fakes in tests). */
export interface LiveEnv {
  worker: Pick<Worker, 'postMessage' | 'terminate'> & { onmessage: ((e: MessageEvent<LiveResponse>) => void) | null }
  /** Grabs a small copy of the current preview; null while the camera has no frame yet. */
  grab(): Promise<{ frame: ImageBitmap; color?: Rgb; source: Frame } | null>
  now(): number
  hidden(): boolean
  setTimeout(fn: () => void, ms: number): number
  clearTimeout(id: number): void
  log?(msg: string, err?: unknown): void
}

export interface LiveCallbacks {
  /** Hint / presence changed (call sites store these in React state). */
  onState(hint: Hint | null, present: boolean): void
  onAutoShot(): void
  autoShot(): boolean
}

export class LiveController {
  readonly target: LiveTarget = { corners: null, frame: null }
  stats: LiveStats = { status: 'loading', fps: 0, inferMs: 0, totalMs: 0, intervalMs: 1000 / MAX_RATE, found: 0, total: 0 }
  readonly tracker = new Tracker()
  private stopped = false
  private busy = false
  private ready = false
  private timer = 0
  private initTimer = 0
  private retried = false
  private startedAt = 0
  private interval = 1000 / MAX_RATE
  private samples: { t: number; infer: number; total: number }[] = []
  private source: Frame | null = null
  private color: Rgb | undefined

  constructor(
    private env: LiveEnv,
    private cb: LiveCallbacks,
  ) {
    env.worker.onmessage = (e) => this.onMessage(e.data)
    this.init()
  }

  private init() {
    this.env.worker.postMessage({ type: 'init' } satisfies LiveRequest)
    this.initTimer = this.env.setTimeout(() => {
      if (this.ready || this.stopped) return
      this.env.log?.('[live] model init timed out')
      if (!this.retried) {
        this.retried = true
        this.init()
      } else this.stats = { ...this.stats, status: 'error', error: 'Live model did not load' }
    }, INIT_TIMEOUT_MS)
  }

  private schedule(delay: number) {
    this.env.clearTimeout(this.timer)
    this.timer = this.env.setTimeout(() => void this.step(), Math.max(0, delay))
  }

  async step() {
    if (this.stopped || this.busy || !this.ready) return
    if (this.env.hidden()) {
      this.stats = { ...this.stats, status: 'paused' }
      return // resumed by setHidden(false)
    }
    this.busy = true
    let grabbed: Awaited<ReturnType<LiveEnv['grab']>>
    try {
      grabbed = await this.env.grab()
    } catch (e) {
      this.env.log?.('[live] frame grab failed', e)
      grabbed = null
    }
    if (!grabbed) {
      this.busy = false
      return this.schedule(200)
    }
    if (this.stopped) return grabbed.frame.close()
    this.source = grabbed.source
    this.color = grabbed.color
    this.startedAt = this.env.now()
    this.env.worker.postMessage({ type: 'detect', frame: grabbed.frame } satisfies LiveRequest, [grabbed.frame])
  }

  private onMessage(m: LiveResponse) {
    if (this.stopped) return
    if (m.type === 'ready') {
      if (this.ready) return
      this.ready = true
      this.env.clearTimeout(this.initTimer)
      this.stats = { ...this.stats, status: 'running', loadMs: m.ms }
      void this.step()
      return
    }
    this.busy = false
    if (m.type === 'error') {
      this.env.log?.(`[live] ${m.error}`)
      this.stats = { ...this.stats, status: 'error', error: m.error }
      if (!this.ready) return // init failed: the timeout retries once
      return this.schedule(1000)
    }
    const now = this.env.now()
    const total = now - this.startedAt
    const s = this.samples
    s.push({ t: now, infer: m.ms, total })
    while (s.length && now - s[0].t > 1000) s.shift()
    const mean = (f: (x: (typeof s)[number]) => number) => s.reduce((a, x) => a + f(x), 0) / s.length
    const meanTotal = mean((x) => x.total)
    // Slow phone (< SLOW_RATE/s even back to back): leave the main thread room for the preview.
    this.interval = meanTotal > 1000 / SLOW_RATE ? Math.min(MAX_INTERVAL_MS, meanTotal * 2) : 1000 / MAX_RATE

    const frame = { width: m.width, height: m.height }
    const source = this.source ?? frame
    const out = this.tracker.update(now, m.corners, frame, { source, color: this.color, autoShot: this.cb.autoShot() })
    this.stats = {
      status: 'running',
      loadMs: this.stats.loadMs,
      fps: s.length,
      inferMs: mean((x) => x.infer),
      totalMs: meanTotal,
      intervalMs: this.interval,
      frame,
      source,
      paperPx: out.paperPx,
      requiredPx: requiredPaperPx(source),
      color: this.color,
      settled: out.settled,
      found: (this.stats.found ?? 0) + (m.corners ? 1 : 0),
      total: (this.stats.total ?? 0) + 1,
    }
    this.target.corners = out.present ? (m.corners ?? this.target.corners) : null
    this.target.frame = frame
    this.cb.onState(out.hint, out.present)
    if (out.shoot) this.cb.onAutoShot()
    if (!this.env.hidden()) this.schedule(this.interval - total)
  }

  /** Page hidden (background, screen locked): stop; visible again: resume from scratch. */
  setHidden(hidden: boolean) {
    if (hidden) {
      this.env.clearTimeout(this.timer)
      this.clear()
    } else {
      this.stats = { ...this.stats, status: this.ready ? 'running' : this.stats.status }
      this.samples = []
      this.schedule(0)
    }
  }

  private clear() {
    this.target.corners = null
    this.target.frame = null
    this.tracker.reset()
    this.cb.onState(null, false)
  }

  stop() {
    this.stopped = true
    this.env.clearTimeout(this.timer)
    this.env.clearTimeout(this.initTimer)
    this.env.worker.terminate()
    this.clear()
  }
}
