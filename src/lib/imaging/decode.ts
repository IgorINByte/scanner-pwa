// Input decoding: file -> oriented ImageBitmap with the long edge <= INPUT_MAX_SIDE.
//
// - EXIF orientation is applied exactly once, by createImageBitmap(imageOrientation:
//   'from-image'). Nothing downstream may rotate by EXIF again.
// - The decode size is chosen from the file header, so large photos are downscaled during
//   decode instead of first being decoded at full size (iOS 17 caps bitmaps at ~16.7 MP).
// - HEIC/HEIF falls back to a lazily loaded libheif (WASM) only when the browser itself
//   cannot decode it (Safari can; Chrome/Firefox cannot).
import { isHeif, orientedSize, readImageHeader } from './image-header'

/** Long edge cap for decoded input: 4500 x 3375 = 15.2 MP, under iOS 17's 16.7 MP. */
export const INPUT_MAX_SIDE = 4500
const HEADER_BYTES = 256 * 1024

export class DecodeError extends Error {}

function scaleFor(w: number, h: number, maxSide: number) {
  return Math.min(1, maxSide / Math.max(w, h))
}

/** Downscales a bitmap so its long edge is <= maxSide; closes the input if it made a copy. */
async function capBitmap(bitmap: ImageBitmap, maxSide: number): Promise<ImageBitmap> {
  const s = scaleFor(bitmap.width, bitmap.height, maxSide)
  if (s >= 0.999) return bitmap
  const out = await createImageBitmap(bitmap, {
    resizeWidth: Math.max(1, Math.round(bitmap.width * s)),
    resizeHeight: Math.max(1, Math.round(bitmap.height * s)),
    resizeQuality: 'high',
  })
  bitmap.close()
  return out
}

async function decodeNative(file: Blob, bytes: Uint8Array, maxSide: number): Promise<ImageBitmap> {
  const header = readImageHeader(bytes)
  if (!header) {
    return capBitmap(await createImageBitmap(file, { imageOrientation: 'from-image' }), maxSide)
  }
  const s = scaleFor(header.width, header.height, maxSide)
  if (s >= 0.999) return createImageBitmap(file, { imageOrientation: 'from-image' })
  // Only resizeWidth is passed so the aspect ratio is kept whichever way the browser orders
  // "resize" and "orient". We ask for the oriented width; if the browser resized before
  // orienting, the long edge can come out too large, which capBitmap corrects.
  const oriented = orientedSize(header)
  const bitmap = await createImageBitmap(file, {
    imageOrientation: 'from-image',
    resizeWidth: Math.max(1, Math.round(oriented.width * s)),
    resizeQuality: 'high',
  })
  return capBitmap(bitmap, maxSide)
}

type HeifImage = {
  get_width(): number
  get_height(): number
  display(target: { data: Uint8ClampedArray; width: number; height: number }, cb: (r: unknown) => void): void
  free?(): void
}

async function decodeHeif(file: Blob, maxSide: number): Promise<ImageBitmap> {
  // libheif-js (LGPL-3.0) is loaded only here, as its own chunk.
  const mod = (await import('libheif-js/wasm-bundle')) as unknown as {
    default?: { HeifDecoder: new () => { decode(b: Uint8Array): HeifImage[] } }
    HeifDecoder?: new () => { decode(b: Uint8Array): HeifImage[] }
  }
  const lib = mod.default ?? mod
  const Decoder = lib.HeifDecoder
  if (!Decoder) throw new DecodeError('HEIC decoder failed to load')
  const images = new Decoder().decode(new Uint8Array(await file.arrayBuffer()))
  const img = images[0]
  if (!img) throw new DecodeError('No image found in HEIC file')
  try {
    const width = img.get_width()
    const height = img.get_height()
    const data = new Uint8ClampedArray(width * height * 4)
    // libheif applies the container's rotation/mirroring (irot/imir) itself; HEIF's EXIF
    // orientation must then be ignored, so no further rotation happens.
    await new Promise<void>((resolve, reject) =>
      img.display({ data, width, height }, (r) => (r ? resolve() : reject(new DecodeError('HEIC decoding failed')))),
    )
    const bitmap = await createImageBitmap(new ImageData(data, width, height))
    return capBitmap(bitmap, maxSide)
  } finally {
    images.forEach((i) => i.free?.())
  }
}

const looksHeif = (file: Blob, bytes: Uint8Array) =>
  isHeif(bytes) || /hei[cf]/i.test(file.type) || ('name' in file && /\.hei[cf]$/i.test((file as File).name))

/** Decodes an image file to an oriented bitmap whose long edge is <= maxSide. */
export async function decodeInput(file: Blob, maxSide = INPUT_MAX_SIDE): Promise<ImageBitmap> {
  const bytes = new Uint8Array(await file.slice(0, HEADER_BYTES).arrayBuffer())
  try {
    return await decodeNative(file, bytes, maxSide)
  } catch (e) {
    if (looksHeif(file, bytes)) return decodeHeif(file, maxSide)
    throw e instanceof Error ? e : new DecodeError(String(e))
  }
}
