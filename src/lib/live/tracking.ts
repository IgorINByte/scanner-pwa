// Live preview tracking logic (pure, testable): turns the stream of light-model detections
// into a placement hint and the auto-shutter decision. Coordinates are frame pixels.
import type { Corners, Point } from '../../types'

/** The paper must span at least this share of the frame's shorter side. */
export const MIN_COVERAGE = 0.7
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

/** Paper extent along the frame's shorter axis, as a share of that side. */
export function coverage(c: Corners, f: Frame): number {
  const xs = c.map((p) => p.x)
  const ys = c.map((p) => p.y)
  return f.width <= f.height ? (Math.max(...xs) - Math.min(...xs)) / f.width : (Math.max(...ys) - Math.min(...ys)) / f.height
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

export interface TrackerOutput {
  /** Paper currently tracked (tolerates short misses). */
  present: boolean
  /** Hint to show, already debounced by HINT_DELAY_MS. */
  hint: Hint | null
  /** Auto-shutter should fire now (only reported once per placement). */
  shoot: boolean
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

  /** Feeds one detection result taken at time t (ms). `autoShot` false never reports `shoot`. */
  update(t: number, corners: Corners | null, f: Frame, autoShot = true): TrackerOutput {
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
      else if (coverage(c, f) < MIN_COVERAGE) cand = 'closer'
      else if (this.stillSince === null) cand = 'still'
    }
    if (cand !== this.candidate) {
      this.candidate = cand
      this.candidateSince = t
    }
    if (t - this.candidateSince >= HINT_DELAY_MS || cand === null) this.shown = cand

    const ready = present && cand === null && this.stillSince !== null && t - this.stillSince >= AUTO_SHOT_MS
    const shoot = ready && this.armed && autoShot
    if (shoot) this.shot()
    return { present, hint: this.shown, shoot }
  }

  /** Call after any shot (auto or manual) so the same placement is not shot again. */
  shot() {
    this.armed = false
    this.shotCorners = this.last
  }

  reset() {
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
