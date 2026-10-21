// Decode -> process -> encode for a scan page. Shared by the Web Worker and the
// main-thread fallback; only the canvas factory differs.
import type { Corners, ScanParams } from '../../types'
import type { Img } from './buffer'
import { outputSize } from './perspective'
import { processScan } from './pipeline'

type AnyCanvas = OffscreenCanvas | HTMLCanvasElement
type Ctx = OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D

export interface RenderRequest {
  blob: Blob
  params: ScanParams
  /** Size of the original source image the corners refer to. */
  srcWidth: number
  srcHeight: number
  maxSide: number
  type: 'image/jpeg' | 'image/png'
  quality: number
}

export interface RenderResult {
  blob: Blob
  width: number
  height: number
}

export interface CanvasEnv {
  create(w: number, h: number): AnyCanvas
  toBlob(c: AnyCanvas, type: string, quality: number): Promise<Blob>
}

function ctx(c: AnyCanvas): Ctx {
  return c.getContext('2d', { willReadFrequently: true }) as Ctx
}

/** How much to downscale the source so the region of interest ends up close to maxSide. */
export function decodeScale(corners: Corners | null, w: number, h: number, maxSide: number) {
  const roi = corners ? outputSize(corners, 'auto', Infinity) : { width: w, height: h }
  return Math.min(1, (maxSide * 1.1) / Math.max(roi.width, roi.height, 1))
}

export async function renderScan(req: RenderRequest, env: CanvasEnv): Promise<RenderResult> {
  const bitmap = await createImageBitmap(req.blob)
  const scale = Math.min(decodeScale(req.params.corners, req.srcWidth, req.srcHeight, req.maxSide), 1)
  // The decoded bitmap may differ slightly from the stored size; map corners proportionally.
  const sx = (bitmap.width * scale) / req.srcWidth
  const w = Math.max(1, Math.round(bitmap.width * scale))
  const h = Math.max(1, Math.round(bitmap.height * scale))
  const canvas = env.create(w, h)
  const c = ctx(canvas)
  c.imageSmoothingQuality = 'high'
  c.drawImage(bitmap, 0, 0, w, h)
  bitmap.close()

  const src: Img = c.getImageData(0, 0, w, h)
  const out = processScan(src, req.params, sx, req.maxSide)

  const outCanvas = env.create(out.width, out.height)
  ctx(outCanvas).putImageData(new ImageData(out.data as Uint8ClampedArray<ArrayBuffer>, out.width, out.height), 0, 0)
  canvas.width = canvas.height = 0
  const blob = await env.toBlob(outCanvas, req.type, req.quality)
  const result = { blob, width: outCanvas.width, height: outCanvas.height }
  outCanvas.width = outCanvas.height = 0
  return result
}
