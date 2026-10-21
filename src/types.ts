export type Point = { x: number; y: number }

/** Document corners in source-image pixels, ordered top-left, top-right, bottom-right, bottom-left. */
export type Corners = [Point, Point, Point, Point]

export type FilterId = 'original' | 'document' | 'grayscale' | 'enhanced'
export type Rotation = 0 | 90 | 180 | 270
export type ScanMode = 'single' | 'multi'
export type ExportFormat = 'pdf' | 'jpeg' | 'png'
export type Quality = 'low' | 'medium' | 'high'

export interface Page {
  id: string
  /** Downscaled original (longer side <= 2480 px), JPEG. */
  source: Blob
  width: number
  height: number
  /** null while auto-detection is still pending. */
  corners: Corners | null
  filter: FilterId
  rotation: Rotation
  thumbUrl?: string
  /** Settings key the current thumbnail was rendered for. */
  thumbKey?: string
}

export const FILTERS: { id: FilterId; label: string }[] = [
  { id: 'original', label: 'Original' },
  { id: 'document', label: 'Document' },
  { id: 'grayscale', label: 'Grayscale' },
  { id: 'enhanced', label: 'Enhanced' },
]
