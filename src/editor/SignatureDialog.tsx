import { useEffect, useRef, useState } from 'react'
import { Modal, useDialogs } from '../components/dialogs'
import { TrashIcon } from '../components/Icons'
import { Segmented, Toggle, useFilePicker } from '../components/ui'
import { IMAGE_ACCEPT, validateFile } from '../lib/files'
import { decodeImage } from '../lib/image'
import { deleteSignature, listSignatures, saveSignature, type SignatureRecord } from '../lib/storage/repository'

/** Crops to the non-transparent area and returns a PNG data URL (max 900 px wide). */
function trimToDataUrl(src: HTMLCanvasElement): string | null {
  const ctx = src.getContext('2d', { willReadFrequently: true })!
  const { width: w, height: h } = src
  const d = ctx.getImageData(0, 0, w, h).data
  let x0 = w
  let y0 = h
  let x1 = -1
  let y1 = -1
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++)
      if (d[(y * w + x) * 4 + 3] > 8) {
        if (x < x0) x0 = x
        if (x > x1) x1 = x
        if (y < y0) y0 = y
        if (y > y1) y1 = y
      }
  if (x1 < 0) return null
  const pad = 6
  x0 = Math.max(0, x0 - pad)
  y0 = Math.max(0, y0 - pad)
  x1 = Math.min(w - 1, x1 + pad)
  y1 = Math.min(h - 1, y1 + pad)
  const s = Math.min(1, 900 / (x1 - x0 + 1))
  const out = document.createElement('canvas')
  out.width = Math.round((x1 - x0 + 1) * s)
  out.height = Math.round((y1 - y0 + 1) * s)
  out.getContext('2d')!.drawImage(src, x0, y0, x1 - x0 + 1, y1 - y0 + 1, 0, 0, out.width, out.height)
  return out.toDataURL('image/png')
}

