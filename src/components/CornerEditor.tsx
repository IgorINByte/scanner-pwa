import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react'
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
}

const PAD = 20 // keeps handles reachable
const HIT_RADIUS = 56 // px, how close a touch must be to grab a handle
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

/** Handles 0-3 are the corners, 4-7 the midpoints of the top, right, bottom and left sides. */
interface Drag {
  handle: number
  start: Point
  startCorners: Corners
}

export default function CornerEditor({ src, width, height, corners, onChange, onCommit }: Props) {
  const boxRef = useRef<HTMLDivElement>(null)
  const svgRef = useRef<SVGSVGElement>(null)
  const [box, setBox] = useState({ w: 0, h: 0 })
  const [drag, setDragState] = useState<Drag | null>(null)
  // Pointer events can arrive faster than React re-renders, so handlers read refs, not state.
  const dragRef = useRef<Drag | null>(null)
  const latest = useRef(corners)
  latest.current = corners
  const setDrag = (d: Drag | null) => {
    dragRef.current = d
    setDragState(d)
  }

  useEffect(() => {
    const el = boxRef.current!
    const ro = new ResizeObserver(([e]) => setBox({ w: e.contentRect.width, h: e.contentRect.height }))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // Leave room for corners up to CORNER_MARGIN outside the image.
  const grow = 1 + 2 * CORNER_MARGIN
  const fit = Math.min((box.w - PAD * 2) / (width * grow), (box.h - PAD * 2) / (height * grow))
  const dw = Math.max(0, width * fit)
  const dh = Math.max(0, height * fit)
  const k = fit > 0 ? 1 / fit : 1 // source px per screen px

  const handles = (c: Corners): Point[] => [...c, ...[0, 1, 2, 3].map((i) => sideMidpoint(c, i))]

  const toSource = (e: PointerEvent): Point => {
    const r = svgRef.current!.getBoundingClientRect()
    return { x: ((e.clientX - r.left) / r.width) * width, y: ((e.clientY - r.top) / r.height) * height }
  }

  /** New corners for handle `h` moved by `delta` from `start`. */
  const moved = (start: Corners, h: number, delta: Point): Corners => {
    if (h >= 4) return moveSide(start, h - 4, delta, width, height)
    const next = [...start] as Corners
    next[h] = clampToMargin({ x: start[h].x + delta.x, y: start[h].y + delta.y }, width, height)
    return next
  }

  const onDown = (e: PointerEvent<SVGSVGElement>) => {
    const p = toSource(e)
    let handle = -1
    let best = Infinity
    handles(corners).forEach((c, i) => {
      // Corners win when a corner and a midpoint are about equally close.
      const d = (Math.hypot(c.x - p.x, c.y - p.y) / k) * (i >= 4 ? 1.2 : 1)
      if (d < best) {
        best = d
        handle = i
      }
    })
    if (best > HIT_RADIUS) return
    e.currentTarget.setPointerCapture(e.pointerId)
    setDrag({ handle, start: p, startCorners: corners })
  }

  const onMove = (e: PointerEvent<SVGSVGElement>) => {
    const d = dragRef.current
    if (!d) return
    const p = toSource(e)
    const next = moved(d.startCorners, d.handle, { x: p.x - d.start.x, y: p.y - d.start.y })
    latest.current = next
    onChange(next)
  }

  const onUp = () => {
    if (dragRef.current) onCommit?.(latest.current)
    setDrag(null)
  }

  const onKey = (h: number) => (e: KeyboardEvent) => {
    const step = (e.shiftKey ? 20 : 4) * k
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
  const all = handles(corners)
  const active = drag ? all[drag.handle] : null
  // Show the loupe in the top corner away from the finger.
  const loupeLeft = active && active.x < width / 2 ? box.w - LOUPE - 8 : 8
  const mx = width * CORNER_MARGIN
  const my = height * CORNER_MARGIN

  return (
    <div ref={boxRef} className="relative flex size-full items-center justify-center overflow-hidden">
      {dw > 0 && (
        <div className="relative" style={{ width: dw, height: dh }}>
          <img src={src} alt="" draggable={false} className="absolute inset-0 size-full select-none" />
          <svg
            ref={svgRef}
            viewBox={`0 0 ${width} ${height}`}
            className="absolute inset-0 size-full touch-none overflow-visible"
            onPointerDown={onDown}
            onPointerMove={onMove}
            onPointerUp={onUp}
            onPointerCancel={onUp}
          >
            <path
              d={`M${-mx} ${-my}H${width + mx}V${height + my}H${-mx}Z M${poly.replace(/ /g, ' L')}Z`}
              fillRule="evenodd"
              fill="rgb(2 6 23 / 0.55)"
            />
            <polygon
              points={poly}
              fill={valid ? 'rgb(34 211 238 / 0.12)' : 'rgb(248 113 113 / 0.18)'}
              stroke={stroke}
              strokeWidth={2}
              vectorEffect="non-scaling-stroke"
            />
            {all.map((c, i) => {
              const side = i >= 4
              const r = (drag?.handle === i ? 16 : side ? 9 : 12) * k
              return (
                <circle
                  key={i}
                  tabIndex={0}
                  role="slider"
                  aria-label={side ? `${SIDE_NAMES[i - 4]} edge` : `${CORNER_NAMES[i]} corner`}
                  aria-valuetext={`${Math.round(c.x)}, ${Math.round(c.y)}`}
                  onKeyDown={onKey(i)}
                  className="outline-none focus-visible:stroke-white"
                  cx={c.x}
                  cy={c.y}
                  r={r}
                  fill={side ? 'rgb(255 255 255 / 0.5)' : 'rgb(255 255 255 / 0.25)'}
                  stroke={stroke}
                  strokeWidth={side ? 2 : 3}
                  vectorEffect="non-scaling-stroke"
                />
              )
            })}
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
            backgroundSize: `${dw * ZOOM}px ${dh * ZOOM}px`,
            backgroundPosition: `${LOUPE / 2 - (active.x / k) * ZOOM}px ${LOUPE / 2 - (active.y / k) * ZOOM}px`,
          }}
        >
          <span className="absolute top-1/2 left-1/2 h-px w-5 -translate-x-1/2 bg-cyan-300" />
          <span className="absolute top-1/2 left-1/2 h-5 w-px -translate-y-1/2 bg-cyan-300" />
        </div>
      )}
    </div>
  )
}
