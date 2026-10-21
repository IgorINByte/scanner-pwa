// Burns annotations / watermark into a raster image (JPEG/PNG export).
import type { Annotation, Watermark } from '../../types'

export const HIGHLIGHT_OPACITY = 0.38

const imageCache = new Map<string, Promise<ImageBitmap>>()

function loadImage(src: string) {
  let p = imageCache.get(src)
  if (!p) {
    p = fetch(src)
      .then((r) => r.blob())
      .then((b) => createImageBitmap(b))
    imageCache.set(src, p)
  }
  return p
}

export const FONT_STACK = '"DejaVu Sans", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif'

export async function drawAnnotationsOnCanvas(
  ctx: CanvasRenderingContext2D,
  annotations: Annotation[],
  W: number,
  H: number,
) {
  for (const a of annotations) {
    ctx.save()
    switch (a.type) {
      case 'highlight':
        ctx.globalAlpha = HIGHLIGHT_OPACITY
        ctx.globalCompositeOperation = 'multiply'
        ctx.fillStyle = a.color
        ctx.fillRect(a.x * W, a.y * H, a.w * W, a.h * H)
        break
      case 'rect':
        ctx.strokeStyle = a.color
        ctx.lineWidth = a.size * W
        ctx.strokeRect(a.x * W, a.y * H, a.w * W, a.h * H)
        break
      case 'underline':
        ctx.strokeStyle = a.color
        ctx.lineWidth = a.size * W
        ctx.lineCap = 'round'
        ctx.beginPath()
        ctx.moveTo(a.x1 * W, a.y1 * H)
        ctx.lineTo(a.x2 * W, a.y2 * H)
        ctx.stroke()
        break
      case 'ink':
        ctx.strokeStyle = a.color
        ctx.lineWidth = a.size * W
        ctx.lineCap = 'round'
        ctx.lineJoin = 'round'
        ctx.beginPath()
        for (let i = 0; i < a.points.length; i += 2) {
          const x = a.points[i] * W
          const y = a.points[i + 1] * H
          if (i === 0) ctx.moveTo(x, y)
          else ctx.lineTo(x, y)
        }
        ctx.stroke()
        break
      case 'text': {
        const px = a.size * W
        ctx.fillStyle = a.color
        ctx.font = `${px}px ${FONT_STACK}`
        ctx.textBaseline = 'top'
        a.text.split('\n').forEach((line, i) => ctx.fillText(line, a.x * W, a.y * H + i * px * 1.2))
        break
      }
      case 'image': {
        const img = await loadImage(a.src)
        ctx.drawImage(img, a.x * W, a.y * H, a.w * W, a.h * H)
        break
      }
    }
    ctx.restore()
  }
}

/** Watermark placement in display space, shared by canvas preview and PDF output. */
export function watermarkPlacement(wm: Watermark, W: number, H: number) {
  const fontSize = wm.size * W
  switch (wm.position) {
    case 'top':
      return { cx: W / 2, cy: fontSize * 1.2, angle: 0, fontSize }
    case 'bottom':
      return { cx: W / 2, cy: H - fontSize * 1.2, angle: 0, fontSize }
    case 'center':
      return { cx: W / 2, cy: H / 2, angle: 0, fontSize }
    default:
      // diagonal from bottom-left to top-right
      return { cx: W / 2, cy: H / 2, angle: (Math.atan2(H, W) * 180) / Math.PI, fontSize }
  }
}

export function drawWatermarkOnCanvas(ctx: CanvasRenderingContext2D, wm: Watermark, W: number, H: number) {
  if (!wm.text.trim()) return
  const { cx, cy, angle, fontSize } = watermarkPlacement(wm, W, H)
  ctx.save()
  ctx.globalAlpha = wm.opacity
  ctx.fillStyle = wm.color
  ctx.font = `bold ${fontSize}px ${FONT_STACK}`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.translate(cx, cy)
  ctx.rotate((-angle * Math.PI) / 180)
  ctx.fillText(wm.text, 0, 0)
  ctx.restore()
}
