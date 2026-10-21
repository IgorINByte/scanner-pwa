import { useState } from 'react'
import { CompareIcon, ResetIcon, RotateIcon, RotateLeftIcon, WandIcon } from '../components/Icons'
import { Segmented, SectionTitle, Slider } from '../components/ui'
import { rememberSetting } from '../lib/document/import'
import { FILTERS, NO_ADJUSTMENTS, type Adjustments, type Page, type Rotation, type ScanPage } from '../types'
import { PagePreview } from './PagePreview'
import { Notice, ToolLayout } from './ToolLayout'
import { usePreview } from './usePreview'

interface Props {
  page: Page
  top: React.ReactNode
  onChange: (patch: Partial<ScanPage>, merge?: string) => void
  onRotate: (delta: 90 | -90) => void
  onApplyToAll: () => void
  scanCount: number
}

const SLIDERS: { key: keyof Adjustments; label: string; min: number; max: number }[] = [
  { key: 'brightness', label: 'Brightness', min: -100, max: 100 },
  { key: 'contrast', label: 'Contrast', min: -100, max: 100 },
  { key: 'sharpness', label: 'Sharpness', min: 0, max: 100 },
  { key: 'denoise', label: 'Noise reduction', min: 0, max: 100 },
  { key: 'shadows', label: 'Shadow removal', min: 0, max: 100 },
  { key: 'whiten', label: 'Whiten background', min: 0, max: 100 },
]

export const rotateBy = (r: Rotation, d: number) => ((((r + d) % 360) + 360) % 360) as Rotation

export default function EnhanceView({ page, top, onChange, onRotate, onApplyToAll, scanCount }: Props) {
  const [mode, setMode] = useState<'auto' | 'manual'>('auto')
  const [compare, setCompare] = useState(false)
  const [split, setSplit] = useState(50)
  const after = usePreview(page)
  const before = usePreview(page, true, compare && page.kind === 'scan')

  if (page.kind !== 'scan') {
    return (
      <ToolLayout
        top={top}
        canvas={<PagePreview page={page} preview={after} />}
        panel={
          <div className="space-y-3">
            <Notice>
              This is a page of an imported PDF. Its original text and vector graphics are kept, so image filters are
              not applied. You can rotate it here, annotate it, or recognise its text.
            </Notice>
            <div className="flex gap-2">
              <button className="btn-secondary flex-1" onClick={() => onRotate(-90)}>
                <RotateLeftIcon /> Left
              </button>
              <button className="btn-secondary flex-1" onClick={() => onRotate(90)}>
                <RotateIcon /> Right
              </button>
            </div>
          </div>
        }
      />
    )
  }

  const a = page.adjust
  const changed = page.filter !== 'original' || SLIDERS.some((s) => a[s.key] !== 0)

  return (
    <ToolLayout
      top={top}
      canvas={
        <PagePreview
          page={page}
          preview={after}
          under={null}
        >
          {compare && before.url && (
            <>
              <img
                src={before.url}
                alt="Before"
                draggable={false}
                className="absolute inset-0 size-full select-none"
                style={{ clipPath: `inset(0 ${100 - split}% 0 0)` }}
              />
              <span className="pointer-events-none absolute inset-y-0 w-0.5 bg-cyan-400 shadow" style={{ left: `${split}%` }} />
              <span className="pointer-events-none absolute top-2 left-2 rounded bg-slate-900/80 px-2 py-0.5 text-xs">Before</span>
              <span className="pointer-events-none absolute top-2 right-12 rounded bg-slate-900/80 px-2 py-0.5 text-xs">After</span>
              <input
                type="range"
                min={0}
                max={100}
                value={split}
                onChange={(e) => setSplit(Number(e.target.value))}
                className="absolute inset-x-0 bottom-3 mx-auto w-3/4 accent-cyan-400"
                aria-label="Before / after split"
              />
            </>
          )}
        </PagePreview>
      }
      panel={
        <div className="space-y-4">
          <div className="flex gap-2">
            <button className="icon-btn bg-slate-800" onClick={() => onRotate(-90)} aria-label="Rotate left">
              <RotateLeftIcon />
            </button>
            <button className="icon-btn bg-slate-800" onClick={() => onRotate(90)} aria-label="Rotate right">
              <RotateIcon />
            </button>
            <button className={`btn-secondary flex-1 px-2 text-sm ${compare ? 'ring-cyan-400' : ''}`} onClick={() => setCompare((c) => !c)} aria-pressed={compare}>
              <CompareIcon width={18} />
              {compare ? 'Hide compare' : 'Before / after'}
            </button>
          </div>

          <Segmented
            label="Enhancement mode"
            value={mode}
            onChange={setMode}
            options={[
              { id: 'auto', label: 'Automatic' },
              { id: 'manual', label: 'Manual' },
            ]}
          />

          {mode === 'auto' ? (
            <div>
              <SectionTitle>Filter</SectionTitle>
              <div className="grid grid-cols-3 gap-2">
                {FILTERS.map((f) => (
                  <button
                    key={f.id}
                    onClick={() => {
                      onChange({ filter: f.id })
                      rememberSetting('filter', f.id)
                    }}
                    aria-pressed={page.filter === f.id}
                    title={f.hint}
                    className={`rounded-xl px-2 py-2.5 text-sm font-medium ring-1 transition ${
                      page.filter === f.id ? 'bg-cyan-400 text-slate-950 ring-cyan-400' : 'bg-slate-800 text-slate-200 ring-white/10 active:bg-slate-700'
                    }`}
                  >
                    {f.label}
                  </button>
                ))}
              </div>
              <p className="mt-2 text-xs text-slate-500">{FILTERS.find((f) => f.id === page.filter)?.hint}</p>
            </div>
          ) : (
            <div className="space-y-3">
              {SLIDERS.map((s) => (
                <Slider
                  key={s.key}
                  label={s.label}
                  min={s.min}
                  max={s.max}
                  value={a[s.key]}
                  format={(v) => (s.min < 0 && v > 0 ? `+${v}` : String(v))}
                  onChange={(v) => onChange({ adjust: { ...a, [s.key]: v } }, `adjust:${s.key}`)}
                />
              ))}
              <p className="text-xs text-slate-500">Sliders work on top of the selected filter. Double-click a slider to reset it.</p>
            </div>
          )}

          <div className="grid grid-cols-2 gap-2">
            <button
              className="btn-secondary px-2 text-sm"
              onClick={() => onChange({ filter: 'auto', adjust: { ...NO_ADJUSTMENTS } })}
              title="Shadow removal, white background and auto contrast"
            >
              <WandIcon width={18} />
              Auto enhance
            </button>
            <button className="btn-secondary px-2 text-sm" onClick={() => onChange({ filter: 'original', adjust: { ...NO_ADJUSTMENTS } })} disabled={!changed}>
              <ResetIcon width={18} />
              Reset filters
            </button>
          </div>
          {scanCount > 1 && (
            <button className="btn-ghost w-full text-sm" onClick={onApplyToAll}>
              Apply these settings to all {scanCount} photo pages
            </button>
          )}
        </div>
      }
    />
  )
}
