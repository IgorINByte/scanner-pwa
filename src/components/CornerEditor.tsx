import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent, type WheelEvent } from 'react'
import { clampToMargin, CORNER_MARGIN, moveSide, sideMidpoint } from '../lib/geometry'
import { isValidQuad } from '../lib/imaging/refine'
import type { Corners, Point } from '../types'

interface Props {
  src: string
  width: number
  height: number
  corners: Corners
  onChange: (c: Corners) => void
  /** Called once when a drag ends, with the final corners. */
  onCommit?: (c: Corners) => void
  /** Changing this zooms the view onto the current frame (after a detection). */
  fitKey?: number
}

// Visible handles are small; the touch area around them is larger and invisible.
const RING = 11 // px, corner ring radius (22 px across)
const TICK = 9 // px, half length of the side-midpoint tick
const HIT = 24 // px, touch radius (48 px across)
const MIN_SIDE = 90 // px, sides shorter than this on screen hide their midpoint handle
const FIT_SHARE = 0.7 // the frame fills this share of the view after a fit
const LOUPE = 112
const ZOOM = 2.5
const CORNER_NAMES = ['Top-left', 'Top-right', 'Bottom-right', 'Bottom-left']
const SIDE_NAMES = ['Top', 'Right', 'Bottom', 'Left']

/** Strictly convex quad (used by the ground-truth harness). */
export function isConvex(c: Corners) {
  let sign = 0
  for (let i = 0; i < 4; i++) {
    const a = c[i]
    const b = c[(i + 1) % 4]
    const d = c[(i + 2) % 4]
    const cross = (b.x - a.x) * (d.y - b.y) - (b.y - a.y) * (d.x - b.x)
    if (Math.abs(cross) < 1e-6) return false
    if (sign === 0) sign = Math.sign(cross)
    else if (Math.sign(cross) !== sign) return false
  }
  return true
}

/** Usable quad: convex, not crossed, at least 3 % of the image, corners within the margin. */
export const isValidCrop = (c: Corners, width: number, height: number) => isValidQuad(c, width, height)

/** Screen px = source px * s + (tx, ty), relative to the editor box. */
interface View {
  s: number
  tx: number
  ty: number
}

/** Handles 0-3 are the corners, 4-7 the midpoints of the top, right, bottom and left sides. */
type Gesture =
  | { kind: 'handle'; handle: number; start: Point; startCorners: Corners }
  | { kind: 'pinch'; ids: [number, number]; p0: [Point, Point]; view0: View }
  | { kind: 'pan'; start: Point; view0: View }

const dist = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y)

