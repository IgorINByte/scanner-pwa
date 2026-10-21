import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { PDFDocument, StandardFonts } from '@cantoo/pdf-lib'
import sharp from 'sharp'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { DEFAULT_WATERMARK, NO_ADJUSTMENTS, type Page, type PdfPage, type ScanPage } from '../../types'

const blobs = new Map<string, Blob>()

vi.mock('../storage/repository', () => ({
  repository: { getBlob: async (id: string) => blobs.get(id)! },
  pageOcrText: (o: { text: string; edited: string | null } | null) => (o ? (o.edited ?? o.text) : ''),
}))

// Scan pages are rendered by the browser worker in the app; here a fixed JPEG stands in.
let scanJpeg: Buffer
vi.mock('../render', async (orig) => ({
  ...(await orig<typeof import('../render')>()),
  renderPage: async () => ({ blob: new Blob([new Uint8Array(scanJpeg)], { type: 'image/jpeg' }), width: 1000, height: 1414 }),
}))

const { buildPdf, decryptPdf } = await import('./export')

async function sourcePdf(label: string, pages: number) {
  const doc = await PDFDocument.create()
  const font = await doc.embedFont(StandardFonts.Helvetica)
  for (let i = 0; i < pages; i++) {
    const p = doc.addPage([595, 842])
    p.drawText(`${label} page ${i + 1}`, { x: 50, y: 780, size: 20, font })
  }
  return doc.save()
}

async function pdfText(bytes: Uint8Array, password?: string) {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
  const doc = await pdfjs.getDocument({ data: bytes.slice(), password }).promise
  const out: string[] = []
  for (let i = 1; i <= doc.numPages; i++) {
    const tc = await (await doc.getPage(i)).getTextContent()
    out.push(tc.items.map((it) => ('str' in it ? it.str : '')).join(' '))
  }
  await doc.loadingTask.destroy()
  return out
}

const pdfPage = (sourceId: string, pageIndex: number, rotation: 0 | 90 = 0): PdfPage => ({
  kind: 'pdf',
  id: `${sourceId}-${pageIndex}`,
  sourceId,
  pageIndex,
  width: 595,
  height: 842,
  baseRotation: 0,
  hasText: true,
  rotation,
  annotations: [],
  ocr: null,
})

const scanPage: ScanPage = {
  kind: 'scan',
  id: 'scan1',
  sourceId: 'img',
  width: 1000,
  height: 1414,
  corners: null,
  detection: 'none',
  paper: 'auto',
  filter: 'original',
  adjust: NO_ADJUSTMENTS,
  rotation: 0,
  annotations: [
    { id: 'a1', type: 'highlight', x: 0.1, y: 0.1, w: 0.3, h: 0.05, color: '#facc15' },
    { id: 'a2', type: 'text', x: 0.1, y: 0.5, text: 'Napomena: čćžšđ', color: '#1d4ed8', size: 0.03 },
    { id: 'a3', type: 'ink', points: [0.1, 0.7, 0.2, 0.75, 0.3, 0.7], color: '#dc2626', size: 0.004 },
  ],
  ocr: {
    source: 'ocr',
    lang: 'hrv+eng',
    text: 'Račun broj 42',
    edited: null,
    words: [
      { t: 'Račun', b: [0.1, 0.2, 0.25, 0.23] },
      { t: 'broj', b: [0.27, 0.2, 0.35, 0.23] },
      { t: '42', b: [0.37, 0.2, 0.41, 0.23] },
    ],
    confidence: 90,
    key: '',
    at: 0,
  },
}

const baseOpts = {
  pageSize: 'a4' as const,
  orientation: 'auto' as const,
  quality: 'medium' as const,
  textLayer: true,
  annotations: true,
  watermark: null,
  rasterizePdfPages: false,
  password: '',
  title: 'Test',
}

beforeAll(async () => {
  blobs.set('A', new Blob([new Uint8Array(await sourcePdf('Alpha', 3))]))
  blobs.set('B', new Blob([new Uint8Array(await sourcePdf('Beta', 2))]))
  scanJpeg = await sharp({ create: { width: 1000, height: 1414, channels: 3, background: '#f5f5f5' } }).jpeg().toBuffer()
  const font = readFileSync(join(process.cwd(), 'public/vendor/fonts/DejaVuSans.ttf'))
  vi.stubGlobal('fetch', async (url: string) => {
    if (String(url).endsWith('DejaVuSans.ttf')) return new Response(new Uint8Array(font))
    throw new Error(`unexpected fetch ${url}`)
  })
})

describe('buildPdf', () => {
  it('merges pages from several PDFs in the chosen order, keeping their text, applying rotation', async () => {
    const pages: Page[] = [pdfPage('B', 1), pdfPage('A', 0, 90), pdfPage('A', 2)]
    const bytes = await buildPdf(pages, baseOpts)
    const out = await PDFDocument.load(bytes)
    expect(out.getPageCount()).toBe(3)
    expect(out.getPage(1).getRotation().angle).toBe(90)
    const text = await pdfText(bytes)
    expect(text[0]).toContain('Beta page 2')
    expect(text[1]).toContain('Alpha page 1')
    expect(text[2]).toContain('Alpha page 3')
  })

  it('embeds scans on A4 with an invisible, searchable OCR layer, annotations and watermark', async () => {
    const bytes = await buildPdf([scanPage], {
      ...baseOpts,
      watermark: { ...DEFAULT_WATERMARK, enabled: true, text: 'POVJERLJIVO' },
    })
    const out = await PDFDocument.load(bytes)
    const { width, height } = out.getPage(0).getSize()
    expect(Math.round(width)).toBe(595)
    expect(Math.round(height)).toBe(842)
    const [text] = await pdfText(bytes)
    expect(text).toContain('Račun')
    expect(text).toContain('čćžšđ') // text annotation with Croatian characters
    expect(text).toContain('POVJERLJIVO')
  })

  it('auto page size follows the image proportions', async () => {
    const bytes = await buildPdf([scanPage], { ...baseOpts, pageSize: 'auto', textLayer: false, annotations: false })
    const { width, height } = (await PDFDocument.load(bytes)).getPage(0).getSize()
    expect(height / width).toBeCloseTo(1414 / 1000, 2)
  })

  it('encrypts with a password (AES) and can be decrypted again', async () => {
    const bytes = await buildPdf([pdfPage('A', 0)], { ...baseOpts, password: 'tajna123' })
    await expect(pdfText(bytes)).rejects.toThrow(/password/i)
    expect((await pdfText(bytes, 'tajna123'))[0]).toContain('Alpha page 1')
    const plain = await decryptPdf(bytes.buffer as ArrayBuffer, 'tajna123')
    expect((await pdfText(plain))[0]).toContain('Alpha page 1')
  })

  it('reports progress for every page', async () => {
    const calls: number[] = []
    await buildPdf([pdfPage('A', 0), pdfPage('A', 1)], baseOpts, (d) => calls.push(d))
    expect(calls).toEqual([0, 1, 2])
  })
})
