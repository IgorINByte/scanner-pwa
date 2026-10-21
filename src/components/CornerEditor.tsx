import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react'
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

const PAD = 20 // keeps handles on the image edge reachable
const HIT_RADIUS = 56 // px, how close a touch must be to grab a corner
const LOUPE = 112
const ZOOM = 2.5

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

export default function CornerEditor({ src, width, height, corners, onChange, onCommit }: Props) {
  const boxRef = useRef<HTMLDivElement>(null)
  const svgRef = useRef<SVGSVGElement>(null)
  const [box, setBox] = useState({ w: 0, h: 0 })
  const [drag, setDragState] = useState<{ index: number; offset: Point } | null>(null)
  // Pointer events can arrive faster than React re-renders, so handlers read refs, not state.
  const dragRef = useRef<{ index: number; offset: Point } | null>(null)
  const latest = useRef(corners)
  latest.current = corners
  const setDrag = (d: { index: number; offset: Point } | null) => {
    dragRef.current = d
    setDragState(d)
  }

  useEffect(() => {
    const el = boxRef.current!
    const ro = new ResizeObserver(([e]) => setBox({ w: e.contentRect.width, h: e.contentRect.height }))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const fit = Math.min((box.w - PAD * 2) / width, (box.h - PAD * 2) / height)
  const dw = Math.max(0, width * fit)
  const dh = Math.max(0, height * fit)
  const k = fit > 0 ? 1 / fit : 1 // source px per screen px

  const toSource = (e: PointerEvent): Point => {
    const r = svgRef.current!.getBoundingClientRect()
    return { x: ((e.clientX - r.left) / r.width) * width, y: ((e.clientY - r.top) / r.height) * height }
  }

  const onDown = (e: PointerEvent<SVGSVGElement>) => {
    const p = toSource(e)
    let index = -1
    let best = Infinity
    corners.forEach((c, i) => {
      const d = Math.hypot(c.x - p.x, c.y - p.y) / k
      if (d < best) {
        best = d
        index = i
      }
    })
    if (best > HIT_RADIUS) return
    e.currentTarget.setPointerCapture(e.pointerId)
    setDrag({ index, offset: { x: corners[index].x - p.x, y: corners[index].y - p.y } })
  }

  const onMove = (e: PointerEvent<SVGSVGElement>) => {
    const d = dragRef.current
    if (!d) return
    const p = toSource(e)
    const next = [...latest.current] as Corners
    next[d.index] = {
      x: Math.min(width, Math.max(0, p.x + d.offset.x)),
      y: Math.min(height, Math.max(0, p.y + d.offset.y)),
    }
    latest.current = next
    onChange(next)
  }

  const onUp = () => {
    if (dragRef.current) onCommit?.(latest.current)
    setDrag(null)
  }

  const valid = isConvex(corners)
  const poly = corners.map((c) => `${c.x},${c.y}`).join(' ')
  const active = drag ? corners[drag.index] : null
  // Show the loupe on the side away from the finger.
  const loupeLeft = active && active.x < width / 2 ? box.w - LOUPE - 8 : 8

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
              d={`M0 0H${width}V${height}H0Z M${poly.replace(/ /g, ' L')}Z`}
              fillRule="evenodd"
              fill="rgb(2 6 23 / 0.55)"
            />
            <polygon
              points={poly}
              fill={valid ? 'rgb(34 211 238 / 0.12)' : 'rgb(248 113 113 / 0.18)'}
              stroke={valid ? '#22d3ee' : '#f87171'}
              strokeWidth={2}
              vectorEffect="non-scaling-stroke"
            />
            {corners.map((c, i) => (
              <circle
                tabIndex={0}
                role="slider"
                aria-label={`${['Top-left', 'Top-right', 'Bottom-right', 'Bottom-left'][i]} corner`}
                aria-valuetext={`${Math.round(c.x)}, ${Math.round(c.y)}`}
                onKeyDown={(e: KeyboardEvent) => {
                  const step = (e.shiftKey ? 20 : 4) * k
                  const d = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key]
                  if (!d) return
                  e.preventDefault()
                  const next = [...corners] as Corners
                  next[i] = { x: Math.min(width, Math.max(0, c.x + d[0])), y: Math.min(height, Math.max(0, c.y + d[1])) }
                  onChange(next)
                  onCommit?.(next)
                }}
                className="outline-none focus-visible:stroke-white"
                key={i}
                cx={c.x}
                cy={c.y}
                r={(drag?.index === i ? 16 : 12) * k}
                fill="rgb(255 255 255 / 0.25)"
                stroke={valid ? '#22d3ee' : '#f87171'}
                strokeWidth={3}
                vectorEffect="non-scaling-stroke"
              />
            ))}
          </svg>
        </div>
      )}

      {active && (
        <div
          className="pointer-events-none absolute top-2 overflow-hidden rounded-full border-2 border-cyan-400 bg-slate-900 shadow-xl"
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
