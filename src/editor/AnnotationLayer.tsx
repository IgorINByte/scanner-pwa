import { useRef, useState, type PointerEvent as RPointerEvent } from 'react'
import { HIGHLIGHT_OPACITY, FONT_STACK, watermarkPlacement } from '../lib/annotations/canvas'
import { uid } from '../lib/uid'
import type { Annotation, Watermark } from '../types'

export type Tool = 'select' | 'pen' | 'highlight' | 'underline' | 'rect' | 'text' | 'eraser'

const W = 1000 // SVG units across the page width

interface Props {
  aspect: number // height / width
  annotations: Annotation[]
  watermark: Watermark | null
  tool: Tool
  color: string
  size: number
  selectedId: string | null
  onSelect: (id: string | null) => void
  onChange: (list: Annotation[], merge?: string) => void
  onTextAt: (x: number, y: number) => void
}

type Drag =
  | { kind: 'draw'; a: Annotation }
  | { kind: 'move'; id: string; start: { x: number; y: number }; orig: Annotation }
  | { kind: 'resize'; id: string; orig: Extract<Annotation, { w: number }> }

/** Approximate bounding box in normalised coordinates (for selection/move). */
export function bbox(a: Annotation, aspect: number): { x: number; y: number; w: number; h: number } {
  switch (a.type) {
    case 'highlight':
    case 'rect':
    case 'image':
      return { x: a.x, y: a.y, w: a.w, h: a.h }
    case 'underline':
      return { x: Math.min(a.x1, a.x2), y: Math.min(a.y1, a.y2) - 0.01, w: Math.abs(a.x2 - a.x1), h: Math.abs(a.y2 - a.y1) + 0.02 }
    case 'ink': {
      const xs = a.points.filter((_, i) => i % 2 === 0)
      const ys = a.points.filter((_, i) => i % 2 === 1)
      const x = Math.min(...xs)
      const y = Math.min(...ys)
      return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y }
    }
    case 'text': {
      const lines = a.text.split('\n')
      const longest = Math.max(...lines.map((l) => l.length))
      return { x: a.x, y: a.y, w: longest * a.size * 0.56, h: (lines.length * a.size * 1.2) / aspect }
    }
  }
}

export function translate(a: Annotation, dx: number, dy: number): Annotation {
  switch (a.type) {
    case 'underline':
      return { ...a, x1: a.x1 + dx, x2: a.x2 + dx, y1: a.y1 + dy, y2: a.y2 + dy }
    case 'ink':
      return { ...a, points: a.points.map((v, i) => v + (i % 2 ? dy : dx)) }
    default:
      return { ...a, x: a.x + dx, y: a.y + dy }
  }
}

