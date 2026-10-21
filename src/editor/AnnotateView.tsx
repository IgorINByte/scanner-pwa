import { useEffect, useState } from 'react'
import { useDialogs } from '../components/dialogs'
import {
  CursorIcon,
  EraserIcon,
  HighlighterIcon,
  PenIcon,
  SignatureIcon,
  SquareIcon,
  StampIcon,
  TextIcon,
  TrashIcon,
  UnderlineIcon,
} from '../components/Icons'
import { Segmented, SectionTitle, Slider, Toggle } from '../components/ui'
import { uid } from '../lib/uid'
import type { Annotation, Page, Watermark } from '../types'
import AnnotationLayer, { type Tool } from './AnnotationLayer'
import { PagePreview, useFit } from './PagePreview'
import SignatureDialog from './SignatureDialog'
import { ToolLayout } from './ToolLayout'
import { usePreview } from './usePreview'

interface Props {
  page: Page
  top: React.ReactNode
  watermark: Watermark
  onAnnotations: (list: Annotation[], merge?: string) => void
  onWatermark: (wm: Watermark, merge?: string) => void
}

const TOOLS: { id: Tool; label: string; icon: typeof PenIcon }[] = [
  { id: 'select', label: 'Select', icon: CursorIcon },
  { id: 'highlight', label: 'Highlight', icon: HighlighterIcon },
  { id: 'underline', label: 'Underline', icon: UnderlineIcon },
  { id: 'rect', label: 'Box', icon: SquareIcon },
  { id: 'pen', label: 'Draw', icon: PenIcon },
  { id: 'text', label: 'Note', icon: TextIcon },
  { id: 'eraser', label: 'Erase', icon: EraserIcon },
]

const COLORS = ['#facc15', '#4ade80', '#38bdf8', '#f472b6', '#dc2626', '#1d4ed8', '#0f172a']

