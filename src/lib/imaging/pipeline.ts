// The full scan-page rendering pipeline, always computed from the original source image
// and the current settings (never from a previously processed result).
import type { Corners, ScanParams } from '../../types'
import { rotateImg, type Img } from './buffer'
import {
  autoColor,
  blackAndWhite,
  brightnessContrast,
  denoise,
  emphasizeText,
  grayscale,
  removeShadows,
  sharpen,
  whiten,
} from './enhance'
import { outputSize, warpPerspective } from './perspective'

export function isFullFrame(c: Corners, w: number, h: number) {
  const f = [
    [0, 0],
    [w, 0],
    [w, h],
    [0, h],
  ]
  return c.every((p, i) => Math.abs(p.x - f[i][0]) < 1 && Math.abs(p.y - f[i][1]) < 1)
}

/** Built-in strength of each filter; manual sliders are added on top. */
const FILTER_BASE = {
  original: { shadows: 0, whiten: 0, sharpness: 0 },
  auto: { shadows: 0.9, whiten: 25, sharpness: 15 },
  color: { shadows: 0.5, whiten: 10, sharpness: 10 },
  grayscale: { shadows: 0, whiten: 0, sharpness: 0 },
  document: { shadows: 1, whiten: 0, sharpness: 0 },
  text: { shadows: 1, whiten: 0, sharpness: 30 },
} as const

/**
 * Renders a scan page.
 * @param src     source image, possibly already downscaled
 * @param params  settings; corners are in *original* source pixels
 * @param scale   src pixels per original source pixel
 * @param maxSide upper bound for the output's longer side
 */
export function processScan(src: Img, params: ScanParams, scale: number, maxSide: number): Img {
  let img = src
  const c = params.corners
  if (c && !isFullFrame(c, src.width / scale, src.height / scale)) {
    const scaled = c.map((p) => ({ x: p.x * scale, y: p.y * scale })) as Corners
    const { width, height } = outputSize(scaled, params.paper, maxSide)
    img = warpPerspective(src, scaled, width, height)
  }

  const base = FILTER_BASE[params.filter]
  const a = params.adjust
  denoise(img, a.denoise)
  removeShadows(img, Math.min(1, base.shadows + a.shadows / 100))

  switch (params.filter) {
    case 'auto':
      autoColor(img, 1.1)
      break
    case 'color':
      autoColor(img, 1.3)
      break
    case 'grayscale':
      grayscale(img)
      break
    case 'document':
      blackAndWhite(img)
      break
    case 'text':
      emphasizeText(img)
      break
  }

  whiten(img, Math.min(100, base.whiten + a.whiten))
  brightnessContrast(img, a.brightness, a.contrast)
  sharpen(img, Math.min(100, base.sharpness + a.sharpness))
  return rotateImg(img, params.rotation)
}
