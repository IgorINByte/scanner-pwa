// Plain RGBA pixel buffers so the processing code runs identically in a Web Worker,
// on the main thread and in unit tests (no DOM / canvas required).

export interface Img {
  data: Uint8ClampedArray
  width: number
  height: number
}

export function createImg(width: number, height: number): Img {
  return { data: new Uint8ClampedArray(width * height * 4), width, height }
}

export function cloneImg(img: Img): Img {
  return { data: new Uint8ClampedArray(img.data), width: img.width, height: img.height }
}

/** Rec. 601 luma of every pixel. */
export function luminance(img: Img): Float32Array {
  const { data } = img
  const out = new Float32Array(img.width * img.height)
  for (let i = 0, p = 0; p < out.length; i += 4, p++) out[p] = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]
  return out
}

/** Writes a single-channel plane back as gray RGB (alpha untouched). */
export function writeGray(img: Img, plane: ArrayLike<number>) {
  const { data } = img
  for (let i = 0, p = 0; p < plane.length; i += 4, p++) data[i] = data[i + 1] = data[i + 2] = plane[p]
}

/** Applies a 256-entry lookup table to the RGB channels. */
export function applyLut(img: Img, lut: Uint8ClampedArray) {
  const { data } = img
  for (let i = 0; i < data.length; i += 4) {
    data[i] = lut[data[i]]
    data[i + 1] = lut[data[i + 1]]
    data[i + 2] = lut[data[i + 2]]
  }
}

export function buildLut(fn: (v: number) => number) {
  const lut = new Uint8ClampedArray(256)
  for (let v = 0; v < 256; v++) lut[v] = fn(v)
  return lut
}

/** Separable box blur of a single-channel plane (sliding window, O(n) per radius). */
export function boxBlur(src: ArrayLike<number>, w: number, h: number, r: number): Float32Array {
  const tmp = new Float32Array(w * h)
  const out = new Float32Array(w * h)
  if (r < 1) {
    for (let i = 0; i < out.length; i++) out[i] = src[i]
    return out
  }
  const norm = 1 / (2 * r + 1)
  for (let y = 0; y < h; y++) {
    const row = y * w
    let acc = 0
    for (let k = -r; k <= r; k++) acc += src[row + Math.min(w - 1, Math.max(0, k))]
    for (let x = 0; x < w; x++) {
      tmp[row + x] = acc * norm
      acc += src[row + Math.min(w - 1, x + r + 1)] - src[row + Math.max(0, x - r)]
    }
  }
  for (let x = 0; x < w; x++) {
    let acc = 0
    for (let k = -r; k <= r; k++) acc += tmp[Math.min(h - 1, Math.max(0, k)) * w + x]
    for (let y = 0; y < h; y++) {
      out[y * w + x] = acc * norm
      acc += tmp[Math.min(h - 1, y + r + 1) * w + x] - tmp[Math.max(0, y - r) * w + x]
    }
  }
  return out
}

/** Rotates clockwise by 90/180/270 degrees. */
export function rotateImg(img: Img, deg: number): Img {
  const d = ((deg % 360) + 360) % 360
  if (d === 0) return img
  const { width: w, height: h, data } = img
  const out = d === 180 ? createImg(w, h) : createImg(h, w)
  const o = new Uint32Array(out.data.buffer)
  const s = new Uint32Array(data.buffer, data.byteOffset, w * h)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let t: number
      if (d === 90) t = x * h + (h - 1 - y)
      else if (d === 180) t = (h - 1 - y) * w + (w - 1 - x)
      else t = (w - 1 - x) * h + y
      o[t] = s[y * w + x]
    }
  }
  return out
}
