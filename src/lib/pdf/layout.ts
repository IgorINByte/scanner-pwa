// Pure geometry for PDF output: page sizes, image placement and mapping from
// normalised display coordinates (annotations, OCR words) into PDF user space.

export type PageSize = 'auto' | 'a4' | 'a5' | 'letter'
export type Orientation = 'auto' | 'portrait' | 'landscape'

/** Portrait sizes in PDF points (1/72 in). */
export const PAGE_SIZES: Record<Exclude<PageSize, 'auto'>, [number, number]> = {
  a4: [595.28, 841.89],
  a5: [419.53, 595.28],
  letter: [612, 792],
}

export interface Rect {
  x: number
  y: number
  w: number
  h: number
}

/**
 * Page size and image rectangle for an image of iw x ih pixels.
 * "auto" makes the page exactly the image's proportions (long side = A4 long side).
 * Fixed sizes fit the image inside the page, centred, keeping its aspect ratio.
 */
export function placeImage(iw: number, ih: number, size: PageSize, orientation: Orientation) {
  const landscapeImage = iw > ih
  const landscape = orientation === 'auto' ? landscapeImage : orientation === 'landscape'
  if (size === 'auto') {
    const long = PAGE_SIZES.a4[1]
    const s = long / Math.max(iw, ih)
    let pw = iw * s
    let ph = ih * s
    // A forced orientation that differs from the image keeps the image fitted inside.
    if (orientation !== 'auto' && landscape !== landscapeImage) {
      ;[pw, ph] = [ph, pw]
      const f = Math.min(pw / iw, ph / ih)
      return { pageWidth: pw, pageHeight: ph, image: centre(pw, ph, iw * f, ih * f) }
    }
    return { pageWidth: pw, pageHeight: ph, image: { x: 0, y: 0, w: pw, h: ph } }
  }
  const [a, b] = PAGE_SIZES[size]
  const pw = landscape ? b : a
  const ph = landscape ? a : b
  const f = Math.min(pw / iw, ph / ih)
  return { pageWidth: pw, pageHeight: ph, image: centre(pw, ph, iw * f, ih * f) }
}

function centre(pw: number, ph: number, w: number, h: number): Rect {
  return { x: (pw - w) / 2, y: (ph - h) / 2, w, h }
}

export interface Mapper {
  /** Display size in points (after rotation). */
  dispW: number
  dispH: number
  /** Rotation (degrees, counter-clockwise in PDF space) to apply to drawn text/rects. */
  rotate: number
  /** Normalised display point (u right, v down) -> PDF user space. */
  map(u: number, v: number): { x: number; y: number }
}

/**
 * `box` is the unrotated content box in PDF user space; `rotation` is the page's
 * /Rotate (clockwise, as viewers display it).
 */
export function createMapper(box: Rect, rotation: number): Mapper {
  const r = ((rotation % 360) + 360) % 360
  const { x: x0, y: y0, w, h } = box
  const swap = r === 90 || r === 270
  const map = (u: number, v: number) => {
    switch (r) {
      case 90:
        return { x: x0 + v * w, y: y0 + u * h }
      case 180:
        return { x: x0 + (1 - u) * w, y: y0 + v * h }
      case 270:
        return { x: x0 + (1 - v) * w, y: y0 + (1 - u) * h }
      default:
        return { x: x0 + u * w, y: y0 + (1 - v) * h }
    }
  }
  return { dispW: swap ? h : w, dispH: swap ? w : h, rotate: r, map }
}
