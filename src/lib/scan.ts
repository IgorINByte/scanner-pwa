// OpenCV-based document detection and perspective correction.
import type { Corners } from '../types'
import { dist, fullFrame, orderCorners, scaleCorners } from './geometry'
import { createCanvas, decodeImage, drawScaled, releaseCanvas } from './image'
import { getCv, loadOpenCv } from './opencv'

const DETECT_SIZE = 640

/**
 * Finds the 4 corners of the largest document-like quadrilateral.
 * Falls back to the full frame when nothing convincing is found.
 */
export async function detectCorners(source: Blob, width: number, height: number): Promise<Corners> {
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

    const minArea = canvas.width * canvas.height * 0.15
    let best: Corners | null = null
    let bestArea = 0
    let largest: { idx: number; area: number } = { idx: -1, area: 0 }

    for (let i = 0; i < contours.size(); i++) {
      const c = contours.get(i)
      const area = cv.contourArea(c)
      if (area > largest.area) largest = { idx: i, area }
      if (area > minArea && area > bestArea) {
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

    // No clean quad: use the rotated bounding box of the largest contour, if it is big enough.
    if (!best && largest.area > minArea) {
      const c = contours.get(largest.idx)
      const rect = cv.minAreaRect(c)
      c.delete()
      const pts = cv.RotatedRect.points(rect).map((p: { x: number; y: number }) => ({
        x: Math.min(canvas.width, Math.max(0, p.x)),
        y: Math.min(canvas.height, Math.max(0, p.y)),
      }))
      best = orderCorners(pts)
    }

    return best ? scaleCorners(best, scale) : fullFrame(width, height)
  } finally {
    ;[src, gray, edges, kernel, contours, hierarchy].forEach((m) => m.delete())
    releaseCanvas(canvas)
  }
}

/** Warps the quadrilateral `c` (in canvas pixels) of `input` into a flat rectangle. */
export function warpPerspective(input: HTMLCanvasElement, c: Corners, maxSide: number): HTMLCanvasElement {
  const cv = getCv()
  let w = Math.max(dist(c[0], c[1]), dist(c[3], c[2]))
  let h = Math.max(dist(c[0], c[3]), dist(c[1], c[2]))
  const s = Math.min(1, maxSide / Math.max(w, h))
  w = Math.max(1, Math.round(w * s))
  h = Math.max(1, Math.round(h * s))

  const src = cv.imread(input)
  const dst = new cv.Mat()
  const from = cv.matFromArray(4, 1, cv.CV_32FC2, c.flatMap((p) => [p.x, p.y]))
  const to = cv.matFromArray(4, 1, cv.CV_32FC2, [0, 0, w, 0, w, h, 0, h])
  const m = cv.getPerspectiveTransform(from, to)
  try {
    cv.warpPerspective(src, dst, m, new cv.Size(w, h), cv.INTER_LINEAR, cv.BORDER_REPLICATE, new cv.Scalar())
    const out = createCanvas(w, h)
    cv.imshow(out, dst)
    return out
  } finally {
    ;[src, dst, from, to, m].forEach((x) => x.delete())
  }
}

/** Black & white "scanned document" look via adaptive thresholding. Modifies the canvas in place. */
export function documentFilter(canvas: HTMLCanvasElement) {
  const cv = getCv()
  const src = cv.imread(canvas)
  const gray = new cv.Mat()
  try {
    cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY)
    cv.medianBlur(gray, gray, 3)
    const block = Math.max(15, Math.round(Math.min(canvas.width, canvas.height) / 30)) | 1
    cv.adaptiveThreshold(gray, gray, 255, cv.ADAPTIVE_THRESH_MEAN_C, cv.THRESH_BINARY, block, 12)
    cv.imshow(canvas, gray)
  } finally {
    src.delete()
    gray.delete()
  }
}
