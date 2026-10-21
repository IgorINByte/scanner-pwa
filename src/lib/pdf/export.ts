// Builds a real PDF (pdf-lib): scans are embedded as JPEG pages; pages of imported PDFs
// are copied as-is (keeping their text and vector content) unless rasterising is requested.
// Annotations, watermark and an invisible OCR text layer are drawn on top.
import type { PDFDocument, PDFFont, PDFPage } from '@cantoo/pdf-lib'
import type { Annotation, Page, Quality, Watermark } from '../../types'
import { watermarkPlacement } from '../annotations/canvas'
import { renderPage, totalRotation } from '../render'
import { repository } from '../storage/repository'
import { createMapper, placeImage, type Mapper, type Orientation, type PageSize } from './layout'

export const QUALITY: Record<Quality, { label: string; hint: string; maxSide: number; jpeg: number }> = {
  low: { label: 'Smaller file', hint: '150 dpi', maxSide: 1240, jpeg: 0.55 },
  medium: { label: 'Balanced', hint: '200 dpi', maxSide: 1754, jpeg: 0.75 },
  high: { label: 'Best quality', hint: '300 dpi', maxSide: 2480, jpeg: 0.9 },
}

export interface PdfOptions {
  pageSize: PageSize
  orientation: Orientation
  quality: Quality
  /** Invisible OCR text so the PDF is searchable / selectable. */
  textLayer: boolean
  annotations: boolean
  watermark: Watermark | null
  /** Turn pages of imported PDFs into images too (smaller, but loses their text/vectors). */
  rasterizePdfPages: boolean
  /** AES-256 encryption when non-empty. */
  password: string
  title: string
}

type Progress = (done: number, total: number) => void

type PdfLib = typeof import('@cantoo/pdf-lib')

let fontBytes: Promise<ArrayBuffer> | null = null
function loadUnicodeFont() {
  fontBytes ??= fetch(`${import.meta.env.BASE_URL}vendor/fonts/DejaVuSans.ttf`).then((r) => {
    if (!r.ok) throw new Error('Could not load font')
    return r.arrayBuffer()
  })
  return fontBytes
}

function hexColor(lib: PdfLib, hex: string) {
  const n = parseInt(hex.replace('#', ''), 16)
  return lib.rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255)
}

const needsFont = (pages: Page[], opts: PdfOptions) =>
  !!opts.watermark?.enabled ||
  (opts.annotations && pages.some((p) => p.annotations.some((a) => a.type === 'text'))) ||
  (opts.textLayer && pages.some((p) => p.ocr?.words.length))

async function dataUrlBytes(src: string) {
  return new Uint8Array(await (await fetch(src)).arrayBuffer())
}

function drawAnnotations(lib: PdfLib, pdfPage: PDFPage, m: Mapper, list: Annotation[], font: PDFFont | null, images: Map<string, import('@cantoo/pdf-lib').PDFImage>) {
  const rot = lib.degrees(m.rotate)
  for (const a of list) {
    switch (a.type) {
      case 'highlight':
      case 'rect': {
        const p = m.map(a.x, a.y + a.h)
        const common = { x: p.x, y: p.y, width: a.w * m.dispW, height: a.h * m.dispH, rotate: rot }
        if (a.type === 'highlight')
          pdfPage.drawRectangle({ ...common, color: hexColor(lib, a.color), opacity: 0.38, blendMode: lib.BlendMode.Multiply })
        else pdfPage.drawRectangle({ ...common, borderColor: hexColor(lib, a.color), borderWidth: a.size * m.dispW })
        break
      }
      case 'underline':
        pdfPage.drawLine({
          start: m.map(a.x1, a.y1),
          end: m.map(a.x2, a.y2),
          thickness: a.size * m.dispW,
          color: hexColor(lib, a.color),
          lineCap: lib.LineCapStyle.Round,
        })
        break
      case 'ink': {
        const color = hexColor(lib, a.color)
        for (let i = 2; i < a.points.length; i += 2) {
          pdfPage.drawLine({
            start: m.map(a.points[i - 2], a.points[i - 1]),
            end: m.map(a.points[i], a.points[i + 1]),
            thickness: a.size * m.dispW,
            color,
            lineCap: lib.LineCapStyle.Round,
          })
        }
        break
      }
      case 'text': {
        if (!font) break
        const size = a.size * m.dispW
        a.text.split('\n').forEach((line, i) => {
          const top = a.y + (i * size * 1.2) / m.dispH
          const p = m.map(a.x, top + (size * 0.8) / m.dispH)
          pdfPage.drawText(line, { x: p.x, y: p.y, size, font, color: hexColor(lib, a.color), rotate: rot })
        })
        break
      }
      case 'image': {
        const img = images.get(a.src)
        if (!img) break
        const p = m.map(a.x, a.y + a.h)
        pdfPage.drawImage(img, { x: p.x, y: p.y, width: a.w * m.dispW, height: a.h * m.dispH, rotate: rot })
        break
      }
    }
  }
}