export default function AnnotationLayer({ aspect, annotations, watermark, tool, color, size, selectedId, onSelect, onChange, onTextAt }: Props) {
  const svgRef = useRef<SVGSVGElement>(null)
  // Pointer events can arrive faster than React re-renders, so handlers read refs, not state.
  const dragRef = useRef<Drag | null>(null)
  const liveRef = useRef<Annotation[] | null>(null)
  const [live, setLiveState] = useState<Annotation[] | null>(null)
  const setDrag = (d: Drag | null) => {
    dragRef.current = d
  }
  const setLive = (l: Annotation[] | null) => {
    liveRef.current = l
    setLiveState(l)
  }
  const H = W * aspect
  const list = live ?? annotations

  const point = (e: RPointerEvent) => {
    const r = svgRef.current!.getBoundingClientRect()
    return {
      x: Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)),
      y: Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)),
    }
  }
  const hitId = (e: RPointerEvent) => (e.target as Element).closest('[data-id]')?.getAttribute('data-id') ?? null

  const onDown = (e: RPointerEvent<SVGSVGElement>) => {
    if (e.button !== 0) return
    const p = point(e)
    const id = hitId(e)
    if (tool === 'eraser') {
      if (id) onChange(annotations.filter((a) => a.id !== id))
      return
    }
    if (tool === 'text') {
      onTextAt(p.x, p.y)
      return
    }
    e.currentTarget.setPointerCapture(e.pointerId)
    if (tool === 'select') {
      const handle = (e.target as Element).getAttribute('data-handle')
      if (handle && selectedId) {
        const a = annotations.find((x) => x.id === selectedId)
        if (a && 'w' in a) setDrag({ kind: 'resize', id: a.id, orig: a })
        return
      }
      onSelect(id)
      const a = id && annotations.find((x) => x.id === id)
      if (a) setDrag({ kind: 'move', id: a.id, start: p, orig: a })
      return
    }
    let a: Annotation
    const s = size
    if (tool === 'pen') a = { id: uid(), type: 'ink', points: [p.x, p.y], color, size: s }
    else if (tool === 'underline') a = { id: uid(), type: 'underline', x1: p.x, y1: p.y, x2: p.x, y2: p.y, color, size: s }
    else if (tool === 'highlight') a = { id: uid(), type: 'highlight', x: p.x, y: p.y, w: 0, h: 0, color }
    else a = { id: uid(), type: 'rect', x: p.x, y: p.y, w: 0, h: 0, color, size: s }
    setDrag({ kind: 'draw', a })
    setLive([...annotations, a])
  }

  const onMove = (e: RPointerEvent<SVGSVGElement>) => {
    const drag = dragRef.current
    if (!drag) return
    const p = point(e)
    if (drag.kind === 'draw') {
      const a = drag.a
      let next: Annotation = a
      if (a.type === 'ink') {
        const lx = a.points[a.points.length - 2]
        const ly = a.points[a.points.length - 1]
        if (Math.hypot((p.x - lx) * W, (p.y - ly) * H) < 3) return
        next = { ...a, points: [...a.points, p.x, p.y] }
      } else if (a.type === 'underline') {
        // Snap to horizontal when nearly level.
        const level = Math.abs((p.y - a.y1) * H) < 12
        next = { ...a, x2: p.x, y2: level ? a.y1 : p.y }
      } else if (a.type === 'highlight' || a.type === 'rect') {
        // Width/height may go negative while dragging up/left; normalised on release.
        next = { ...a, w: p.x - a.x, h: p.y - a.y }
      }
      setDrag({ kind: 'draw', a: next })
      setLive([...annotations, next])
    } else if (drag.kind === 'move') {
      const moved = translate(drag.orig, p.x - drag.start.x, p.y - drag.start.y)
      setLive(annotations.map((x) => (x.id === drag.id ? moved : x)))
    } else {
      const o = drag.orig
      let w = Math.max(0.02, p.x - o.x)
      let h = Math.max(0.02, p.y - o.y)
      if (o.type === 'image') h = (w * o.h) / o.w // keep signature proportions
      else w = Math.max(0.02, w)
      setLive(annotations.map((x) => (x.id === drag.id ? ({ ...o, w, h } as Annotation) : x)))
    }
  }

  const onUp = () => {
    const drag = dragRef.current
    const live = liveRef.current
    if (!drag) return
    if (drag.kind === 'draw') {
      let a = drag.a
      if ((a.type === 'highlight' || a.type === 'rect') && (a.w < 0 || a.h < 0)) {
        a = { ...a, x: Math.min(a.x, a.x + a.w), y: Math.min(a.y, a.y + a.h), w: Math.abs(a.w), h: Math.abs(a.h) }
      }
      const tiny =
        (a.type === 'ink' && a.points.length < 4) ||
        (a.type === 'underline' && Math.hypot(a.x2 - a.x1, a.y2 - a.y1) < 0.01) ||
        ((a.type === 'highlight' || a.type === 'rect') && (a.w < 0.008 || a.h < 0.004))
      if (!tiny) onChange([...annotations, a])
    } else if (live) {
      onChange(live, `annot:${drag.id}`)
    }
    setDrag(null)
    setLive(null)
  }

  const selected = list.find((a) => a.id === selectedId)
  const sb = selected && bbox(selected, aspect)

  return (
    <svg
      ref={svgRef}
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="none"
      className={`absolute inset-0 size-full touch-none ${tool === 'select' ? 'cursor-default' : tool === 'eraser' ? 'cursor-not-allowed' : tool === 'text' ? 'cursor-text' : 'cursor-crosshair'}`}
      onPointerDown={onDown}
      onPointerMove={onMove}
      onPointerUp={onUp}
      onPointerCancel={onUp}
    >
      {watermark?.enabled && <WatermarkSvg wm={watermark} H={H} />}
      {list.map((a) => (
        <AnnotationSvg key={a.id} a={a} H={H} />
      ))}
      {sb && (
        <g pointerEvents={tool === 'select' ? 'auto' : 'none'}>
          <rect
            x={sb.x * W - 6}
            y={sb.y * H - 6}
            width={sb.w * W + 12}
            height={sb.h * H + 12}
            fill="none"
            stroke="#22d3ee"
            strokeWidth={2}
            strokeDasharray="6 4"
            vectorEffect="non-scaling-stroke"
            pointerEvents="none"
          />
          {selected && 'w' in selected && (
            <circle data-handle="resize" cx={(sb.x + sb.w) * W + 6} cy={(sb.y + sb.h) * H + 6} r={12} fill="#22d3ee" stroke="#0f172a" strokeWidth={2} className="cursor-nwse-resize" />
          )}
        </g>
      )}
    </svg>
  )
}

