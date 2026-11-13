// Shared glue between a decoded bitmap and the detectors. Runs in the worker and in the
// main-thread fallback; only the canvas factory and the OpenCV loader differ.
//   1. ML model (DocAligner lcnet100) on the bitmap, shrunk to 256 x 256 for the model,
//      then each side is snapped to the real paper edge on a ~1600 px greyscale copy.
//   2. If the model gives no reliable quad: the classical OpenCV detection (640 px).
//   3. If neither: the full image.
import type { Corners } from '../../types'
import { fullFrame } from '../geometry'
import type { CV } from '../opencv'
import { DETECT_SIZE, detectInImage, workingSize, type DetectionKind } from './detect-core'
import { detectWithModel } from './docaligner-detect'
import { isValidQuad, MIN_AREA_RATIO, OUTSIDE_MARGIN, refineQuad, REFINE_SIZE, toGray } from './refine'

type AnyCanvas = OffscreenCanvas | HTMLCanvasElement
type Ctx = OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D

export type DetectionSource = 'model' | 'classical' | 'none'

export interface DetectResult {
  /** Corners in source pixels (srcWidth x srcHeight); may lie up to 5 % outside the image. */
  corners: Corners
  detection: DetectionKind
  /** Which detector produced the corners. */
  source: DetectionSource
  /** 0..1: the model's mean corner-heatmap peak for 'model', a fixed level for 'classical', 0 for 'none'. */
  confidence: number
  /** Sides (top, right, bottom, left) snapped to an image edge after the model; null if not run. */
  snapped: [boolean, boolean, boolean, boolean] | null
  /** Detection time in ms, excluding decode. */
  ms: number
}

/** Restrict detection to one stage (test pages compare before/after with this). */
export type DetectOnly = 'classical' | 'model'

/** Test hooks (fixture page); the app uses the defaults. */
export interface DetectOptions {
  only?: DetectOnly
  /** Minimum quad area as a fraction of the image (default MIN_AREA_RATIO = 3 %). */
  minArea?: number
}

/** Confidence reported for classical results (it has no calibrated score). */
const CLASSICAL_CONFIDENCE: Record<DetectionKind, number> = { found: 0.6, approx: 0.3, none: 0 }

function readPixels(bitmap: ImageBitmap, side: number, createCanvas: (w: number, h: number) => AnyCanvas) {
  const { width, height } = workingSize(bitmap.width, bitmap.height, side)
  const canvas = createCanvas(width, height)
  try {
    const ctx = canvas.getContext('2d', { willReadFrequently: true }) as Ctx
    ctx.imageSmoothingQuality = 'high'
    ctx.drawImage(bitmap, 0, 0, width, height)
    return ctx.getImageData(0, 0, width, height)
  } finally {
    // Release the backing store right away (Safari keeps canvas memory until resized).
    canvas.width = canvas.height = 1
  }
}

const scale = (c: Corners, sx: number, sy: number) => c.map((p) => ({ x: p.x * sx, y: p.y * sy })) as Corners

const clampToMargin = (c: Corners, w: number, h: number) =>
  c.map((p) => ({
    x: Math.min(w * (1 + OUTSIDE_MARGIN), Math.max(-w * OUTSIDE_MARGIN, p.x)),
    y: Math.min(h * (1 + OUTSIDE_MARGIN), Math.max(-h * OUTSIDE_MARGIN, p.y)),
  })) as Corners

async function modelStage(bitmap: ImageBitmap, createCanvas: (w: number, h: number) => AnyCanvas, opts: DetectOptions) {
  const minArea = opts.minArea ?? MIN_AREA_RATIO
  let m
  try {
    m = await detectWithModel(bitmap)
  } catch (e) {
    console.warn('ML detector unavailable, using classical detection', e)
    return null
  }
  const bw = bitmap.width
  const bh = bitmap.height
  if (!m || !m.success || !isValidQuad(m.corners, bw, bh, minArea)) return null

  const img = readPixels(bitmap, REFINE_SIZE, createCanvas)
  const gray = toGray(img.data, img.width, img.height)
  const sx = img.width / bw
  const sy = img.height / bh
  const r = refineQuad(gray, scale(m.corners, sx, sy))
  let corners = m.corners
  let snapped = r.snapped
  if (r.snapped.some(Boolean)) {
    const refined = clampToMargin(r.corners, img.width, img.height)
    if (isValidQuad(refined, img.width, img.height, minArea)) corners = scale(refined, 1 / sx, 1 / sy)
    else snapped = [false, false, false, false]
  }
  return { corners, score: m.score, snapped }
}

export async function detectBitmap(
  getCv: () => Promise<CV>,
  bitmap: ImageBitmap,
  srcWidth: number,
  srcHeight: number,
  createCanvas: (w: number, h: number) => AnyCanvas,
  side = DETECT_SIZE,
  opts: DetectOptions = {},
): Promise<DetectResult> {
  const { only } = opts
  const t0 = performance.now()
  // The bitmap may differ slightly from the stored size; map proportionally.
  const toSrc = (c: Corners, w: number, h: number) => scale(c, srcWidth / w, srcHeight / h)
  const done = (r: Omit<DetectResult, 'ms'>): DetectResult => ({ ...r, ms: performance.now() - t0 })

  if (only !== 'classical') {
    const m = await modelStage(bitmap, createCanvas, opts)
    if (m) return done({ corners: toSrc(m.corners, bitmap.width, bitmap.height), detection: 'found', source: 'model', confidence: m.score, snapped: m.snapped })
  }

  if (only !== 'model') {
    const img = readPixels(bitmap, side, createCanvas)
    const r = detectInImage(await getCv(), img)
    if (r.detection !== 'none' && isValidQuad(r.corners, img.width, img.height, opts.minArea)) {
      return done({
        corners: toSrc(r.corners, img.width, img.height),
        detection: r.detection,
        source: 'classical',
        confidence: CLASSICAL_CONFIDENCE[r.detection],
        snapped: null,
      })
    }
  }

  return done({ corners: fullFrame(srcWidth, srcHeight), detection: 'none', source: 'none', confidence: 0, snapped: null })
}

/** Decodes a stored (already oriented) source image at the refinement size. */
export async function decodeForDetection(blob: Blob, srcWidth: number, srcHeight: number) {
  const { width } = workingSize(srcWidth, srcHeight, REFINE_SIZE)
  // Stored sources are already oriented JPEGs; from-image keeps that a no-op for them.
  return createImageBitmap(blob, { imageOrientation: 'from-image', resizeWidth: width, resizeQuality: 'high' })
}
