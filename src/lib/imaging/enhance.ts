// Image enhancement operations. All functions modify the image in place.
import { applyLut, boxBlur, buildLut, luminance, writeGray, type Img } from './buffer'

const clamp = (v: number, lo = 0, hi = 255) => (v < lo ? lo : v > hi ? hi : v)

export function grayscale(img: Img) {
  writeGray(img, luminance(img))
}

/**
 * Estimates the paper background (illumination) of the image: text and lines are
 * removed with a max filter on a downscaled luminance map, which is then smoothed
 * and upsampled. Dividing by it flattens shadows and uneven lighting.
 */
export function estimateBackground(lum: Float32Array, w: number, h: number): Float32Array {
  const f = Math.max(1, Math.round(Math.max(w, h) / 200))
  const sw = Math.ceil(w / f)
  const sh = Math.ceil(h / f)
  let small: Float32Array = new Float32Array(sw * sh)
  for (let y = 0; y < sh; y++) {
    for (let x = 0; x < sw; x++) {
      let acc = 0
      let n = 0
      for (let yy = y * f; yy < Math.min(h, (y + 1) * f); yy++) {
        for (let xx = x * f; xx < Math.min(w, (x + 1) * f); xx++) {
          acc += lum[yy * w + xx]
          n++
        }
      }
      small[y * sw + x] = acc / n
    }
  }
  // Dilation (max filter) wipes out dark strokes that are thinner than the window.
  const r = 3
  for (let pass = 0; pass < 2; pass++) {
    const next = new Float32Array(sw * sh)
    for (let y = 0; y < sh; y++) {
      for (let x = 0; x < sw; x++) {
        let m = 0
        for (let dy = -r; dy <= r; dy++) {
          const yy = Math.min(sh - 1, Math.max(0, y + dy))
          for (let dx = -r; dx <= r; dx++) {
            const v = small[yy * sw + Math.min(sw - 1, Math.max(0, x + dx))]
            if (v > m) m = v
          }
        }
        next[y * sw + x] = m
      }
    }
    small = next
  }
  small = boxBlur(boxBlur(small, sw, sh, 3), sw, sh, 3)

  // Bilinear upsample back to full resolution.
  const bg = new Float32Array(w * h)
  for (let y = 0; y < h; y++) {
    const fy = Math.min(sh - 1, Math.max(0, (y + 0.5) / f - 0.5))
    const y0 = fy | 0
    const y1 = Math.min(sh - 1, y0 + 1)
    const ay = fy - y0
    for (let x = 0; x < w; x++) {
      const fx = Math.min(sw - 1, Math.max(0, (x + 0.5) / f - 0.5))
      const x0 = fx | 0
      const x1 = Math.min(sw - 1, x0 + 1)
      const ax = fx - x0
      const top = small[y0 * sw + x0] + (small[y0 * sw + x1] - small[y0 * sw + x0]) * ax
      const bot = small[y1 * sw + x0] + (small[y1 * sw + x1] - small[y1 * sw + x0]) * ax
      bg[y * w + x] = top + (bot - top) * ay
    }
  }
  return bg
}

/** Flattens shadows / uneven lighting. strength 0..1. */
export function removeShadows(img: Img, strength: number) {
  if (strength <= 0) return
  const { width: w, height: h, data } = img
  const bg = estimateBackground(luminance(img), w, h)
  for (let i = 0, p = 0; p < bg.length; i += 4, p++) {
    const gain = 1 + (Math.min(4, 245 / Math.max(bg[p], 16)) - 1) * strength
    data[i] = clamp(data[i] * gain)
    data[i + 1] = clamp(data[i + 1] * gain)
    data[i + 2] = clamp(data[i + 2] * gain)
  }
}

/** Auto-levels (1%/99% luminance stretch) plus saturation boost. */
export function autoColor(img: Img, saturation = 1.25) {
  const { data } = img
  const hist = new Uint32Array(256)
  for (let i = 0; i < data.length; i += 4) hist[(0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]) | 0]++
  const total = data.length / 4
  let lo = 0
  let hi = 255
  for (let acc = 0; lo < 255 && (acc += hist[lo]) < total * 0.01; lo++);
  for (let acc = 0; hi > 0 && (acc += hist[hi]) < total * 0.01; hi--);
  if (hi - lo < 32) {
    lo = 0
    hi = 255
  }
  const lut = buildLut((v) => ((v - lo) * 255) / (hi - lo))
  for (let i = 0; i < data.length; i += 4) {
    const r = lut[data[i]]
    const g = lut[data[i + 1]]
    const b = lut[data[i + 2]]
    const y = 0.299 * r + 0.587 * g + 0.114 * b
    data[i] = clamp(y + (r - y) * saturation)
    data[i + 1] = clamp(y + (g - y) * saturation)
    data[i + 2] = clamp(y + (b - y) * saturation)
  }
}