function AnnotationSvg({ a, H }: { a: Annotation; H: number }) {
  const common = { 'data-id': a.id, style: { cursor: 'pointer' } as const }
  switch (a.type) {
    case 'highlight':
      return (
        <rect
          {...common}
          x={Math.min(a.x, a.x + a.w) * W}
          y={Math.min(a.y, a.y + a.h) * H}
          width={Math.abs(a.w) * W}
          height={Math.abs(a.h) * H}
          fill={a.color}
          opacity={HIGHLIGHT_OPACITY}
          style={{ mixBlendMode: 'multiply', cursor: 'pointer' }}
        />
      )
    case 'rect':
      return (
        <rect
          {...common}
          x={Math.min(a.x, a.x + a.w) * W}
          y={Math.min(a.y, a.y + a.h) * H}
          width={Math.abs(a.w) * W}
          height={Math.abs(a.h) * H}
          fill="transparent"
          stroke={a.color}
          strokeWidth={a.size * W}
        />
      )
    case 'underline':
      return <line {...common} x1={a.x1 * W} y1={a.y1 * H} x2={a.x2 * W} y2={a.y2 * H} stroke={a.color} strokeWidth={Math.max(a.size * W, 2)} strokeLinecap="round" />
    case 'ink': {
      const pts = []
      for (let i = 0; i < a.points.length; i += 2) pts.push(`${a.points[i] * W},${a.points[i + 1] * H}`)
      return <polyline {...common} points={pts.join(' ')} fill="none" stroke={a.color} strokeWidth={a.size * W} strokeLinecap="round" strokeLinejoin="round" />
    }
    case 'text': {
      const fs = a.size * W
      return (
        <text {...common} x={a.x * W} y={a.y * H} fill={a.color} fontSize={fs} fontFamily={FONT_STACK} dominantBaseline="hanging">
          {a.text.split('\n').map((line, i) => (
            <tspan key={i} x={a.x * W} dy={i === 0 ? 0 : fs * 1.2}>
              {line || ' '}
            </tspan>
          ))}
        </text>
      )
    }
    case 'image':
      return <image {...common} href={a.src} x={a.x * W} y={a.y * H} width={a.w * W} height={a.h * H} preserveAspectRatio="none" />
  }
}

function WatermarkSvg({ wm, H }: { wm: Watermark; H: number }) {
  const { cx, cy, angle, fontSize } = watermarkPlacement(wm, W, H)
  return (
    <text
      x={cx}
      y={cy}
      fill={wm.color}
      opacity={wm.opacity}
      fontSize={fontSize}
      fontWeight="bold"
      fontFamily={FONT_STACK}
      textAnchor="middle"
      dominantBaseline="middle"
      transform={`rotate(${-angle} ${cx} ${cy})`}
      pointerEvents="none"
    >
      {wm.text}
    </text>
  )
}
