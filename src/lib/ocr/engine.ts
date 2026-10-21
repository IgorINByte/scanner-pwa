// OCR with Tesseract.js. The worker, WASM core and language models are self-hosted under
// /vendor (copied from npm at install time), so no image or text ever leaves the device.
import type { Worker as TesseractWorker } from 'tesseract.js'
import type { OcrLang, OcrResult, OcrWord, Page } from '../../types'
import { getCachedPdf, extractPageText } from '../pdf/pdfjs'
import { pageKey, renderPage } from '../render'
import { repository } from '../storage/repository'

const OCR_SIDE = 2200

let current: { lang: OcrLang; worker: Promise<TesseractWorker> } | null = null
type Listener = (status: string, progress: number) => void
let listener: Listener | null = null

const vendor = (p: string) => `${import.meta.env.BASE_URL}vendor/${p}`

function getWorker(lang: OcrLang): Promise<TesseractWorker> {
  if (current?.lang === lang) return current.worker
  const prev = current
  const worker = (async () => {
    if (prev) (await prev.worker.catch(() => null))?.terminate()
    const { createWorker, OEM } = await import('tesseract.js')
    return createWorker(lang.split('+'), OEM.LSTM_ONLY, {
      workerPath: vendor('tesseract/worker.min.js'),
      corePath: vendor('tesseract'),
      langPath: vendor('tessdata'),
      gzip: true,
      workerBlobURL: false,
      logger: (m) => listener?.(m.status, m.progress),
    })
  })()
  worker.catch(() => {
    if (current?.worker === worker) current = null
  })
  current = { lang, worker }
  return worker
}

export async function terminateOcr() {
  const c = current
  current = null
  if (c) (await c.worker.catch(() => null))?.terminate()
}

interface TBox {
  x0: number
  y0: number
  x1: number
  y1: number
}

/** Recognises one page. For PDF pages that already contain text, that text is used instead. */
export async function recognizePage(page: Page, lang: OcrLang, onStatus?: Listener): Promise<OcrResult> {
  const key = pageKey(page)
  if (page.kind === 'pdf' && page.hasText) {
    const doc = await getCachedPdf(page.sourceId, () => repository.getBlob(page.sourceId))
    const text = await extractPageText(doc, page.pageIndex)
    return { source: 'pdf-text', lang: null, text, edited: null, words: [], confidence: null, key, at: Date.now() }
  }

  onStatus?.('preparing page', 0)
  const img = await renderPage(page, { maxSide: OCR_SIDE, type: 'image/png' })
  listener = onStatus ?? null
  try {
    const worker = await getWorker(lang)
    const { data } = await worker.recognize(img.blob, {}, { text: true, blocks: true })
    const words: OcrWord[] = []
    const lines: string[] = []
    // Blocks -> paragraphs -> lines -> words keeps Tesseract's reading order.
    for (const block of data.blocks ?? []) {
      for (const para of block.paragraphs) {
        for (const line of para.lines) {
          const lw = line.words.filter((w) => w.text.trim() && w.confidence > 10)
          if (lw.length) lines.push(lw.map((w) => w.text).join(' '))
          for (const w of lw) {
            const b = w.bbox as TBox
            words.push({ t: w.text, b: [b.x0 / img.width, b.y0 / img.height, b.x1 / img.width, b.y1 / img.height] })
          }
        }
        lines.push('')
      }
    }
    const text = lines.join('\n').replace(/\n{3,}/g, '\n\n').trim()
    return { source: 'ocr', lang, text, edited: null, words, confidence: data.confidence, key, at: Date.now() }
  } finally {
    listener = null
  }
}
