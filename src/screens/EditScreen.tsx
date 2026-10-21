import { useEffect, useState } from 'react'
import CornerEditor, { isConvex } from '../components/CornerEditor'
import { CheckIcon, CropIcon, ExpandIcon, RotateIcon, RotateLeftIcon, TrashIcon, WandIcon } from '../components/Icons'
import { Header, Spinner } from '../components/ui'
import { fullFrame } from '../lib/geometry'
import { canvasToBlob, releaseCanvas } from '../lib/image'
import { renderPage } from '../lib/render'
import { detectCorners } from '../lib/scan'
import { rememberFilter, type PagesApi } from '../lib/usePages'
import { FILTERS, type Corners, type Page, type Rotation } from '../types'

const PREVIEW_SIDE = 1600

interface Props {
  page: Page
  index: number
  total: number
  api: PagesApi
  onDone: () => void
  onDeleted: () => void
}

export default function EditScreen({ page, index, total, api, onDone, onDeleted }: Props) {
  const [tab, setTab] = useState<'crop' | 'adjust'>('crop')
  const [draft, setDraft] = useState<Corners | null>(page.corners)
  const [detecting, setDetecting] = useState(false)
  const [sourceUrl, setSourceUrl] = useState('')
  const [preview, setPreview] = useState<string | null>(null)
  const [rendering, setRendering] = useState(false)

  useEffect(() => {
    const url = URL.createObjectURL(page.source)
    setSourceUrl(url)
    return () => URL.revokeObjectURL(url)
  }, [page.source])

  // Auto-detection for this page may still be running in the background queue.
  useEffect(() => {
    if (!draft && page.corners) setDraft(page.corners)
  }, [draft, page.corners])

  // Render the processed preview for the adjust tab.
  useEffect(() => {
    if (tab !== 'adjust' || !page.corners) return
    let cancelled = false
    let url: string | null = null
    setRendering(true)
    renderPage(page, PREVIEW_SIDE)
      .then(async (canvas) => {
        const blob = await canvasToBlob(canvas, 'image/jpeg', 0.85)
        releaseCanvas(canvas)
        if (cancelled) return
        url = URL.createObjectURL(blob)
        setPreview(url)
      })
      .catch((e) => console.warn('Preview failed', e))
      .finally(() => !cancelled && setRendering(false))
    return () => {
      cancelled = true
      if (url) setTimeout(() => URL.revokeObjectURL(url!), 1000)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, page.corners, page.filter, page.rotation, page.source])

  const autoDetect = async () => {
    setDetecting(true)
    try {
      setDraft(await detectCorners(page.source, page.width, page.height))
    } catch (e) {
      console.warn(e)
      alert('Edge detection is unavailable right now.')
    } finally {
      setDetecting(false)
    }
  }

  const applyCrop = () => {
    if (draft) api.patch(page.id, { corners: draft })
    setTab('adjust')
  }

  const rotate = (delta: 90 | -90) =>
    api.patch(page.id, { rotation: (((page.rotation + delta) % 360) + 360) % 360 as Rotation })

  const del = () => {
    if (!confirm('Delete this page?')) return
    api.remove(page.id)
    onDeleted()
  }

  const valid = draft ? isConvex(draft) : false

  return (
    <div className="fixed inset-0 z-30 flex flex-col bg-slate-950">
      <Header
        title={`Page ${index + 1} of ${total}`}
        onBack={tab === 'adjust' ? () => setTab('crop') : onDone}
        right={
          <button className="icon-btn text-slate-300" onClick={del} aria-label="Delete page">
            <TrashIcon />
          </button>
        }
      />

      <div className="relative min-h-0 flex-1">
        {tab === 'crop' ? (
          draft && sourceUrl ? (
            <CornerEditor src={sourceUrl} width={page.width} height={page.height} corners={draft} onChange={setDraft} />
          ) : (
            <div className="flex size-full flex-col items-center justify-center gap-3 text-slate-400">
              <Spinner className="size-8 text-cyan-400" />
              Detecting document edges…
            </div>
          )
        ) : (
          <div className="flex size-full items-center justify-center p-4">
            {preview && (
              <img src={preview} alt="Processed page" className="max-h-full max-w-full rounded shadow-2xl ring-1 ring-white/10" />
            )}
            {rendering && (
              <div className="absolute inset-0 flex items-center justify-center">
                <span className="rounded-full bg-slate-900/80 p-3">
                  <Spinner className="size-7 text-cyan-400" />
                </span>
              </div>
            )}
          </div>
        )}
      </div>

      <div className="border-t border-white/5 bg-slate-900 px-4 pt-3 pb-[calc(env(safe-area-inset-bottom)+0.75rem)]">
        {tab === 'crop' ? (
          <>
            <p className="mb-3 text-center text-xs text-slate-400">
              {valid ? 'Drag the corners to fit the document' : 'Corners must form a convex shape'}
            </p>
            <div className="flex items-center gap-2">
              <button className="btn-secondary flex-1 px-2 text-sm" onClick={() => void autoDetect()} disabled={detecting}>
                {detecting ? <Spinner className="size-4" /> : <WandIcon width={18} height={18} />}
                Auto
              </button>
              <button
                className="btn-secondary flex-1 px-2 text-sm"
                onClick={() => setDraft(fullFrame(page.width, page.height))}
              >
                <ExpandIcon width={18} height={18} />
                Full image
              </button>
              <button className="btn-primary flex-[1.3] px-2" onClick={applyCrop} disabled={!draft || !valid}>
                <CropIcon width={18} height={18} />
                Crop
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="-mx-4 mb-3 flex gap-2 overflow-x-auto px-4 pb-1">
              {FILTERS.map((f) => (
                <button
                  key={f.id}
                  onClick={() => {
                    api.patch(page.id, { filter: f.id })
                    rememberFilter(f.id)
                  }}
                  className={`shrink-0 rounded-full px-4 py-2 text-sm font-medium ring-1 transition ${
                    page.filter === f.id
                      ? 'bg-cyan-400 text-slate-950 ring-cyan-400'
                      : 'bg-slate-800 text-slate-200 ring-white/10 active:bg-slate-700'
                  }`}
                >
                  {f.label}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-2">
              <button className="icon-btn bg-slate-800" onClick={() => rotate(-90)} aria-label="Rotate left">
                <RotateLeftIcon />
              </button>
              <button className="icon-btn bg-slate-800" onClick={() => rotate(90)} aria-label="Rotate right">
                <RotateIcon />
              </button>
              <button className="btn-secondary px-3 text-sm" onClick={() => setTab('crop')}>
                <CropIcon width={18} height={18} />
                Crop
              </button>
              <button className="btn-primary flex-1" onClick={onDone}>
                <CheckIcon />
                Done
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
