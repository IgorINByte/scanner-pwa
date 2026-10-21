import { useEffect, useState } from 'react'
import CornerEditor, { isConvex } from '../components/CornerEditor'
import { useDialogs } from '../components/dialogs'
import { ExpandIcon, ResetIcon, WandIcon } from '../components/Icons'
import { Segmented, SectionTitle, Spinner } from '../components/ui'
import { fullFrame } from '../lib/geometry'
import { detectCorners } from '../lib/imaging/detect'
import { repository } from '../lib/storage/repository'
import { PAPER_FORMATS, type Corners, type ScanPage } from '../types'
import { Notice, ToolLayout } from './ToolLayout'

interface Props {
  page: ScanPage
  top: React.ReactNode
  onChange: (patch: Partial<ScanPage>, merge?: string) => void
  onDone: () => void
}

export default function CropView({ page, top, onChange, onDone }: Props) {
  const dialogs = useDialogs()
  const [src, setSrc] = useState<string | null>(null)
  const [draft, setDraft] = useState<Corners | null>(page.corners)
  const [detecting, setDetecting] = useState(false)

  useEffect(() => {
    let url: string | null = null
    let cancelled = false
    repository.getBlob(page.sourceId).then((b) => {
      if (cancelled) return
      url = URL.createObjectURL(b)
      setSrc(url)
    })
    return () => {
      cancelled = true
      if (url) URL.revokeObjectURL(url)
    }
  }, [page.sourceId])

  // Follow external changes (auto-detection finishing, undo/redo).
  useEffect(() => setDraft(page.corners), [page.corners])

  const commit = (c: Corners) => {
    if (isConvex(c)) onChange({ corners: c })
  }

  const auto = async () => {
    setDetecting(true)
    try {
      const d = await detectCorners(await repository.getBlob(page.sourceId), page.width, page.height)
      onChange({ corners: d.corners, detection: d.detection })
      if (d.detection === 'none') dialogs.toast('No document outline found — adjust the corners manually.', 'info')
    } catch (e) {
      console.warn(e)
      dialogs.toast('Edge detection is unavailable right now. Adjust the corners manually.', 'error')
    } finally {
      setDetecting(false)
    }
  }

  const valid = draft ? isConvex(draft) : false

  return (
    <ToolLayout
      top={top}
      canvas={
        draft && src ? (
          <CornerEditor src={src} width={page.width} height={page.height} corners={draft} onChange={setDraft} onCommit={commit} />
        ) : (
          <div className="flex size-full flex-col items-center justify-center gap-3 text-sm text-slate-400">
            <Spinner className="size-8 text-cyan-400" />
            Detecting document edges…
          </div>
        )
      }
      panel={
        <div className="space-y-4">
          {!valid && draft ? (
            <Notice tone="warn">The corners must form a convex shape. Drag them to the edges of the page.</Notice>
          ) : page.detection === 'found' ? (
            <Notice tone="ok">Document edges detected. Drag any corner to fine-tune.</Notice>
          ) : page.detection === 'approx' ? (
            <Notice tone="warn">Edges were detected only approximately — check the corners.</Notice>
          ) : page.detection === 'none' ? (
            <Notice tone="warn">The document could not be detected reliably. Drag the four corners to the page edges, or keep the full image.</Notice>
          ) : null}

          <div className="grid grid-cols-2 gap-2">
            <button className="btn-secondary px-2 text-sm" onClick={() => void auto()} disabled={detecting}>
              {detecting ? <Spinner className="size-4" /> : <WandIcon width={18} />}
              Auto detect
            </button>
            <button className="btn-secondary px-2 text-sm" onClick={() => onChange({ corners: fullFrame(page.width, page.height) })}>
              <ExpandIcon width={18} />
              Full image
            </button>
          </div>

          <div>
            <SectionTitle>Page proportions</SectionTitle>
            <Segmented label="Page proportions" value={page.paper} options={PAPER_FORMATS} onChange={(paper) => onChange({ paper })} />
            <p className="mt-1.5 text-xs text-slate-500">
              Auto keeps the measured shape. A4/A5/Letter force that paper’s proportions after straightening.
            </p>
          </div>

          <div className="flex gap-2">
            {page.corners && draft !== page.corners && (
              <button className="btn-ghost text-sm" onClick={() => setDraft(page.corners)}>
                <ResetIcon width={18} />
              </button>
            )}
            <button className="btn-primary flex-1" onClick={onDone} disabled={!valid}>
              Straighten & continue
            </button>
          </div>
        </div>
      }
    />
  )
}
