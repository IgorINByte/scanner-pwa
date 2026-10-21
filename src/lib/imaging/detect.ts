// Document edge detection with OpenCV.js (lazy-loaded). Runs on a ~640 px copy, so it is
// fast enough for the main thread; the expensive full-resolution work happens in the worker.
import type { Corners } from '../../types'
import { fullFrame, orderCorners, scaleCorners } from '../geometry'
import { decodeImage, drawScaled, releaseCanvas } from '../image'
import { getCv, loadOpenCv } from '../opencv'

const DETECT_SIZE = 640

export interface Detection {
  corners: Corners
  /** found: clean 4-sided outline; approx: best-effort box; none: nothing found (full image). */
  detection: 'found' | 'approx' | 'none'
}

export async function detectCorners(source: Blob, width: number, height: number): Promise<Detection> {
  await loadOpenCv()
  const cv = getCv()
  const bitmap = await decodeImage(source)
  const canvas = drawScaled(bitmap, DETECT_SIZE)
  if (bitmap instanceof ImageBitmap) bitmap.close()
  const scale = width / canvas.width

  const src = cv.imread(canvas)
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

    const imgArea = canvas.width * canvas.height
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
          const pts = []
          for (let j = 0; j < 4; j++) pts.push({ x: approx.data32S[j * 2], y: approx.data32S[j * 2 + 1] })
          best = orderCorners(pts)
          bestArea = area
        }
        approx.delete()
      }
      c.delete()
    }
    if (best) return { corners: scaleCorners(best, scale), detection: 'found' }

    // No clean quad: use the rotated bounding box of the largest contour, if it is big enough.
    if (largest.area > minArea) {
      const c = contours.get(largest.idx)
      const rect = cv.minAreaRect(c)
      c.delete()
      const pts = cv.RotatedRect.points(rect).map((p: { x: number; y: number }) => ({
        x: Math.min(canvas.width, Math.max(0, p.x)),
        y: Math.min(canvas.height, Math.max(0, p.y)),
      }))
      return { corners: scaleCorners(orderCorners(pts), scale), detection: 'approx' }
    }
    return { corners: fullFrame(width, height), detection: 'none' }
  } finally {
    ;[src, gray, edges, kernel, contours, hierarchy].forEach((m) => m.delete())
    releaseCanvas(canvas)
  }
}
