// Shared glue between a decoded bitmap and detect-core: downscale to the working size,
// read pixels, detect, and map corners back to source pixels. Runs in the worker and in
// the main-thread fallback; only the canvas factory differs.
import type { Corners } from '../../types'
import type { CV } from '../opencv'
import { DETECT_SIZE, detectInImage, workingSize, type DetectionKind } from './detect-core'

type AnyCanvas = OffscreenCanvas | HTMLCanvasElement

export interface DetectResult {
  /** Corners in source pixels (srcWidth x srcHeight). */
  corners: Corners
  detection: DetectionKind
  /** Detection time in ms, excluding decode. */
  ms: number
}

export async function detectBitmap(
  cv: CV,
  bitmap: ImageBitmap,
  srcWidth: number,
  srcHeight: number,
  createCanvas: (w: number, h: number) => AnyCanvas,
  side = DETECT_SIZE,
): Promise<DetectResult> {
  const { width, height } = workingSize(bitmap.width, bitmap.height, side)
  const canvas = createCanvas(width, height)
  try {
    const ctx = canvas.getContext('2d', { willReadFrequently: true }) as OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D
    ctx.imageSmoothingQuality = 'high'
    ctx.drawImage(bitmap, 0, 0, width, height)
    const img = ctx.getImageData(0, 0, width, height)
    const t0 = performance.now()
    const r = detectInImage(cv, img)
    const ms = performance.now() - t0
    // The bitmap may differ slightly from the stored size; map proportionally.
    const sx = srcWidth / width
    const sy = srcHeight / height
    const corners = r.corners.map((p) => ({ x: p.x * sx, y: p.y * sy })) as Corners
    return { corners, detection: r.detection, ms }
  } finally {
    canvas.width = canvas.height = 0
  }
}

/** Decodes a stored (already oriented) source image at roughly the working size. */
export async function decodeForDetection(blob: Blob, srcWidth: number, srcHeight: number, side = DETECT_SIZE) {
  const { width } = workingSize(srcWidth, srcHeight, side * 1.5)
  // Stored sources are already oriented JPEGs; from-image keeps that a no-op for them.
  return createImageBitmap(blob, { imageOrientation: 'from-image', resizeWidth: width, resizeQuality: 'high' })
}
