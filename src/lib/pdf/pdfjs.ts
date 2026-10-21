// pdf.js (lazy-loaded) for reading existing PDFs: page info, rendering, text extraction.
import type { PDFDocumentProxy } from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import type { Rotation } from '../../types'

type PdfJs = typeof import('pdfjs-dist')

let lib: Promise<PdfJs> | null = null

export function loadPdfJs(): Promise<PdfJs> {
  lib ??= import('pdfjs-dist').then((m) => {
    m.GlobalWorkerOptions.workerSrc = workerUrl
    return m
  })
  return lib
}

const vendor = (p: string) => `${import.meta.env.BASE_URL}vendor/pdfjs/${p}/`

export class PdfPasswordError extends Error {
  constructor(public incorrect: boolean) {
    super(incorrect ? 'Incorrect password' : 'This PDF is password protected')
  }
}

export async function openPdf(data: Uint8Array | ArrayBuffer, password?: string): Promise<PDFDocumentProxy> {
  const pdfjs = await loadPdfJs()
  const task = pdfjs.getDocument({
    // pdf.js transfers (detaches) the buffer, so always give it a copy.
    data: new Uint8Array(data).slice(),
    password,
    cMapUrl: vendor('cmaps'),
    cMapPacked: true,
    standardFontDataUrl: vendor('standard_fonts'),
    wasmUrl: vendor('wasm'),
  })
  try {
    return await task.promise
  } catch (e) {
    if (e instanceof Error && e.name === 'PasswordException') {
      throw new PdfPasswordError((e as Error & { code?: number }).code === pdfjs.PasswordResponses.INCORRECT_PASSWORD)
    }
    if (e instanceof Error && e.name === 'InvalidPDFException') throw new Error('The PDF file is damaged or invalid.')
    throw e
  }
}

export interface PdfPageInfo {
  width: number
  height: number
  baseRotation: Rotation
  hasText: boolean
}

export async function readPageInfo(doc: PDFDocumentProxy): Promise<PdfPageInfo[]> {
  const out: PdfPageInfo[] = []
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i)
    const vp = page.getViewport({ scale: 1, rotation: 0 })
    const text = await page.getTextContent()
    out.push({
      width: vp.width,
      height: vp.height,
      baseRotation: (((page.rotate % 360) + 360) % 360) as Rotation,
      hasText: text.items.some((it) => 'str' in it && it.str.trim().length > 0),
    })
    page.cleanup()
  }
  return out
}

// Documents opened for rendering are cached per source blob id.
const cache = new Map<string, Promise<PDFDocumentProxy>>()

export function getCachedPdf(sourceId: string, load: () => Promise<Blob>): Promise<PDFDocumentProxy> {
  let p = cache.get(sourceId)
  if (!p) {
    p = load().then(async (b) => openPdf(await b.arrayBuffer()))
    p.catch(() => cache.delete(sourceId))
    cache.set(sourceId, p)
  }
  return p
}

export async function releasePdf(sourceId: string) {
  const p = cache.get(sourceId)
  cache.delete(sourceId)
  if (p) await (await p.catch(() => null))?.loadingTask.destroy()
}

/** Renders a page with the given total rotation so that its longer side is maxSide px. */
export async function renderPdfPageToCanvas(
  doc: PDFDocumentProxy,
  pageIndex: number,
  rotation: number,
  maxSide: number,
): Promise<HTMLCanvasElement> {
  const page = await doc.getPage(pageIndex + 1)
  const base = page.getViewport({ scale: 1, rotation })
  const scale = maxSide / Math.max(base.width, base.height)
  const viewport = page.getViewport({ scale, rotation })
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(viewport.width))
  canvas.height = Math.max(1, Math.round(viewport.height))
  const ctx = canvas.getContext('2d')!
  ctx.fillStyle = '#fff'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  await page.render({ canvas, canvasContext: ctx, viewport }).promise
  page.cleanup()
  return canvas
}

/** Extracts the existing text of a page in reading order (line breaks from y changes). */
export async function extractPageText(doc: PDFDocumentProxy, pageIndex: number): Promise<string> {
  const page = await doc.getPage(pageIndex + 1)
  const content = await page.getTextContent()
  let out = ''
  let lastY: number | null = null
  let lastEndX = 0
  for (const it of content.items) {
    if (!('str' in it)) continue
    const [, , , fontSize, x, y] = it.transform
    if (lastY !== null && Math.abs(y - lastY) > Math.max(2, Math.abs(fontSize) * 0.5)) out += '\n'
    // Items on the same line are separated by a space only when there is a visible gap.
    else if (lastY !== null && x - lastEndX > Math.abs(fontSize) * 0.2 && !/\s$/.test(out)) out += ' '
    out += it.str
    lastY = y
    lastEndX = x + it.width
    if (it.hasEOL) {
      out += '\n'
      lastY = null
    }
  }
  page.cleanup()
  return out.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim()
}