/** Invisible (render mode 3) text positioned over each recognised word. */
function drawTextLayer(lib: PdfLib, pdfPage: PDFPage, m: Mapper, page: Page, font: PDFFont) {
  const words = page.ocr?.words ?? []
  if (!words.length) return
  const key = pdfPage.node.newFontDictionary(font.name, font.ref)
  const rad = (m.rotate * Math.PI) / 180
  const cos = Math.cos(rad)
  const sin = Math.sin(rad)
  const ops = [lib.pushGraphicsState(), lib.beginText(), lib.setTextRenderingMode(lib.TextRenderingMode.Invisible)]
  for (const w of words) {
    const [x0, y0, x1, y1] = w.b
    const size = Math.max(1, (y1 - y0) * m.dispH * 0.9)
    const natural = font.widthOfTextAtSize(w.t, size)
    const target = (x1 - x0) * m.dispW
    if (natural <= 0 || target <= 0) continue
    // Baseline sits a little above the bottom of the word box (descenders).
    const p = m.map(x0, y1 - (y1 - y0) * 0.18)
    ops.push(
      lib.setFontAndSize(key, size),
      lib.setCharacterSqueeze(Math.max(10, Math.min(500, (target / natural) * 100))),
      lib.setTextMatrix(cos, sin, -sin, cos, p.x, p.y),
      lib.showText(font.encodeText(`${w.t} `)),
    )
  }
  ops.push(lib.endText(), lib.popGraphicsState())
  pdfPage.pushOperators(...ops)
}

function drawWatermark(lib: PdfLib, pdfPage: PDFPage, m: Mapper, wm: Watermark, font: PDFFont) {
  if (!wm.text.trim()) return
  const { cx, cy, angle, fontSize } = watermarkPlacement(wm, m.dispW, m.dispH)
  const textW = font.widthOfTextAtSize(wm.text, fontSize)
  const a = (angle * Math.PI) / 180
  // Start of the baseline in display space (y down), centred on (cx, cy).
  const half = fontSize * 0.35
  const sx = cx - (textW / 2) * Math.cos(a) + half * Math.sin(a)
  const sy = cy + (textW / 2) * Math.sin(a) + half * Math.cos(a)
  const p = m.map(sx / m.dispW, sy / m.dispH)
  pdfPage.drawText(wm.text, {
    x: p.x,
    y: p.y,
    size: fontSize,
    font,
    color: hexColor(lib, wm.color),
    opacity: wm.opacity,
    rotate: lib.degrees(m.rotate + angle),
  })
}

export async function buildPdf(pages: Page[], opts: PdfOptions, onProgress?: Progress): Promise<Uint8Array> {
  const lib = await import('@cantoo/pdf-lib')
  const pdf = await lib.PDFDocument.create()
  pdf.setTitle(opts.title)
  pdf.setProducer('Scanner PWA')
  pdf.setCreator('Scanner PWA')
  pdf.setCreationDate(new Date())

  let font: PDFFont | null = null
  if (needsFont(pages, opts)) {
    const fontkit = (await import('@cantoo/fontkit')).default
    pdf.registerFontkit(fontkit)
    font = await pdf.embedFont(await loadUnicodeFont(), { subset: true })
  }

  const images = new Map<string, import('@cantoo/pdf-lib').PDFImage>()
  if (opts.annotations) {
    for (const p of pages)
      for (const a of p.annotations)
        if (a.type === 'image' && !images.has(a.src)) images.set(a.src, await pdf.embedPng(await dataUrlBytes(a.src)))
  }

  const sources = new Map<string, PDFDocument>()
  const q = QUALITY[opts.quality]

  for (let i = 0; i < pages.length; i++) {
    onProgress?.(i, pages.length)
    const page = pages[i]
    let pdfPage: PDFPage
    let mapper: Mapper

    if (page.kind === 'pdf' && !opts.rasterizePdfPages) {
      let src = sources.get(page.sourceId)
      if (!src) {
        const bytes = await (await repository.getBlob(page.sourceId)).arrayBuffer()
        src = await lib.PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false })
        sources.set(page.sourceId, src)
      }
      ;[pdfPage] = await pdf.copyPages(src, [page.pageIndex])
      pdf.addPage(pdfPage)
      const rotation = totalRotation(page)
      pdfPage.setRotation(lib.degrees(rotation))
      const box = pdfPage.getCropBox()
      mapper = createMapper({ x: box.x, y: box.y, w: box.width, h: box.height }, rotation)
    } else {
      const img = await renderPage(page, { maxSide: q.maxSide, type: 'image/jpeg', quality: q.jpeg })
      const embedded = await pdf.embedJpg(await img.blob.arrayBuffer())
      const layout = placeImage(img.width, img.height, opts.pageSize, opts.orientation)
      pdfPage = pdf.addPage([layout.pageWidth, layout.pageHeight])
      pdfPage.drawImage(embedded, { x: layout.image.x, y: layout.image.y, width: layout.image.w, height: layout.image.h })
      mapper = createMapper(layout.image, 0)
    }

    if (opts.textLayer && font && !(page.kind === 'pdf' && page.hasText && !opts.rasterizePdfPages))
      drawTextLayer(lib, pdfPage, mapper, page, font)
    if (opts.annotations && page.annotations.length) drawAnnotations(lib, pdfPage, mapper, page.annotations, font, images)
    if (opts.watermark?.enabled && font) drawWatermark(lib, pdfPage, mapper, opts.watermark, font)

    // Let the UI breathe between pages on long documents.
    await new Promise((r) => setTimeout(r, 0))
  }
  onProgress?.(pages.length, pages.length)

  if (opts.password) {
    pdf.encrypt({
      userPassword: opts.password,
      ownerPassword: opts.password,
      permissions: { printing: 'highResolution', modifying: true, copying: true, annotating: true, fillingForms: true },
    })
  }
  return pdf.save({ useObjectStreams: true })
}

/** Loads an existing PDF (decrypting it if a password is given) and returns plain bytes. */
export async function decryptPdf(bytes: ArrayBuffer, password: string): Promise<Uint8Array> {
  const lib = await import('@cantoo/pdf-lib')
  const doc = await lib.PDFDocument.load(bytes, { password })
  return doc.save()
}
