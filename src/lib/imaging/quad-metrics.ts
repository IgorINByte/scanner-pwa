// Accuracy metrics for corner detection: polygon IoU and corner error, plus the
// ground-truth file format shared by the browser harness and the Node benchmark.
import type { Corners, Point } from '../../types'

export function polygonArea(p: Point[]): number {
  let a = 0
  for (let i = 0; i < p.length; i++) {
    const q = p[i]
    const r = p[(i + 1) % p.length]
    a += q.x * r.y - r.x * q.y
  }
  return Math.abs(a) / 2
}

function signedArea(p: Point[]) {
  let a = 0
  for (let i = 0; i < p.length; i++) a += p[i].x * p[(i + 1) % p.length].y - p[(i + 1) % p.length].x * p[i].y
  return a / 2
}

/** Sutherland–Hodgman clip of `subject` by convex `clip` (both any winding). */
function clipPolygon(subject: Point[], clip: Point[]): Point[] {
  const c = signedArea(clip) < 0 ? [...clip].reverse() : clip
  let out = subject
  for (let i = 0; i < c.length && out.length; i++) {
    const a = c[i]
    const b = c[(i + 1) % c.length]
    const inside = (p: Point) => (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x) >= 0
    const cross = (p: Point, q: Point): Point => {
      const d1 = (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x)
      const d2 = (b.x - a.x) * (q.y - a.y) - (b.y - a.y) * (q.x - a.x)
      const t = d1 / (d1 - d2)
      return { x: p.x + t * (q.x - p.x), y: p.y + t * (q.y - p.y) }
    }
    const input = out
    out = []
    for (let j = 0; j < input.length; j++) {
      const p = input[j]
      const q = input[(j + 1) % input.length]
      if (inside(q)) {
        if (!inside(p)) out.push(cross(p, q))
        out.push(q)
      } else if (inside(p)) out.push(cross(p, q))
    }
  }
  return out
}

/** Intersection-over-union of two convex quadrilaterals (0..1). */
export function quadIoU(a: Corners, b: Corners): number {
  const inter = polygonArea(clipPolygon(a, b))
  const union = polygonArea(a) + polygonArea(b) - inter
  return union > 0 ? inter / union : 0
}

/** Largest corner distance, as a fraction of the image diagonal. */
export function maxCornerError(a: Corners, b: Corners, width: number, height: number): number {
  const diag = Math.hypot(width, height)
  return Math.max(...a.map((p, i) => Math.hypot(p.x - b[i].x, p.y - b[i].y))) / diag
}

// ---------------------------------------------------------------- ground truth

/** Normalised (0..1) corners TL, TR, BR, BL in the oriented image; null = no document. */
export type GtCorners = [[number, number], [number, number], [number, number], [number, number]] | null

export interface GroundTruth {
  version: 1
  images: Record<string, { corners: GtCorners; note?: string }>
}

export const toPixels = (c: NonNullable<GtCorners>, w: number, h: number): Corners =>
  c.map(([x, y]) => ({ x: x * w, y: y * h })) as Corners

export const toNormalised = (c: Corners, w: number, h: number): NonNullable<GtCorners> =>
  c.map((p) => [round4(p.x / w), round4(p.y / h)]) as NonNullable<GtCorners>

const round4 = (v: number) => Math.round(v * 10000) / 10000

export interface ImageScore {
  file: string
  /** IoU against ground truth; for "no document" images 1 if correctly rejected, else 0. */
  iou: number
  /** Max corner error as a fraction of the diagonal (null for no-document images). */
  cornerError: number | null
  detection: string
  ms: number
}

/** Scores one detection against its ground truth (both in the same pixel space). */
export function scoreDetection(
  file: string,
  gt: GtCorners,
  det: { corners: Corners; detection: string; ms: number },
  width: number,
  height: number,
): ImageScore {
  if (gt === null) return { file, iou: det.detection === 'none' ? 1 : 0, cornerError: null, detection: det.detection, ms: det.ms }
  const truth = toPixels(gt, width, height)
  return {
    file,
    iou: quadIoU(truth, det.corners),
    cornerError: maxCornerError(truth, det.corners, width, height),
    detection: det.detection,
    ms: det.ms,
  }
}

export interface Summary {
  n: number
  meanIoU: number
  /** Share of images with IoU >= 0.9 (counting correctly rejected no-document images). */
  hitRate90: number
  meanMs: number
}

export function summarize(scores: ImageScore[]): Summary {
  const n = scores.length
  if (!n) return { n, meanIoU: 0, hitRate90: 0, meanMs: 0 }
  return {
    n,
    meanIoU: scores.reduce((s, x) => s + x.iou, 0) / n,
    hitRate90: scores.filter((x) => x.iou >= 0.9).length / n,
    meanMs: scores.reduce((s, x) => s + x.ms, 0) / n,
  }
}

/** Markdown table for docs/detection-benchmark.md. */
export function toMarkdown(scores: ImageScore[], title: string): string {
  const s = summarize(scores)
  const pct = (v: number) => `${(v * 100).toFixed(1)} %`
  const rows = scores.map(
    (x) =>
      `| ${x.file} | ${x.iou.toFixed(3)} | ${x.cornerError === null ? '—' : pct(x.cornerError)} | ${x.detection} | ${x.ms.toFixed(0)} |`,
  )
  return [
    `### ${title}`,
    '',
    `Images: ${s.n} · mean IoU **${s.meanIoU.toFixed(3)}** · IoU ≥ 0.9: **${pct(s.hitRate90)}** · mean time ${s.meanMs.toFixed(0)} ms`,
    '',
    '| Image | IoU | Max corner error (of diagonal) | Result | ms |',
    '|---|---|---|---|---|',
    ...rows,
    '',
  ].join('\n')
}