export default function AnnotateView({ page, top, watermark, onAnnotations, onWatermark }: Props) {
  const dialogs = useDialogs()
  const preview = usePreview(page)
  const fit = useFit(page)
  const [tool, setTool] = useState<Tool>('highlight')
  const [color, setColor] = useState('#facc15')
  const [stroke, setStroke] = useState(4) // per-mille of page width
  const [textSize, setTextSize] = useState(30)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [signing, setSigning] = useState(false)
  const [panel, setPanel] = useState<'annotate' | 'watermark'>('annotate')

  const selected = page.annotations.find((a) => a.id === selectedId) ?? null

  useEffect(() => setSelectedId(null), [page.id])

  // Delete key removes the selected annotation.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!selectedId || (e.key !== 'Delete' && e.key !== 'Backspace')) return
      if ((e.target as HTMLElement).closest('input,textarea')) return
      onAnnotations(page.annotations.filter((a) => a.id !== selectedId))
      setSelectedId(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [selectedId, page.annotations, onAnnotations])

  const pickTool = (t: Tool) => {
    setTool(t)
    if (t !== 'select') setSelectedId(null)
    if (t === 'highlight' && !['#facc15', '#4ade80', '#38bdf8', '#f472b6'].includes(color)) setColor('#facc15')
    if ((t === 'pen' || t === 'underline' || t === 'rect' || t === 'text') && color === '#facc15') setColor('#dc2626')
  }

  const applyColor = (c: string) => {
    setColor(c)
    if (selected && 'color' in selected) onAnnotations(page.annotations.map((a) => (a.id === selected.id ? ({ ...a, color: c } as Annotation) : a)))
  }

  const applySize = (v: number) => {
    if (selected?.type === 'text') {
      setTextSize(v)
      onAnnotations(page.annotations.map((a) => (a.id === selected.id ? { ...a, size: v / 1000 } : a)), `size:${selected.id}`)
    } else {
      setStroke(v)
      if (selected && 'size' in selected) onAnnotations(page.annotations.map((a) => (a.id === selected.id ? ({ ...a, size: v / 1000 } as Annotation) : a)), `size:${selected.id}`)
    }
  }

  const addText = async (x: number, y: number) => {
    const text = await dialogs.prompt({ title: 'Add note', label: 'Text', multiline: true, confirmLabel: 'Add' })
    if (!text?.trim()) return
    const a: Annotation = { id: uid(), type: 'text', x, y, text: text.trim(), color, size: textSize / 1000 }
    onAnnotations([...page.annotations, a])
    setTool('select')
    setSelectedId(a.id)
  }

  const editText = async () => {
    if (selected?.type !== 'text') return
    const text = await dialogs.prompt({ title: 'Edit note', initial: selected.text, multiline: true, confirmLabel: 'Save' })
    if (text === null) return
    onAnnotations(
      text.trim() ? page.annotations.map((a) => (a.id === selected.id ? { ...a, text: text.trim() } : a)) : page.annotations.filter((a) => a.id !== selected.id),
    )
  }

  const placeSignature = (src: string, iw: number, ih: number) => {
    setSigning(false)
    const w = 0.32
    const h = (w * ih) / iw / fit.aspect
    const a: Annotation = { id: uid(), type: 'image', x: 0.6 - w / 2, y: 0.82 - h / 2, w, h, src }
    onAnnotations([...page.annotations, a])
    setTool('select')
    setSelectedId(a.id)
    dialogs.toast('Drag the signature into place; use the corner handle to resize.', 'info')
  }

  const showSize = selected ? selected.type !== 'highlight' && selected.type !== 'image' : tool !== 'highlight' && tool !== 'select' && tool !== 'eraser'
  const sizeIsText = selected ? selected.type === 'text' : tool === 'text'

  return (
    <ToolLayout
      top={top}
      canvas={
        <PagePreview page={page} preview={preview}>
          <AnnotationLayer
            aspect={fit.aspect}
            annotations={page.annotations}
            watermark={watermark}
            tool={tool}
            color={color}
            size={stroke / 1000}
            selectedId={selectedId}
            onSelect={setSelectedId}
            onChange={onAnnotations}
            onTextAt={(x, y) => void addText(x, y)}
          />
        </PagePreview>
      }
      panel={
        <div className="space-y-4">
          {signing && <SignatureDialog onClose={() => setSigning(false)} onPick={placeSignature} />}
          <Segmented
            label="Annotation panel"
            value={panel}
            onChange={setPanel}
            options={[
              { id: 'annotate', label: 'Markup' },
              { id: 'watermark', label: 'Watermark' },
            ]}
          />

          {panel === 'annotate' ? (
            <>
              <div className="-mx-1 flex flex-wrap gap-1" role="toolbar" aria-label="Annotation tools">
                {TOOLS.map((t) => (
                  <button key={t.id} className="tool-btn" aria-pressed={tool === t.id} onClick={() => pickTool(t.id)}>
                    <t.icon width={20} />
                    {t.label}
                  </button>
                ))}
                <button className="tool-btn" onClick={() => setSigning(true)}>
                  <SignatureIcon width={20} />
                  Sign
                </button>
              </div>

              {(selected ? 'color' in selected : tool !== 'select' && tool !== 'eraser') && (
                <div>
                  <SectionTitle>Color</SectionTitle>
                  <div className="flex flex-wrap gap-2">
                    {COLORS.map((c) => (
                      <button
                        key={c}
                        className={`size-8 rounded-full ring-2 ring-offset-2 ring-offset-slate-900 ${color === c ? 'ring-cyan-400' : 'ring-transparent'}`}
                        style={{ background: c }}
                        onClick={() => applyColor(c)}
                        aria-label={`Color ${c}`}
                        aria-pressed={color === c}
                      />
                    ))}
                  </div>
                </div>
              )}

              {showSize && (
                <Slider
                  label={sizeIsText ? 'Text size' : 'Line width'}
                  min={sizeIsText ? 12 : 1}
                  max={sizeIsText ? 90 : 20}
                  value={sizeIsText ? (selected?.type === 'text' ? Math.round(selected.size * 1000) : textSize) : selected && 'size' in selected ? Math.round(selected.size * 1000) : stroke}
                  onChange={applySize}
                />
              )}

              {selected ? (
                <div className="flex gap-2">
                  {selected.type === 'text' && (
                    <button className="btn-secondary flex-1 text-sm" onClick={() => void editText()}>
                      Edit text
                    </button>
                  )}
                  <button
                    className="btn-secondary flex-1 text-sm text-red-300"
                    onClick={() => {
                      onAnnotations(page.annotations.filter((a) => a.id !== selected.id))
                      setSelectedId(null)
                    }}
                  >
                    <TrashIcon width={18} />
                    Delete
                  </button>
                </div>
              ) : (
                <p className="text-xs text-slate-500">
                  {tool === 'select'
                    ? 'Tap a mark to select it, then drag to move it.'
                    : tool === 'text'
                      ? 'Tap the page where the note should go.'
                      : tool === 'eraser'
                        ? 'Tap a mark to remove it.'
                        : 'Drag on the page to draw.'}
                </p>
              )}

              {page.annotations.length > 0 && (
                <button
                  className="btn-ghost w-full text-sm text-slate-400"
                  onClick={async () => {
                    if (await dialogs.confirm({ title: 'Remove all marks on this page?', confirmLabel: 'Remove all', danger: true })) {
                      onAnnotations([])
                      setSelectedId(null)
                    }
                  }}
                >
                  Remove all marks on this page ({page.annotations.length})
                </button>
              )}
            </>
          ) : (
            <WatermarkPanel wm={watermark} onChange={onWatermark} />
          )}
        </div>
      }
    />
  )
}

