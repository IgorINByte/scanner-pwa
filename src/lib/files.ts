// Input validation: accepted formats are checked by MIME type / extension *and* by the
// file's magic bytes, so a renamed or corrupted file is rejected with a clear message.

export const IMAGE_ACCEPT = 'image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp'
export const PDF_ACCEPT = 'application/pdf,.pdf'

export const MAX_IMAGE_BYTES = 40 * 1024 * 1024
export const MAX_PDF_BYTES = 200 * 1024 * 1024

export type FileKind = 'jpeg' | 'png' | 'webp' | 'pdf'

export class FileValidationError extends Error {
  constructor(
    public fileName: string,
    message: string,
  ) {
    super(message)
  }
}

/** Detects the real type from the first bytes of the file. */
export function sniff(bytes: Uint8Array): FileKind | null {
  const b = bytes
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'jpeg'
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'png'
  if (b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50)
    return 'webp'
  // %PDF may be preceded by junk bytes; the spec allows up to 1024.
  for (let i = 0; i < Math.min(b.length - 4, 1024); i++) {
    if (b[i] === 0x25 && b[i + 1] === 0x50 && b[i + 2] === 0x44 && b[i + 3] === 0x46) return 'pdf'
  }
  return null
}

const formatList = 'JPG, PNG, WebP or PDF'

export async function validateFile(file: File, expect: 'image' | 'pdf' | 'any'): Promise<FileKind> {
  if (file.size === 0) throw new FileValidationError(file.name, 'The file is empty.')
  const kind = sniff(new Uint8Array(await file.slice(0, 1024).arrayBuffer()))
  if (!kind) throw new FileValidationError(file.name, `Unsupported or damaged file. Use ${formatList}.`)
  if (expect === 'image' && kind === 'pdf') throw new FileValidationError(file.name, 'This is a PDF — use “Open PDF”.')
  if (expect === 'pdf' && kind !== 'pdf') throw new FileValidationError(file.name, 'This is not a PDF file.')
  const max = kind === 'pdf' ? MAX_PDF_BYTES : MAX_IMAGE_BYTES
  if (file.size > max) throw new FileValidationError(file.name, `File is too large (max ${Math.round(max / 1024 / 1024)} MB).`)
  return kind
}

export function sanitizeFileName(name: string, fallback: string) {
  const clean = name
    .normalize('NFC')
    .trim()
    .replace(/\.(pdf|jpe?g|png|txt|docx)$/i, '')
    // eslint-disable-next-line no-control-regex
    .replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '_')
    .replace(/^\.+/, '')
    .slice(0, 120)
  return clean || fallback
}

export function defaultFileName(d = new Date()) {
  const p = (n: number) => String(n).padStart(2, '0')
  return `Scan_${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}`
}

export function formatBytes(n: number) {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}
