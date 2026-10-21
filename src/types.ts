export type Point = { x: number; y: number }

/** Document corners in source-image pixels, ordered top-left, top-right, bottom-right, bottom-left. */
export type Corners = [Point, Point, Point, Point]

export type Rotation = 0 | 90 | 180 | 270
export type ScanMode = 'single' | 'multi'
export type ExportFormat = 'pdf' | 'jpeg' | 'png'
export type Quality = 'low' | 'medium' | 'high'

// ---------------------------------------------------------------- image processing

export type FilterId = 'original' | 'auto' | 'color' | 'grayscale' | 'document' | 'text'

export const FILTERS: { id: FilterId; label: string; hint: string }[] = [
  { id: 'original', label: 'Original', hint: 'No filter' },
  { id: 'auto', label: 'Auto', hint: 'Removes shadows, whitens paper' },
  { id: 'color', label: 'Color', hint: 'Vivid, auto-levelled colors' },
  { id: 'grayscale', label: 'Grayscale', hint: 'Shades of gray' },
  { id: 'document', label: 'B&W', hint: 'Black & white document' },
  { id: 'text', label: 'Text', hint: 'Darker, sharper text' },
]

/** Manual adjustments. brightness/contrast: -100..100, the rest 0..100. */
export interface Adjustments {
  brightness: number
  contrast: number
  sharpness: number
  denoise: number
  shadows: number
  whiten: number
}

export const NO_ADJUSTMENTS: Adjustments = { brightness: 0, contrast: 0, sharpness: 0, denoise: 0, shadows: 0, whiten: 0 }

/** Target aspect ratio for perspective correction. */
export type PaperFormat = 'auto' | 'a4' | 'a5' | 'letter'

export const PAPER_FORMATS: { id: PaperFormat; label: string }[] = [
  { id: 'auto', label: 'Auto' },
  { id: 'a4', label: 'A4' },
  { id: 'a5', label: 'A5' },
  { id: 'letter', label: 'Letter' },
]

/** Everything the image pipeline needs to render a scan page. */
export interface ScanParams {
  corners: Corners | null
  paper: PaperFormat
  filter: FilterId
  adjust: Adjustments
  rotation: Rotation
}

// ---------------------------------------------------------------- annotations

/** Coordinates are normalised to the displayed page: x,w by page width; y,h by page height. */
export type Annotation =
  | { id: string; type: 'highlight'; x: number; y: number; w: number; h: number; color: string }
  | { id: string; type: 'rect'; x: number; y: number; w: number; h: number; color: string; size: number }
  | { id: string; type: 'underline'; x1: number; y1: number; x2: number; y2: number; color: string; size: number }
  | { id: string; type: 'ink'; points: number[]; color: string; size: number }
  | { id: string; type: 'text'; x: number; y: number; text: string; color: string; size: number }
  | { id: string; type: 'image'; x: number; y: number; w: number; h: number; src: string }

export type AnnotationType = Annotation['type']

export interface Watermark {
  enabled: boolean
  text: string
  /** Font size as a fraction of the page width. */
  size: number
  opacity: number
  position: 'diagonal' | 'center' | 'top' | 'bottom'
  color: string
}

export const DEFAULT_WATERMARK: Watermark = {
  enabled: false,
  text: 'CONFIDENTIAL',
  size: 0.09,
  opacity: 0.18,
  position: 'diagonal',
  color: '#dc2626',
}

// ---------------------------------------------------------------- OCR

export type OcrLang = 'hrv' | 'eng' | 'hrv+eng'

export const OCR_LANGS: { id: OcrLang; label: string }[] = [
  { id: 'hrv+eng', label: 'Croatian + English' },
  { id: 'hrv', label: 'Croatian' },
  { id: 'eng', label: 'English' },
]

/** A recognised word; bbox normalised to the displayed page [x0, y0, x1, y1]. */
export interface OcrWord {
  t: string
  b: [number, number, number, number]
}

export interface OcrResult {
  source: 'ocr' | 'pdf-text'
  lang: OcrLang | null
  text: string
  /** Text as edited by the user (used for search/TXT/DOCX); null = unedited. */
  edited: string | null
  words: OcrWord[]
  confidence: number | null
  /** Page render key at recognition time; differs from the current key when the page changed since. */
  key: string
  at: number
}

// ---------------------------------------------------------------- pages & documents

interface PageBase {
  id: string
  /** Id of the source blob in storage. */
  sourceId: string
  rotation: Rotation
  annotations: Annotation[]
  ocr: OcrResult | null
}

export interface ScanPage extends PageBase {
  kind: 'scan'
  /** Source image size in pixels (already downscaled to <= 2480 px). */
  width: number
  height: number
  /** null while auto-detection is still pending. */
  corners: Corners | null
  detection: 'found' | 'approx' | 'none' | null
  paper: PaperFormat
  filter: FilterId
  adjust: Adjustments
}

export interface PdfPage extends PageBase {
  kind: 'pdf'
  /** Zero-based page index in the source PDF. */
  pageIndex: number
  /** Unrotated page size in PDF points. */
  width: number
  height: number
  /** /Rotate already present in the source PDF. */
  baseRotation: Rotation
  /** Whether the source page already contains a text layer. */
  hasText: boolean
}

export type Page = ScanPage | PdfPage

export interface ScanDocument {
  id: string
  name: string
  folderId: string | null
  createdAt: number
  updatedAt: number
  pages: Page[]
  watermark: Watermark
  ocrLang: OcrLang
  /** draft until exported at least once */
  status: 'draft' | 'exported'
}

export type DocumentKind = 'scan' | 'pdf' | 'mixed' | 'empty'

export function documentKind(doc: Pick<ScanDocument, 'pages'>): DocumentKind {
  const kinds = new Set(doc.pages.map((p) => p.kind))
  if (kinds.size === 0) return 'empty'
  if (kinds.size === 2) return 'mixed'
  return kinds.has('pdf') ? 'pdf' : 'scan'
}

export interface Folder {
  id: string
  name: string
  createdAt: number
}
