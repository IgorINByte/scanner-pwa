// Turning files / camera frames into document pages.
import { DEFAULT_WATERMARK, NO_ADJUSTMENTS, type FilterId, type OcrLang, type PdfPage, type ScanDocument, type ScanPage } from '../../types'
import { FileValidationError, defaultFileName, validateFile } from '../files'
import { prepareImage, type PreparedImage } from '../image'
import { decryptPdf } from '../pdf/export'
import { openPdf, PdfPasswordError, readPageInfo } from '../pdf/pdfjs'
import { repository } from '../storage/repository'
import { uid } from '../uid'

const FILTER_KEY = 'scanner.defaultFilter'
const LANG_KEY = 'scanner.ocrLang'

function readSetting<T extends string>(key: string, fallback: T): T {
  try {
    return (localStorage.getItem(key) as T) || fallback
  } catch {
    return fallback
  }
}

export function rememberSetting(key: 'filter' | 'ocrLang', value: string) {
  try {
    localStorage.setItem(key === 'filter' ? FILTER_KEY : LANG_KEY, value)
  } catch {
    // storage unavailable (private mode) - not important
  }
}

export function newDocument(name = defaultFileName()): ScanDocument {
  const now = Date.now()
  return {
    id: uid(),
    name,
    folderId: null,
    createdAt: now,
    updatedAt: now,
    pages: [],
    watermark: { ...DEFAULT_WATERMARK },
    ocrLang: readSetting<OcrLang>(LANG_KEY, 'hrv+eng'),
    status: 'draft',
  }
}

export async function scanPageFromImage(docId: string, img: PreparedImage): Promise<ScanPage> {
  return {
    kind: 'scan',
    id: uid(),
    sourceId: await repository.putBlob(docId, img.blob),
    width: img.width,
    height: img.height,
    corners: null,
    detection: null,
    paper: 'auto',
    filter: readSetting<FilterId>(FILTER_KEY, 'auto'),
    adjust: { ...NO_ADJUSTMENTS },
    rotation: 0,
    annotations: [],
    ocr: null,
  }
}

export interface ImportIssue {
  file: string
  message: string
}

export interface ImportResult<T> {
  pages: T[]
  issues: ImportIssue[]
}

type Progress = (done: number, total: number, file: string) => void

export async function importImages(docId: string, files: File[], onProgress?: Progress): Promise<ImportResult<ScanPage>> {
  const pages: ScanPage[] = []
  const issues: ImportIssue[] = []
  for (const [i, f] of files.entries()) {
    onProgress?.(i, files.length, f.name)
    try {
      await validateFile(f, 'image')
      pages.push(await scanPageFromImage(docId, await prepareImage(f)))
    } catch (e) {
      issues.push({
        file: f.name,
        message: e instanceof FileValidationError ? e.message : 'The image could not be decoded (damaged or unsupported).',
      })
    }
  }
  onProgress?.(files.length, files.length, '')
  return { pages, issues }
}

/** Asks the user for a PDF password; resolves null if they cancel. */
export type PasswordPrompt = (fileName: string, incorrect: boolean) => Promise<string | null>

export async function importPdf(docId: string, file: File, askPassword: PasswordPrompt): Promise<PdfPage[]> {
  await validateFile(file, 'pdf')
  let bytes: ArrayBuffer = await file.arrayBuffer()
  let pdf
  let password: string | undefined
  for (;;) {
    try {
      pdf = await openPdf(bytes, password)
      break
    } catch (e) {
      if (!(e instanceof PdfPasswordError)) throw e
      const pw = await askPassword(file.name, e.incorrect)
      if (pw === null) throw new Error('Opening cancelled — the PDF is password protected.')
      password = pw
    }
  }
  if (password) {
    // Store a decrypted copy so pages can be edited/exported without asking again.
    bytes = (await decryptPdf(bytes, password)).buffer as ArrayBuffer
  }
  try {
    const info = await readPageInfo(pdf)
    const sourceId = await repository.putBlob(docId, new Blob([bytes], { type: 'application/pdf' }))
    return info.map((p, pageIndex) => ({
      kind: 'pdf',
      id: uid(),
      sourceId,
      pageIndex,
      width: p.width,
      height: p.height,
      baseRotation: p.baseRotation,
      hasText: p.hasText,
      rotation: 0,
      annotations: [],
      ocr: null,
    }))
  } finally {
    await pdf.loadingTask.destroy()
  }
}
