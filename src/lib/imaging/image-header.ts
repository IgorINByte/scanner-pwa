// Reads pixel size and EXIF orientation from the first bytes of an image file, without
// decoding it. Used to pick a decode size up front so a 48 MP photo is never fully
// decoded just to be downscaled (iOS caps canvas/bitmap memory).

export interface ImageHeader {
  /** Stored (un-oriented) pixel size. */
  width: number
  height: number
  /** EXIF orientation 1..8 (1 = as stored). */
  orientation: number
}

/** True when the orientation swaps width and height (90° / 270° rotations). */
export const swapsAxes = (orientation: number) => orientation >= 5 && orientation <= 8

/** Size after applying the orientation. */
export function orientedSize(h: ImageHeader) {
  return swapsAxes(h.orientation) ? { width: h.height, height: h.width } : { width: h.width, height: h.height }
}

const u16 = (b: Uint8Array, o: number, le = false) => (le ? b[o] | (b[o + 1] << 8) : (b[o] << 8) | b[o + 1])
const u32 = (b: Uint8Array, o: number, le = false) =>
  le ? (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0 : ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0

function exifOrientation(b: Uint8Array, start: number, end: number): number {
  // start points at "Exif\0\0"
  if (u32(b, start) !== 0x45786966) return 1
  const tiff = start + 6
  if (tiff + 8 > end) return 1
  const le = b[tiff] === 0x49
  const ifd = tiff + u32(b, tiff + 4, le)
  if (ifd + 2 > end) return 1
  const count = u16(b, ifd, le)
  for (let i = 0; i < count; i++) {
    const e = ifd + 2 + i * 12
    if (e + 12 > end) break
    if (u16(b, e, le) === 0x0112) {
      const v = u16(b, e + 8, le)
      return v >= 1 && v <= 8 ? v : 1
    }
  }
  return 1
}

function jpeg(b: Uint8Array): ImageHeader | null {
  let o = 2
  let orientation = 1
  while (o + 4 <= b.length) {
    if (b[o] !== 0xff) return null
    const marker = b[o + 1]
    if (marker === 0xff) {
      o++
      continue
    }
    const len = u16(b, o + 2)
    if (marker === 0xe1) orientation = exifOrientation(b, o + 4, Math.min(b.length, o + 2 + len))
    // SOF0..SOF15 except DHT (C4), JPG (C8) and DAC (CC)
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      if (o + 9 > b.length) return null
      return { height: u16(b, o + 5), width: u16(b, o + 7), orientation }
    }
    o += 2 + len
  }
  return null
}

function png(b: Uint8Array): ImageHeader | null {
  if (b.length < 24) return null
  return { width: u32(b, 16), height: u32(b, 20), orientation: 1 }
}

function webp(b: Uint8Array): ImageHeader | null {
  if (b.length < 30) return null
  const chunk = String.fromCharCode(b[12], b[13], b[14], b[15])
  if (chunk === 'VP8 ') return { width: u16(b, 26, true) & 0x3fff, height: u16(b, 28, true) & 0x3fff, orientation: 1 }
  if (chunk === 'VP8L') {
    const bits = u32(b, 21, true)
    return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1, orientation: 1 }
  }
  if (chunk === 'VP8X') {
    const w = 1 + (b[24] | (b[25] << 8) | (b[26] << 16))
    const h = 1 + (b[27] | (b[28] << 8) | (b[29] << 16))
    return { width: w, height: h, orientation: 1 }
  }
  return null
}

/** Parses the header; returns null for unknown formats (e.g. HEIC) or truncated data. */
export function readImageHeader(bytes: Uint8Array): ImageHeader | null {
  const b = bytes
  if (b[0] === 0xff && b[1] === 0xd8) return jpeg(b)
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return png(b)
  if (b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57) return webp(b)
  return null
}

/** HEIF/HEIC container check (ISO-BMFF "ftyp" box with a HEIF brand). */
export function isHeif(bytes: Uint8Array): boolean {
  if (bytes.length < 12) return false
  if (String.fromCharCode(bytes[4], bytes[5], bytes[6], bytes[7]) !== 'ftyp') return false
  const brand = String.fromCharCode(bytes[8], bytes[9], bytes[10], bytes[11])
  return ['heic', 'heix', 'hevc', 'hevx', 'heim', 'heis', 'mif1', 'msf1'].includes(brand)
}
