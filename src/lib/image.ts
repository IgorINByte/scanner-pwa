export const MAX_SIDE = 2480

type Drawable = ImageBitmap | HTMLImageElement | HTMLVideoElement | HTMLCanvasElement

export async function decodeImage(blob: Blob): Promise<ImageBitmap | HTMLImageElement> {
  if ('createImageBitmap' in window) {
    try {
      return await createImageBitmap(blob)
    } catch {
      // Fall back to <img> decoding (older Safari, some formats).
    }
  }
  const url = URL.createObjectURL(blob)
  try {
    const img = new Image()
    img.src = url
    await img.decode()
    return img
  } finally {
    URL.revokeObjectURL(url)
  }
}

function sizeOf(src: Drawable) {
  if (src instanceof HTMLVideoElement) return { w: src.videoWidth, h: src.videoHeight }
  if (src instanceof HTMLImageElement) return { w: src.naturalWidth, h: src.naturalHeight }
  return { w: src.width, h: src.height }
}

export function createCanvas(w: number, h: number) {
  const c = document.createElement('canvas')
  c.width = Math.max(1, Math.round(w))
  c.height = Math.max(1, Math.round(h))
  return c
}

/** Frees canvas backing memory right away (iOS caps total canvas memory). */
export function releaseCanvas(c: HTMLCanvasElement) {
  c.width = 0
  c.height = 0
}

export function ctx2d(c: HTMLCanvasElement) {
  return c.getContext('2d', { willReadFrequently: true })!
}

/** Draws a source into a new canvas, scaled so the longer side is at most maxSide. */
export function drawScaled(src: Drawable, maxSide: number = MAX_SIDE) {
  const { w, h } = sizeOf(src)
  const scale = Math.min(1, maxSide / Math.max(w, h))
  const canvas = createCanvas(w * scale, h * scale)
  const ctx = ctx2d(canvas)
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(src, 0, 0, canvas.width, canvas.height)
  return canvas
}

export function canvasToBlob(canvas: HTMLCanvasElement, type = 'image/jpeg', quality = 0.92): Promise<Blob> {
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Canvas export failed'))), type, quality),
  )
}

export interface PreparedImage {
  blob: Blob
  width: number
  height: number
}

/** Normalises a captured/imported image: downscale to <= 2480 px and re-encode as JPEG. */
export async function prepareImage(src: Blob | HTMLVideoElement): Promise<PreparedImage> {
  const drawable = src instanceof Blob ? await decodeImage(src) : src
  const canvas = drawScaled(drawable)
  if (drawable instanceof ImageBitmap) drawable.close()
  const blob = await canvasToBlob(canvas, 'image/jpeg', 0.92)
  const result = { blob, width: canvas.width, height: canvas.height }
  releaseCanvas(canvas)
  return result
}

/** Returns a rotated copy (clockwise degrees) and releases the input canvas. */
export function rotateCanvas(src: HTMLCanvasElement, deg: number) {
  if (deg % 360 === 0) return src
  const swap = deg % 180 !== 0
  const out = createCanvas(swap ? src.height : src.width, swap ? src.width : src.height)
  const ctx = ctx2d(out)
  ctx.translate(out.width / 2, out.height / 2)
  ctx.rotate((deg * Math.PI) / 180)
  ctx.drawImage(src, -src.width / 2, -src.height / 2)
  releaseCanvas(src)
  return out
}
