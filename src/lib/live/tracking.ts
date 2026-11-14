// Live preview tracking logic (pure, testable): turns the stream of light-model detections
// into a placement hint and the auto-shutter decision. Corners are in live-frame pixels
// (the ~256 px copy); `source` is the full camera frame that will actually be captured.
import type { Corners, Point } from '../../types'

/** Long side of the paper in the captured frame needed for a 200 dpi A4 page (2339 px). */
export const MIN_PAPER_PX = 2300
/** Cameras that cannot reach MIN_PAPER_PX need the paper to fill this share of their long side. */
const LOW_RES_SHARE = 0.75
/** No auto shot this soon after the camera started (exposure and white balance still settling). */
export const SETTLE_MIN_MS = 1500
/** The preview's mean colour must stay within this chroma change for SETTLE_STABLE_MS. */
export const SETTLE_CHROMA = 0.02
export const SETTLE_STABLE_MS = 1000
/** Max corner shift between two detections (share of the frame diagonal) that still counts as still. */
export const STILL_MOTION = 0.015
/** A hint is shown only after the same state lasted this long. */
export const HINT_DELAY_MS = 500
/** Auto-shutter fires after the frame was still and well placed this long. */
export const AUTO_SHOT_MS = 1000
/** A missed detection shorter than this does not count as "paper gone". */
export const MISS_GRACE_MS = 300
/** After a shot, the next auto shot needs the paper gone for this long, or moved this much. */
const REARM_GONE_MS = 300
const REARM_MOTION = 0.08

export type Hint = 'closer' | 'rotate' | 'still'

export interface Frame {
  width: number
  height: number
}

const dist = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y)

/** Longest side of the paper, converted to pixels of the captured (source) frame. */
export function paperLongSidePx(c: Corners, f: Frame, source: Frame): number {
  const k = Math.max(source.width, source.height) / Math.max(f.width, f.height)
  return Math.max(dist(c[0], c[1]), dist(c[1], c[2]), dist(c[2], c[3]), dist(c[3], c[0])) * k
}

/** Paper long side needed in the source frame (MIN_PAPER_PX, less on low-resolution cameras). */
export function requiredPaperPx(source: Frame): number {
  return Math.min(MIN_PAPER_PX, Math.max(source.width, source.height) * LOW_RES_SHARE)
}

/** The one size test used by both the "Move closer" hint and the auto-shutter. */
export function bigEnough(c: Corners, f: Frame, source: Frame): boolean {
  return paperLongSidePx(c, f, source) >= requiredPaperPx(source)
}

/** Mean colour of a preview frame, 0..255 per channel. */
export type Rgb = [number, number, number]

/** Chroma of a colour as (r/sum, b/sum): unaffected by plain brightness changes. */
const chroma = ([r, g, b]: Rgb) => {
  const s = Math.max(1, r + g + b)
  return [r / s, b / s] as const
}

/** Paper is landscape while the frame is portrait, or the other way round (10 % margin). */
export function orientationMismatch(c: Corners, f: Frame): boolean {
  const w = (dist(c[0], c[1]) + dist(c[3], c[2])) / 2
  const h = (dist(c[0], c[3]) + dist(c[1], c[2])) / 2
  const frameLandscape = f.width > f.height
  return frameLandscape ? h > w * 1.1 : w > h * 1.1
}

/** Largest corner shift between two detections, as a share of the frame diagonal. */
export function motion(a: Corners, b: Corners, f: Frame): number {
  const diag = Math.hypot(f.width, f.height)
  return Math.max(...a.map((p, i) => dist(p, b[i]))) / diag
}

export interface TrackerInput {
  /** The full camera frame the shot will be taken from. */
  source: Frame
  /** Mean colour of this preview frame (white balance / exposure settling check). */
  color?: Rgb
  /** Auto-shutter enabled; false never reports `shoot`. */
  autoShot?: boolean
}