export default function CornerEditor({ src, width, height, corners, onChange, onCommit, fitKey = 0 }: Props) {
  const boxRef = useRef<HTMLDivElement>(null)
  const [box, setBox] = useState({ w: 0, h: 0 })
  const [view, setViewState] = useState<View | null>(null)
  const [gesture, setGestureState] = useState<Gesture | null>(null)
  // Pointer events can arrive faster than React re-renders, so handlers read refs, not state.
  const viewRef = useRef<View | null>(null)
  const gestureRef = useRef<Gesture | null>(null)
  const pointers = useRef(new Map<number, Point>())
  const latest = useRef(corners)
  latest.current = corners
  /** The user zoomed or panned since the last automatic fit. */
  const userMoved = useRef(false)
  const fitted = useRef<number | null>(null)

  const setView = (v: View) => {
    viewRef.current = v
    setViewState(v)
  }
  const setGesture = (g: Gesture | null) => {
    gestureRef.current = g
    setGestureState(g)
  }

  useEffect(() => {
    const el = boxRef.current!
    const ro = new ResizeObserver(([e]) => setBox({ w: e.contentRect.width, h: e.contentRect.height }))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // Zoom limits: from half of "whole image fits" to 12x that.
  const fitAll = box.w > 0 ? Math.min(box.w / (width * (1 + 2 * CORNER_MARGIN)), box.h / (height * (1 + 2 * CORNER_MARGIN))) : 1
  const clampScale = (s: number) => Math.min(fitAll * 12, Math.max(fitAll * 0.5, s))

  /** Keeps the box centre over the image (plus its margin), so the photo cannot be lost. */
  const clampView = (v: View): View => {
    const mx = width * CORNER_MARGIN * v.s
    const my = height * CORNER_MARGIN * v.s
    const cx = box.w / 2
    const cy = box.h / 2
    return {
      s: v.s,
      tx: Math.min(cx + mx, Math.max(cx - width * v.s - mx, v.tx)),
      ty: Math.min(cy + my, Math.max(cy - height * v.s - my, v.ty)),
    }
  }

  // Fit the frame to ~70 % of the view: on first show, after a detection (fitKey), and on
  // resize unless the user has zoomed or panned since.
  useEffect(() => {
    if (box.w <= 0 || box.h <= 0) return
    if (fitted.current === fitKey && userMoved.current && viewRef.current) return
    const c = latest.current
    const xs = c.map((p) => p.x)
    const ys = c.map((p) => p.y)
    const bw = Math.max(1, Math.max(...xs) - Math.min(...xs))
    const bh = Math.max(1, Math.max(...ys) - Math.min(...ys))
    const s = clampScale(FIT_SHARE * Math.min(box.w / bw, box.h / bh))
    const cx = (Math.max(...xs) + Math.min(...xs)) / 2
    const cy = (Math.max(...ys) + Math.min(...ys)) / 2
    setView(clampView({ s, tx: box.w / 2 - cx * s, ty: box.h / 2 - cy * s }))
    fitted.current = fitKey
    userMoved.current = false
  }, [fitKey, box.w, box.h, width, height])

  const v = view ?? { s: fitAll, tx: 0, ty: 0 }
  const toScreen = (p: Point): Point => ({ x: p.x * v.s + v.tx, y: p.y * v.s + v.ty })

  const local = (e: { clientX: number; clientY: number }): Point => {
    const r = boxRef.current!.getBoundingClientRect()
    return { x: e.clientX - r.left, y: e.clientY - r.top }
  }
  const toSource = (p: Point, vw: View): Point => ({ x: (p.x - vw.tx) / vw.s, y: (p.y - vw.ty) / vw.s })

  /** Corner handles, then side midpoints; null where a side is too short on screen. */
  const handlePoints = (c: Corners, vw: View): (Point | null)[] => [
    ...c,
    ...[0, 1, 2, 3].map((i) => (dist(c[i], c[(i + 1) % 4]) * vw.s >= MIN_SIDE ? sideMidpoint(c, i) : null)),
  ]

  /** New corners for handle `h` moved by `delta` (source px) from `start`. */
  const moved = (start: Corners, h: number, delta: Point): Corners => {
    if (h >= 4) return moveSide(start, h - 4, delta, width, height)
    const next = [...start] as Corners
    next[h] = clampToMargin({ x: start[h].x + delta.x, y: start[h].y + delta.y }, width, height)
    return next
  }

  const endHandle = () => {
    const g = gestureRef.current
    if (g?.kind === 'handle') onCommit?.(latest.current)
  }

  const onDown = (e: PointerEvent<HTMLDivElement>) => {
    const vw = viewRef.current
    if (!vw) return
    e.currentTarget.setPointerCapture(e.pointerId)
    const p = local(e)
    pointers.current.set(e.pointerId, p)

    if (pointers.current.size >= 2) {
      // A second finger: stop any handle drag and zoom/pan with both fingers.
      endHandle()
      const [a, b] = [...pointers.current.entries()].slice(-2)
      setGesture({ kind: 'pinch', ids: [a[0], b[0]], p0: [a[1], b[1]], view0: vw })
      return
    }

    // The handle nearest to the finger wins when touch areas overlap.
    let handle = -1
    let best = Infinity
    handlePoints(latest.current, vw).forEach((h, i) => {
      if (!h) return
      const d = dist(toScreen(h), p)
      if (d < best) {
        best = d
        handle = i
      }
    })
    if (best <= HIT) setGesture({ kind: 'handle', handle, start: toSource(p, vw), startCorners: latest.current })
    else if (e.pointerType === 'mouse') setGesture({ kind: 'pan', start: p, view0: vw })
  }

  const onMove = (e: PointerEvent<HTMLDivElement>) => {
    if (!pointers.current.has(e.pointerId)) return
    const p = local(e)
    pointers.current.set(e.pointerId, p)
    const g = gestureRef.current
    if (!g) return
    if (g.kind === 'handle') {
      const q = toSource(p, viewRef.current!)
      const next = moved(g.startCorners, g.handle, { x: q.x - g.start.x, y: q.y - g.start.y })
      latest.current = next
      onChange(next)
    } else if (g.kind === 'pinch') {
      const a = pointers.current.get(g.ids[0])
      const b = pointers.current.get(g.ids[1])
      if (!a || !b) return
      const d0 = Math.max(1, dist(g.p0[0], g.p0[1]))
      const m0 = { x: (g.p0[0].x + g.p0[1].x) / 2, y: (g.p0[0].y + g.p0[1].y) / 2 }
      const m = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
      const s = clampScale((g.view0.s * dist(a, b)) / d0)
      // Keep the image point that was under the fingers' midpoint under it.
      const anchor = toSource(m0, g.view0)
      setView(clampView({ s, tx: m.x - anchor.x * s, ty: m.y - anchor.y * s }))
      userMoved.current = true
    } else {
      setView(clampView({ ...g.view0, tx: g.view0.tx + p.x - g.start.x, ty: g.view0.ty + p.y - g.start.y }))
      userMoved.current = true
    }
  }

  const onUp = (e: PointerEvent<HTMLDivElement>) => {
    pointers.current.delete(e.pointerId)
    const g = gestureRef.current
    if (!g) return
    if (g.kind === 'pinch') {
      // Lifting one finger ends the pinch; the remaining finger does nothing until lifted.
      if (pointers.current.size < 2) setGesture(null)
      return
    }
    endHandle()
    setGesture(null)
  }

  const onWheel = (e: WheelEvent<HTMLDivElement>) => {
    const vw = viewRef.current
    if (!vw) return
    const p = local(e)
    const s = clampScale(vw.s * Math.exp(-e.deltaY * 0.0015))
    const anchor = toSource(p, vw)
    setView(clampView({ s, tx: p.x - anchor.x * s, ty: p.y - anchor.y * s }))
    userMoved.current = true
  }

  const onKey = (h: number) => (e: KeyboardEvent) => {
    const step = (e.shiftKey ? 20 : 4) / v.s
    const d = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key]
    if (!d) return
    e.preventDefault()
    const next = moved(corners, h, { x: d[0], y: d[1] })
    onChange(next)
    onCommit?.(next)
  }

  const valid = isValidCrop(corners, width, height)
  const stroke = valid ? '#22d3ee' : '#f87171'
  const poly = corners.map((c) => `${c.x},${c.y}`).join(' ')
  const handles = handlePoints(corners, v)
  const activeIndex = gesture?.kind === 'handle' ? gesture.handle : -1
  const active = activeIndex >= 0 ? handles[activeIndex] : null
  const activeScreen = active ? toScreen(active) : null
  // Show the loupe in the top corner away from the finger.
  const loupeLeft = activeScreen && activeScreen.x < box.w / 2 ? box.w - LOUPE - 8 : 8
  const px = 1 / v.s // one screen pixel in source units
  const far = Math.max(width, height) * 4

  return (
    <div
      ref={boxRef}
      className="relative size-full touch-none overflow-hidden select-none"
      onPointerDown={onDown}
      onPointerMove={onMove}
      onPointerUp={onUp}
      onPointerCancel={onUp}
      onWheel={onWheel}
    >
      {view && (
        <div className="absolute top-0 left-0" style={{ width: width * v.s, height: height * v.s, transform: `translate(${v.tx}px, ${v.ty}px)` }}>
          <img src={src} alt="" draggable={false} className="absolute inset-0 size-full max-w-none" />
          <svg viewBox={`0 0 ${width} ${height}`} className="pointer-events-none absolute inset-0 size-full overflow-visible">
            <path
              d={`M${-far} ${-far}H${width + far}V${height + far}H${-far}Z M${poly.replace(/ /g, ' L')}Z`}
              fillRule="evenodd"
              fill="rgb(2 6 23 / 0.55)"
            />
            <polygon
              points={poly}
              fill={valid ? 'rgb(34 211 238 / 0.08)' : 'rgb(248 113 113 / 0.18)'}
              stroke={stroke}
              strokeWidth={2}
              vectorEffect="non-scaling-stroke"
            />
            {handles.map((h, i) => {
              if (!h) return null
              const on = i === activeIndex
              if (i < 4)
                return (
                  <g key={i}>
                    <circle cx={h.x} cy={h.y} r={RING * px} fill="none" stroke="rgb(0 0 0 / 0.45)" strokeWidth={4} vectorEffect="non-scaling-stroke" />
                    <circle cx={h.x} cy={h.y} r={RING * px} fill="none" stroke={on ? '#fff' : stroke} strokeWidth={2} vectorEffect="non-scaling-stroke" />
                  </g>
                )
              const a = corners[i - 4]
              const b = corners[(i - 3) % 4]
              const len = dist(a, b) || 1
              const ux = ((b.x - a.x) / len) * TICK * px
              const uy = ((b.y - a.y) / len) * TICK * px
              return (
                <g key={i}>
                  <line x1={h.x - ux} y1={h.y - uy} x2={h.x + ux} y2={h.y + uy} stroke="rgb(0 0 0 / 0.45)" strokeWidth={7} strokeLinecap="round" vectorEffect="non-scaling-stroke" />
                  <line x1={h.x - ux} y1={h.y - uy} x2={h.x + ux} y2={h.y + uy} stroke={on ? '#fff' : stroke} strokeWidth={4} strokeLinecap="round" vectorEffect="non-scaling-stroke" />
                </g>
              )
            })}
            {/* Invisible, focusable touch areas for keyboard and screen-reader users. */}
            {handles.map((h, i) =>
              h ? (
                <circle
                  key={`k${i}`}
                  tabIndex={0}
                  role="slider"
                  aria-label={i >= 4 ? `${SIDE_NAMES[i - 4]} edge` : `${CORNER_NAMES[i]} corner`}
                  aria-valuetext={`${Math.round(h.x)}, ${Math.round(h.y)}`}
                  onKeyDown={onKey(i)}
                  className="outline-none focus-visible:stroke-white"
                  cx={h.x}
                  cy={h.y}
                  r={HIT * px}
                  fill="transparent"
                  stroke="transparent"
                  strokeWidth={2}
                  vectorEffect="non-scaling-stroke"
                />
              ) : null,
            )}
          </svg>
        </div>
      )}

      {active && (
        <div
          className={`pointer-events-none absolute top-2 overflow-hidden rounded-full border-2 bg-slate-900 shadow-xl ${valid ? 'border-cyan-400' : 'border-red-400'}`}
          style={{
            left: loupeLeft,
            width: LOUPE,
            height: LOUPE,
            backgroundImage: `url(${src})`,
            backgroundRepeat: 'no-repeat',
            backgroundSize: `${width * v.s * ZOOM}px ${height * v.s * ZOOM}px`,
            backgroundPosition: `${LOUPE / 2 - active.x * v.s * ZOOM}px ${LOUPE / 2 - active.y * v.s * ZOOM}px`,
          }}
        >
          <span className="absolute top-1/2 left-1/2 h-px w-5 -translate-x-1/2 bg-cyan-300" />
          <span className="absolute top-1/2 left-1/2 h-5 w-px -translate-y-1/2 bg-cyan-300" />
        </div>
      )}
    </div>
  )
}
