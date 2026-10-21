// Renders any page (scan or PDF) to an image. Scan pages go through the worker pipeline;
// PDF pages are rasterised with pdf.js only when an image is actually needed.
import { NO_ADJUSTMENTS, type Page, type ScanPage, type ScanParams, type Watermark } from '../types'
import { drawAnnotationsOnCanvas, drawWatermarkOnCanvas } from './annotations/canvas'
import { outputSize } from './imaging/perspective'
import { isFullFrame } from './imaging/pipeline'
import { renderScanImage } from './imaging/processor'
import { getCachedPdf, renderPdfPageToCanvas } from './pdf/pdfjs'
import { repository } from './storage/repository'

export interface RenderOptions {
  maxSide: number
  type?: 'image/jpeg' | 'image/png'
  quality?: number
  /** Ignore filters/adjustments (used for "before" comparison). */
  unfiltered?: boolean
}

export interface RenderedImage {
  blob: Blob
  width: number
  height: number
}

/** Changes whenever the rendered pixels of a page would change. */
export function pageKey(p: Page): string {
  return p.kind === 'scan'
    ? JSON.stringify(['s', p.sourceId, p.corners, p.paper, p.filter, p.adjust, p.rotation])
    : JSON.stringify(['p', p.sourceId, p.pageIndex, p.rotation])
}

export function scanParams(p: ScanPage, unfiltered = false): ScanParams {
  return {
    corners: p.corners,
    paper: p.paper,
    filter: unfiltered ? 'original' : p.filter,
    adjust: unfiltered ? NO_ADJUSTMENTS : p.adjust,
    rotation: p.rotation,
  }
}

export const totalRotation = (p: Page) => ((p.kind === 'pdf' ? p.baseRotation : 0) + p.rotation) % 360

/** Aspect-correct size of the page as displayed (after crop and rotation), in arbitrary units. */
export function displaySize(p: Page): { width: number; height: number } {
  let w: number
  let h: number
  if (p.kind === 'scan') {
    const s =
      p.corners && !isFullFrame(p.corners, p.width, p.height)
        ? outputSize(p.corners, p.paper, Infinity)
        : { width: p.width, height: p.height }
    w = s.width
    h = s.height
  } else {
    w = p.width
    h = p.height
  }
  return totalRotation(p) % 180 ? { width: h, height: w } : { width: w, height: h }
}

function canvasToBlob(c: HTMLCanvasElement, type: string, quality: number) {
  return new Promise<Blob>((resolve, reject) =>
    c.toBlob((b) => (b ? resolve(b) : reject(new Error('Image encoding failed'))), type, quality),
  )
}

export async function renderPdfPageCanvas(page: Extract<Page, { kind: 'pdf' }>, maxSide: number) {
  const doc = await getCachedPdf(page.sourceId, () => repository.getBlob(page.sourceId))
  return renderPdfPageToCanvas(doc, page.pageIndex, totalRotation(page), maxSide)
}

export async function renderPage(page: Page, opts: RenderOptions): Promise<RenderedImage> {
  const type = opts.type ?? 'image/jpeg'
  const quality = opts.quality ?? 0.85
  if (page.kind === 'scan') {
    return renderScanImage({
      blob: await repository.getBlob(page.sourceId),
      params: scanParams(page, opts.unfiltered),
      srcWidth: page.width,
      srcHeight: page.height,
      maxSide: opts.maxSide,
      type,
      quality,
    })
  }
  const canvas = await renderPdfPageCanvas(page, opts.maxSide)
  const blob = await canvasToBlob(canvas, type, quality)
  const result = { blob, width: canvas.width, height: canvas.height }
  canvas.width = canvas.height = 0
  return result
}

/** Renders a page with its annotations and the watermark burned in (image export). */
export async function renderPageFlattened(
  page: Page,
  watermark: Watermark | null,
  opts: RenderOptions,
): Promise<RenderedImage> {
  const base = await renderPage(page, { ...opts, type: 'image/png' })
  if (!page.annotations.length && !watermark?.enabled) {
    if ((opts.type ?? 'image/jpeg') === 'image/png') return base
  }
  const bitmap = await createImageBitmap(base.blob)
  const canvas = document.createElement('canvas')
  canvas.width = bitmap.width
  canvas.height = bitmap.height
  const ctx = canvas.getContext('2d')!
  ctx.drawImage(bitmap, 0, 0)
  bitmap.close()
  await drawAnnotationsOnCanvas(ctx, page.annotations, canvas.width, canvas.height)
  if (watermark?.enabled) drawWatermarkOnCanvas(ctx, watermark, canvas.width, canvas.height)
  const blob = await canvasToBlob(canvas, opts.type ?? 'image/jpeg', opts.quality ?? 0.9)
  const result = { blob, width: canvas.width, height: canvas.height }
  canvas.width = canvas.height = 0
  return result
}