export interface TrackerOutput {
  /** Paper currently tracked (tolerates short misses). */
  present: boolean
  /** Hint to show, already debounced by HINT_DELAY_MS. */
  hint: Hint | null
  /** Auto-shutter should fire now (only reported once per placement). */
  shoot: boolean
  /** Camera exposure / white balance considered settled. */
  settled: boolean
  /** Paper long side in source pixels (0 without paper), for the developer readout. */
  paperPx: number
}

export class Tracker {
  private last: Corners | null = null
  private lastSeen = -Infinity
  private stillSince: number | null = null
  private candidate: Hint | null = null
  private candidateSince = 0
  private shown: Hint | null = null
  private shotCorners: Corners | null = null
  private armed = true
  private startedAt: number | null = null
  private colors: { t: number; c: readonly [number, number] }[] = []

  /** Colour stayed steady for SETTLE_STABLE_MS and the camera runs for SETTLE_MIN_MS. */
  private settledAt(t: number, color: Rgb | undefined): boolean {
    this.startedAt ??= t
    if (!color) return t - this.startedAt >= SETTLE_MIN_MS
    this.colors.push({ t, c: chroma(color) })
    while (this.colors.length > 1 && t - this.colors[1].t >= SETTLE_STABLE_MS) this.colors.shift()
    if (t - this.startedAt < SETTLE_MIN_MS || t - this.colors[0].t < SETTLE_STABLE_MS) return false
    const now = this.colors[this.colors.length - 1].c
    return this.colors.every((x) => Math.abs(x.c[0] - now[0]) <= SETTLE_CHROMA && Math.abs(x.c[1] - now[1]) <= SETTLE_CHROMA)
  }

  /** Feeds one detection result taken at time t (ms). */
  update(t: number, corners: Corners | null, f: Frame, input: TrackerInput): TrackerOutput {
    const settled = this.settledAt(t, input.color)
    if (corners) {
      if (this.last && motion(this.last, corners, f) <= STILL_MOTION) this.stillSince ??= t
      else this.stillSince = this.last ? null : t
      this.last = corners
      this.lastSeen = t
    } else if (t - this.lastSeen > MISS_GRACE_MS) {
      this.last = null
      this.stillSince = null
    }
    const present = !!this.last

    // Re-arm the auto-shutter once the paper left or clearly moved since the last shot.
    if (!this.armed) {
      if (!present ? t - this.lastSeen > REARM_GONE_MS : this.shotCorners && motion(this.shotCorners, this.last!, f) > REARM_MOTION) {
        this.armed = true
        this.shotCorners = null
      }
    }

    let cand: Hint | null = null
    if (present) {
      const c = this.last!
      if (orientationMismatch(c, f)) cand = 'rotate'
      else if (!bigEnough(c, f, input.source)) cand = 'closer'
      else if (this.stillSince === null) cand = 'still'
    }
    if (cand !== this.candidate) {
      this.candidate = cand
      this.candidateSince = t
    }
    if (t - this.candidateSince >= HINT_DELAY_MS || cand === null) this.shown = cand

    // cand === null already implies bigEnough(): hint and shutter share the same test.
    const ready = present && cand === null && settled && this.stillSince !== null && t - this.stillSince >= AUTO_SHOT_MS
    const shoot = ready && this.armed && input.autoShot !== false
    if (shoot) this.shot()
    const paperPx = present ? paperLongSidePx(this.last!, f, input.source) : 0
    return { present, hint: this.shown, shoot, settled, paperPx }
  }

  /** Call after any shot (auto or manual) so the same placement is not shot again. */
  shot() {
    this.armed = false
    this.shotCorners = this.last
  }

  reset() {
    this.startedAt = null
    this.colors = []
    this.last = null
    this.lastSeen = -Infinity
    this.stillSince = null
    this.candidate = null
    this.shown = null
  }
}

export const HINT_TEXT: Record<Hint, string> = {
  closer: 'Move closer',
  rotate: 'Rotate the phone',
  still: 'Hold still',
}
