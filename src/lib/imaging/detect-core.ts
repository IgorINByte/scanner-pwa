// Document corner detection on an RGBA buffer, independent of DOM/worker/Node so the same
// code runs in the detection worker, the main-thread fallback, and the Node benchmark.
import type { Corners, Point } from '../../types'
import { fullFrame, orderCorners } from '../geometry'
import type { CV } from '../opencv'

/** Long side of the working image for still photos. */
export const DETECT_SIZE = 640

export type DetectionKind = 'found' | 'approx' | 'none'

export interface RgbaImage {
  data: Uint8ClampedArray
  width: number
  height: number
}

export interface CoreDetection {
  /** Corners in the input image's pixels. */
  corners: Corners
  /** found: clean 4-sided outline; approx: best-effort box; none: nothing found (full image). */
  detection: DetectionKind
}

/** Runs detection on an image already scaled to the working size. */
export function detectInImage(cv: CV, img: RgbaImage): CoreDetection {
  const src = cv.matFromImageData(img)
  const gray = new cv.Mat()
  const edges = new cv.Mat()
  const kernel = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(3, 3))
  const contours = new cv.MatVector()
  const hierarchy = new cv.Mat()
  try {
    cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY)
    cv.GaussianBlur(gray, gray, new cv.Size(5, 5), 0)
    // Closing removes text so the page reads as one bright blob before edge detection.
    cv.morphologyEx(gray, gray, cv.MORPH_CLOSE, kernel, new cv.Point(-1, -1), 3)
    cv.Canny(gray, edges, 50, 150)
    cv.dilate(edges, edges, kernel)
    cv.findContours(edges, contours, hierarchy, cv.RETR_LIST, cv.CHAIN_APPROX_SIMPLE)

    const imgArea = img.width * img.height
    const minArea = imgArea * 0.15
    let best: Corners | null = null
    let bestArea = 0
    let largest = { idx: -1, area: 0 }

    for (let i = 0; i < contours.size(); i++) {
      const c = contours.get(i)
      const area = cv.contourArea(c)
      if (area > largest.area) largest = { idx: i, area }
      // A quad covering ~the whole frame is usually the image border, not a page.
      if (area > minArea && area < imgArea * 0.98 && area > bestArea) {
        const approx = new cv.Mat()
        cv.approxPolyDP(c, approx, 0.02 * cv.arcLength(c, true), true)
        if (approx.rows === 4 && cv.isContourConvex(approx)) {
          const pts: Point[] = []
          for (let j = 0; j < 4; j++) pts.push({ x: approx.data32S[j * 2], y: approx.data32S[j * 2 + 1] })
          best = orderCorners(pts)
          bestArea = area
        }
        approx.delete()
      }
      c.delete()
    }
    if (best) return { corners: best, detection: 'found' }

    // No clean quad: use the rotated bounding box of the largest contour, if it is big enough.
    if (largest.area > minArea) {
      const c = contours.get(largest.idx)
      const rect = cv.minAreaRect(c)
      c.delete()
      const pts = cv.RotatedRect.points(rect).map((p: Point) => ({
        x: Math.min(img.width, Math.max(0, p.x)),
        y: Math.min(img.height, Math.max(0, p.y)),
      }))
      return { corners: orderCorners(pts), detection: 'approx' }
    }
    return { corners: fullFrame(img.width, img.height), detection: 'none' }
  } finally {
    ;[src, gray, edges, kernel, contours, hierarchy].forEach((m) => m.delete())
  }
}

/** Working size for an image of w x h so the long side is at most `side`. */
export function workingSize(w: number, h: number, side = DETECT_SIZE) {
  const s = Math.min(1, side / Math.max(w, h))
  return { width: Math.max(1, Math.round(w * s)), height: Math.max(1, Math.round(h * s)) }
}
