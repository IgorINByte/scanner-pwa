import type { Page } from '../types'
import { isFullFrame, scaleCorners } from './geometry'
import { ctx2d, decodeImage, drawScaled, MAX_SIDE, releaseCanvas, rotateCanvas } from './image'
import { loadOpenCv } from './opencv'
import { documentFilter, warpPerspective } from './scan'

/** Key that changes whenever the rendered output of a page would change. */
export const pageKey = (p: Page) => JSON.stringify([p.corners, p.filter, p.rotation])

function grayscale(canvas: HTMLCanvasElement) {
  const ctx = ctx2d(canvas)
  const img = ctx.getImageData(0, 0, canvas.width, canvas.height)
  const d = img.data
  for (let i = 0; i < d.length; i += 4) {
    const y = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]
    d[i] = d[i + 1] = d[i + 2] = y
  }
  ctx.putImageData(img, 0, 0)
}

/** Auto-levels (1%/99% luminance stretch) plus a mild saturation boost. */
function enhance(canvas: HTMLCanvasElement) {
  const ctx = ctx2d(canvas)
  const img = ctx.getImageData(0, 0, canvas.width, canvas.height)
  const d = img.data
  const hist = new Uint32Array(256)
  for (let i = 0; i < d.length; i += 4) hist[(0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]) | 0]++
  const total = d.length / 4
  let lo = 0
  let hi = 255
  for (let acc = 0; lo < 255 && (acc += hist[lo]) < total * 0.01; lo++);
  for (let acc = 0; hi > 0 && (acc += hist[hi]) < total * 0.01; hi--);
  if (hi - lo < 32) {
    lo = 0
    hi = 255
  }
  const lut = new Uint8ClampedArray(256)
  for (let v = 0; v < 256; v++) lut[v] = ((v - lo) * 255) / (hi - lo)
  const sat = 1.25
  for (let i = 0; i < d.length; i += 4) {
    const r = lut[d[i]]
    const g = lut[d[i + 1]]
    const b = lut[d[i + 2]]
    const y = 0.299 * r + 0.587 * g + 0.114 * b
    d[i] = y + (r - y) * sat
    d[i + 1] = y + (g - y) * sat
    d[i + 2] = y + (b - y) * sat
  }
  ctx.putImageData(img, 0, 0)
}

/**
 * Renders a page with crop, filter and rotation applied.
 * `maxSide` limits the output size (used for thumbnails, previews and export quality).
 */
export async function renderPage(page: Page, maxSide = MAX_SIDE): Promise<HTMLCanvasElement> {
  const bitmap = await decodeImage(page.source)
  let canvas = drawScaled(bitmap, maxSide)
  if (bitmap instanceof ImageBitmap) bitmap.close()
  const scale = canvas.width / page.width

  const needsCv =
    page.filter === 'document' || (page.corners && !isFullFrame(page.corners, page.width, page.height))
  if (needsCv) await loadOpenCv()

  if (page.corners && !isFullFrame(page.corners, page.width, page.height)) {
    const warped = warpPerspective(canvas, scaleCorners(page.corners, scale), maxSide)
    releaseCanvas(canvas)
    canvas = warped
  }

  if (page.filter === 'grayscale') grayscale(canvas)
  else if (page.filter === 'enhanced') enhance(canvas)
  else if (page.filter === 'document') documentFilter(canvas)

  return rotateCanvas(canvas, page.rotation)
}
