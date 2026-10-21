import type { ExportFormat, Page, Quality } from '../types'
import { canvasToBlob, releaseCanvas } from './image'
import { renderPage } from './render'

export const QUALITY: Record<Quality, { label: string; maxSide: number; jpeg: number }> = {
  low: { label: 'Low', maxSide: 1240, jpeg: 0.5 },
  medium: { label: 'Medium', maxSide: 1754, jpeg: 0.72 },
  high: { label: 'High', maxSide: 2480, jpeg: 0.9 },
}

// A4 in PDF points (1/72 in).
const A4 = { w: 595.28, h: 841.89 }

export function defaultFileName(d = new Date()) {
  const p = (n: number) => String(n).padStart(2, '0')
  return `Scan_${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}`
}

export function sanitizeFileName(name: string) {
  const clean = name
    .trim()
    .replace(/\.(pdf|jpe?g|png)$/i, '')
    .replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '_')
  return clean || defaultFileName()
}

type Progress = (done: number, total: number) => void

export async function buildPdf(pages: Page[], quality: Quality, name: string, onProgress?: Progress): Promise<File> {
  const q = QUALITY[quality]
  const { PDFDocument } = await import('pdf-lib')
  const pdf = await PDFDocument.create()
  pdf.setProducer('Scanner PWA')
  pdf.setCreationDate(new Date())

  for (let i = 0; i < pages.length; i++) {
    onProgress?.(i, pages.length)
    const canvas = await renderPage(pages[i], q.maxSide)
    const jpg = await canvasToBlob(canvas, 'image/jpeg', q.jpeg)
    const { width, height } = canvas
    releaseCanvas(canvas)

    const image = await pdf.embedJpg(await jpg.arrayBuffer())
    // A4 portrait or landscape to match the page; the scan is fitted and centred.
    const landscape = width > height
    const pw = landscape ? A4.h : A4.w
    const ph = landscape ? A4.w : A4.h
    const s = Math.min(pw / width, ph / height)
    const page = pdf.addPage([pw, ph])
    page.drawImage(image, { x: (pw - width * s) / 2, y: (ph - height * s) / 2, width: width * s, height: height * s })
  }
  onProgress?.(pages.length, pages.length)
  const bytes = await pdf.save()
  return new File([bytes as BlobPart], `${name}.pdf`, { type: 'application/pdf' })
}

export async function buildImages(
  pages: Page[],
  format: 'jpeg' | 'png',
  quality: Quality,
  name: string,
  onProgress?: Progress,
): Promise<File[]> {
  const q = QUALITY[quality]
  const type = format === 'png' ? 'image/png' : 'image/jpeg'
  const ext = format === 'png' ? 'png' : 'jpg'
  const files: File[] = []
  for (let i = 0; i < pages.length; i++) {
    onProgress?.(i, pages.length)
    const canvas = await renderPage(pages[i], q.maxSide)
    const blob = await canvasToBlob(canvas, type, q.jpeg)
    releaseCanvas(canvas)
    const suffix = pages.length > 1 ? `_${String(i + 1).padStart(2, '0')}` : ''
    files.push(new File([blob], `${name}${suffix}.${ext}`, { type }))
  }
  onProgress?.(pages.length, pages.length)
  return files
}

export function buildExport(
  pages: Page[],
  format: ExportFormat,
  quality: Quality,
  name: string,
  onProgress?: Progress,
): Promise<File[]> {
  return format === 'pdf'
    ? buildPdf(pages, quality, name, onProgress).then((f) => [f])
    : buildImages(pages, format, quality, name, onProgress)
}

export function formatBytes(n: number) {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}