export default function SignatureDialog({ onClose, onPick }: { onClose: () => void; onPick: (src: string, w: number, h: number) => void }) {
  const dialogs = useDialogs()
  const [tab, setTab] = useState<'draw' | 'upload' | 'saved'>('draw')
  const [saved, setSaved] = useState<SignatureRecord[]>([])
  const [keep, setKeep] = useState(true)
  const [ink, setInk] = useState('#0f172a')
  const [removeBg, setRemoveBg] = useState(true)
  const [uploaded, setUploaded] = useState<HTMLCanvasElement | null>(null)
  const canvas = useRef<HTMLCanvasElement>(null)
  const drawing = useRef(false)
  const [hasInk, setHasInk] = useState(false)

  useEffect(() => {
    void listSignatures().then((s) => {
      setSaved(s)
      if (s.length) setTab('saved')
    })
  }, [])

  useEffect(() => {
    if (tab !== 'draw') return
    const c = canvas.current!
    const r = c.getBoundingClientRect()
    c.width = r.width * 2
    c.height = r.height * 2
    setHasInk(false)
  }, [tab])

  const pos = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const r = e.currentTarget.getBoundingClientRect()
    return [((e.clientX - r.left) / r.width) * e.currentTarget.width, ((e.clientY - r.top) / r.height) * e.currentTarget.height]
  }

  const upload = useFilePicker(
    async ([file]) => {
      try {
        await validateFile(file, 'image')
        const img = await decodeImage(file)
        const iw = 'naturalWidth' in img ? img.naturalWidth : img.width
        const ih = 'naturalHeight' in img ? img.naturalHeight : img.height
        const s = Math.min(1, 1200 / Math.max(iw, ih))
        const c = document.createElement('canvas')
        c.width = Math.round(iw * s)
        c.height = Math.round(ih * s)
        c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height)
        setUploaded(c)
      } catch (e) {
        dialogs.toast(e instanceof Error ? e.message : 'Could not read the image', 'error')
      }
    },
    { accept: IMAGE_ACCEPT },
  )

  const finish = async (src: string | null) => {
    if (!src) return dialogs.toast('Draw or choose a signature first.', 'error')
    const img = new Image()
    img.src = src
    await img.decode()
    if (keep && tab !== 'saved') await saveSignature(src)
    onPick(src, img.naturalWidth, img.naturalHeight)
  }

  const fromUpload = () => {
    if (!uploaded) return null
    const c = document.createElement('canvas')
    c.width = uploaded.width
    c.height = uploaded.height
    const ctx = c.getContext('2d', { willReadFrequently: true })!
    ctx.drawImage(uploaded, 0, 0)
    if (removeBg) {
      // Paper background -> transparent, so the signature sits naturally on the page.
      const id = ctx.getImageData(0, 0, c.width, c.height)
      const d = id.data
      for (let i = 0; i < d.length; i += 4) {
        const l = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]
        d[i + 3] = l > 200 ? 0 : l > 150 ? Math.round(((200 - l) / 50) * 255) : 255
      }
      ctx.putImageData(id, 0, 0)
    }
    return trimToDataUrl(c)
  }

  return (
    <Modal title="Signature" onClose={onClose}>
      {upload.input}
      <div className="space-y-4">
        <Segmented
          label="Signature source"
          value={tab}
          onChange={setTab}
          options={[
            { id: 'draw', label: 'Draw' },
            { id: 'upload', label: 'Image' },
            { id: 'saved', label: `Saved (${saved.length})`, disabled: !saved.length },
          ]}
        />

        {tab === 'draw' && (
          <div>
            <canvas
              ref={canvas}
              className="h-44 w-full touch-none rounded-xl bg-white"
              aria-label="Signature pad: draw your signature"
              onPointerDown={(e) => {
                e.currentTarget.setPointerCapture(e.pointerId)
                drawing.current = true
                const ctx = e.currentTarget.getContext('2d')!
                const [x, y] = pos(e)
                ctx.strokeStyle = ink
                ctx.lineWidth = 5
                ctx.lineCap = 'round'
                ctx.lineJoin = 'round'
                ctx.beginPath()
                ctx.moveTo(x, y)
                ctx.lineTo(x + 0.1, y)
                ctx.stroke()
                setHasInk(true)
              }}
              onPointerMove={(e) => {
                if (!drawing.current) return
                const ctx = e.currentTarget.getContext('2d')!
                const [x, y] = pos(e)
                ctx.lineTo(x, y)
                ctx.stroke()
              }}
              onPointerUp={() => (drawing.current = false)}
            />
            <div className="mt-2 flex items-center gap-2">
              {['#0f172a', '#1d4ed8'].map((c) => (
                <button key={c} className={`size-8 rounded-full ring-2 ${ink === c ? 'ring-cyan-400' : 'ring-white/20'}`} style={{ background: c }} onClick={() => setInk(c)} aria-label={c === '#0f172a' ? 'Black ink' : 'Blue ink'} />
              ))}
              <button
                className="btn-ghost ml-auto text-sm"
                onClick={() => {
                  const c = canvas.current!
                  c.getContext('2d')!.clearRect(0, 0, c.width, c.height)
                  setHasInk(false)
                }}
              >
                Clear
              </button>
            </div>
          </div>
        )}

        {tab === 'upload' && (
          <div className="space-y-2">
            <button className="btn-secondary w-full" onClick={upload.open}>
              Choose image of signature
            </button>
            {uploaded && (
              <>
                <img src={uploaded.toDataURL()} alt="Uploaded signature" className="max-h-40 w-full rounded-xl bg-white object-contain" />
                <Toggle checked={removeBg} onChange={setRemoveBg} label="Make white background transparent" />
              </>
            )}
          </div>
        )}

        {tab === 'saved' && (
          <ul className="grid grid-cols-2 gap-2">
            {saved.map((s) => (
              <li key={s.id} className="relative">
                <button className="flex h-24 w-full items-center justify-center rounded-xl bg-white p-2 ring-2 ring-transparent hover:ring-cyan-400" onClick={() => void finish(s.src)}>
                  <img src={s.src} alt="Saved signature" className="max-h-full max-w-full" />
                </button>
                <button
                  className="absolute top-1 right-1 rounded-full bg-slate-900/80 p-1"
                  aria-label="Delete saved signature"
                  onClick={async () => {
                    await deleteSignature(s.id)
                    setSaved((l) => l.filter((x) => x.id !== s.id))
                  }}
                >
                  <TrashIcon width={14} />
                </button>
              </li>
            ))}
          </ul>
        )}

        {tab !== 'saved' && <Toggle checked={keep} onChange={setKeep} label="Save signature on this device for reuse" />}

        <p className="rounded-xl bg-slate-800 p-3 text-xs leading-relaxed text-slate-400">
          This inserts a <b>visual image</b> of your signature. It is not a qualified electronic signature (eIDAS / QES),
          does not cryptographically protect the document and does not by itself guarantee legal validity.
        </p>

        {tab !== 'saved' && (
          <div className="flex justify-end gap-2">
            <button className="btn-secondary" onClick={onClose}>
              Cancel
            </button>
            <button
              className="btn-primary"
              disabled={tab === 'draw' ? !hasInk : !uploaded}
              onClick={() => void finish(tab === 'draw' ? trimToDataUrl(canvas.current!) : fromUpload())}
            >
              Place on page
            </button>
          </div>
        )}
      </div>
    </Modal>
  )
}