function WatermarkPanel({ wm, onChange }: { wm: Watermark; onChange: (w: Watermark, merge?: string) => void }) {
  return (
    <div className="space-y-3">
      <Toggle checked={wm.enabled} onChange={(enabled) => onChange({ ...wm, enabled })} label="Watermark on every page" hint="Shown in the preview and added on export" />
      <label className="block">
        <span className="mb-1 block text-sm text-slate-300">Text</span>
        <input className="field" value={wm.text} maxLength={60} onChange={(e) => onChange({ ...wm, text: e.target.value }, 'wm:text')} />
      </label>
      <div>
        <SectionTitle>Position</SectionTitle>
        <Segmented
          label="Watermark position"
          value={wm.position}
          onChange={(position) => onChange({ ...wm, position })}
          options={[
            { id: 'diagonal', label: 'Diagonal' },
            { id: 'center', label: 'Center' },
            { id: 'top', label: 'Top' },
            { id: 'bottom', label: 'Bottom' },
          ]}
        />
      </div>
      <Slider label="Size" min={3} max={20} value={Math.round(wm.size * 100)} onChange={(v) => onChange({ ...wm, size: v / 100 }, 'wm:size')} />
      <Slider label="Opacity" min={5} max={100} value={Math.round(wm.opacity * 100)} format={(v) => `${v}%`} onChange={(v) => onChange({ ...wm, opacity: v / 100 }, 'wm:opacity')} />
      <div className="flex flex-wrap gap-2">
        {['#dc2626', '#0f172a', '#64748b', '#1d4ed8', '#16a34a'].map((c) => (
          <button
            key={c}
            className={`size-8 rounded-full ring-2 ring-offset-2 ring-offset-slate-900 ${wm.color === c ? 'ring-cyan-400' : 'ring-transparent'}`}
            style={{ background: c }}
            onClick={() => onChange({ ...wm, color: c })}
            aria-label={`Watermark color ${c}`}
          />
        ))}
      </div>
      <p className="flex items-center gap-2 text-xs text-slate-500">
        <StampIcon width={16} />
        The watermark applies to the whole document.
      </p>
    </div>
  )
}