/**
 * Black & white document: local adaptive threshold (Bradley, integral image) with a
 * global darkness rule so large solid dark areas stay filled instead of hollow.
 */
export function blackAndWhite(img: Img) {
  const { width: w, height: h } = img
  const lum = luminance(img)
  const integral = new Float64Array((w + 1) * (h + 1))
  for (let y = 0; y < h; y++) {
    let rowSum = 0
    for (let x = 0; x < w; x++) {
      rowSum += lum[y * w + x]
      integral[(y + 1) * (w + 1) + x + 1] = integral[y * (w + 1) + x + 1] + rowSum
    }
  }
  const r = Math.max(7, Math.round(Math.max(w, h) / 48))
  const t = 0.13
  const out = new Uint8ClampedArray(w * h)
  for (let y = 0; y < h; y++) {
    const y0 = Math.max(0, y - r)
    const y1 = Math.min(h, y + r + 1)
    for (let x = 0; x < w; x++) {
      const x0 = Math.max(0, x - r)
      const x1 = Math.min(w, x + r + 1)
      const sum =
        integral[y1 * (w + 1) + x1] - integral[y0 * (w + 1) + x1] - integral[y1 * (w + 1) + x0] + integral[y0 * (w + 1) + x0]
      const mean = sum / ((x1 - x0) * (y1 - y0))
      const v = lum[y * w + x]
      out[y * w + x] = v < mean * (1 - t) || v < 90 ? 0 : 255
    }
  }
  writeGray(img, out)
}

/** Grayscale with darkened, crisper strokes on a clean white background. */
export function emphasizeText(img: Img) {
  grayscale(img)
  applyLut(
    img,
    buildLut((v) => {
      const n = Math.min(1, v / 235) // white point
      return 255 * Math.pow(n, 2.2)
    }),
  )
}

/** Pushes light paper tones to pure white. amount 0..100. */
export function whiten(img: Img, amount: number) {
  if (amount <= 0) return
  const wp = 255 - amount * 0.9
  applyLut(
    img,
    buildLut((v) => (v * 255) / wp),
  )
}

/** brightness, contrast: -100..100 */
export function brightnessContrast(img: Img, brightness: number, contrast: number) {
  if (!brightness && !contrast) return
  const c = contrast * 2.55
  const f = (259 * (c + 255)) / (255 * (259 - c))
  const b = brightness * 1.28
  applyLut(
    img,
    buildLut((v) => f * (v + b - 128) + 128),
  )
}

function channelPlanes(img: Img) {
  const n = img.width * img.height
  const planes = [new Float32Array(n), new Float32Array(n), new Float32Array(n)]
  for (let i = 0, p = 0; p < n; i += 4, p++) {
    planes[0][p] = img.data[i]
    planes[1][p] = img.data[i + 1]
    planes[2][p] = img.data[i + 2]
  }
  return planes
}

/** Edge-preserving noise reduction. amount 0..100. */
export function denoise(img: Img, amount: number) {
  if (amount <= 0) return
  const { width: w, height: h, data } = img
  const strength = amount / 100
  const radius = amount > 60 ? 2 : 1
  const k = 12 + amount * 0.3 // differences above ~k are treated as edges and kept
  channelPlanes(img).forEach((plane, ch) => {
    const blur = boxBlur(plane, w, h, radius)
    for (let p = 0, i = ch; p < plane.length; p++, i += 4) {
      const d = Math.abs(plane[p] - blur[p])
      const wgt = strength * Math.exp(-d / k)
      data[i] = plane[p] + (blur[p] - plane[p]) * wgt
    }
  })
}

/** Unsharp mask. amount 0..100. */
export function sharpen(img: Img, amount: number) {
  if (amount <= 0) return
  const { width: w, height: h, data } = img
  const a = (amount / 100) * 1.6
  channelPlanes(img).forEach((plane, ch) => {
    const blur = boxBlur(plane, w, h, 1)
    for (let p = 0, i = ch; p < plane.length; p++, i += 4) data[i] = clamp(plane[p] + (plane[p] - blur[p]) * a)
  })
}
