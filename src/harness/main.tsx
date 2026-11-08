// Detection test harness (dev only, /harness.html): runs the app's real decode + worker
// detection on every image in test-images/, compares with hand-labelled corners (IoU,
// corner error, time) and lets you label/correct ground truth.
import { StrictMode, useCallback, useEffect, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import CornerEditor, { isConvex } from '../components/CornerEditor'
import { fullFrame } from '../lib/geometry'
import { decodeInput } from '../lib/imaging/decode'
import { detect } from '../lib/imaging/detect'
import {
  scoreDetection,
  summarize,
  toMarkdown,
  toNormalised,
  toPixels,
  type GroundTruth,
  type GtCorners,
  type ImageScore,
} from '../lib/imaging/quad-metrics'
import type { Corners } from '../types'
import '../index.css'

/** Display copies are this big; corners are stored normalised, so the size does not matter. */
const VIEW_SIDE = 1200

interface Item {
  file: string
  url: string
  width: number
  height: number
  /** Decoded (oriented, capped) size used for detection. */
  decodedSize: string
  decodeMs: number
  det?: { corners: Corners; detection: string; ms: number; totalMs: number }
  error?: string
}

async function loadItem(file: string): Promise<Item> {
  const blob = await (await fetch(`/test-images/${encodeURIComponent(file)}`)).blob()
  const named = new File([blob], file, { type: blob.type })
  const t0 = performance.now()
  const bitmap = await decodeInput(named)
  const decodeMs = performance.now() - t0
  const s = Math.min(1, VIEW_SIDE / Math.max(bitmap.width, bitmap.height))
  const view = new OffscreenCanvas(Math.round(bitmap.width * s), Math.round(bitmap.height * s))
  view.getContext('2d')!.drawImage(bitmap, 0, 0, view.width, view.height)
  const url = URL.createObjectURL(await view.convertToBlob({ type: 'image/jpeg', quality: 0.85 }))
  const item: Item = { file, url, width: view.width, height: view.height, decodedSize: `${bitmap.width}×${bitmap.height}`, decodeMs }
  view.width = view.height = 0
  try {
    const t1 = performance.now()
    // The bitmap is transferred to the worker (and closed there).
    const r = await detect(bitmap, bitmap.width, bitmap.height)
    const totalMs = performance.now() - t1
    item.det = { corners: r.corners.map((p) => ({ x: p.x * s, y: p.y * s })) as Corners, detection: r.detection, ms: r.ms, totalMs }
  } catch (e) {
    item.error = e instanceof Error ? e.message : String(e)
    bitmap.close()
  }
  return item
}

const poly = (c: Corners) => c.map((p) => `${p.x},${p.y}`).join(' ')

function Card({ item, gt, score, onLabel }: { item: Item; gt: GtCorners | undefined; score?: ImageScore; onLabel: () => void }) {
  const truth = gt ? toPixels(gt, item.width, item.height) : null
  return (
    <div className="rounded-xl bg-slate-900 p-3 ring-1 ring-white/10">
      <div className="relative">
        <img src={item.url} alt={item.file} className="w-full" />
        <svg viewBox={`0 0 ${item.width} ${item.height}`} className="absolute inset-0 size-full">
          {truth && <polygon points={poly(truth)} fill="none" stroke="#22c55e" strokeWidth={4} />}
          {item.det && <polygon points={poly(item.det.corners)} fill="none" stroke="#ef4444" strokeWidth={3} strokeDasharray="10 6" />}
        </svg>
      </div>
      <div className="mt-2 space-y-0.5 text-xs text-slate-300">
        <div className="font-semibold text-slate-100">{item.file}</div>
        <div>
          decoded {item.decodedSize} in {item.decodeMs.toFixed(0)} ms
        </div>
        {item.det && (
          <div>
            result <b>{item.det.detection}</b> · detect {item.det.ms.toFixed(0)} ms (round trip {item.det.totalMs.toFixed(0)} ms)
          </div>
        )}
        {item.error && <div className="text-red-400">{item.error}</div>}
        {gt === undefined ? (
          <div className="text-amber-400">not labelled</div>
        ) : gt === null ? (
          <div>ground truth: no document {score && `· ${score.iou === 1 ? 'correctly rejected' : 'false positive'}`}</div>
        ) : (
          score && (
            <div>
              IoU <b>{score.iou.toFixed(3)}</b> · max corner error {((score.cornerError ?? 0) * 100).toFixed(1)} %
            </div>
          )
        )}
      </div>
      <button className="mt-2 rounded-lg bg-slate-800 px-3 py-1.5 text-sm" onClick={onLabel}>
        {gt === undefined ? 'Label' : 'Edit label'}
      </button>
    </div>
  )
}

function Labeler({ item, gt, onSave, onClose }: { item: Item; gt: GtCorners | undefined; onSave: (c: GtCorners) => void; onClose: () => void }) {
  const initial = gt ? toPixels(gt, item.width, item.height) : (item.det?.corners ?? fullFrame(item.width, item.height))
  const [corners, setCorners] = useState<Corners>(initial)
  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-slate-950">
      <div className="flex items-center gap-2 p-3">
        <div className="mr-auto font-semibold">{item.file} — drag the 4 corners onto the page corners</div>
        <button className="rounded-lg bg-slate-800 px-3 py-1.5" onClick={() => onSave(null)}>
          No document
        </button>
        <button className="rounded-lg bg-slate-800 px-3 py-1.5" onClick={onClose}>
          Cancel
        </button>
        <button
          className="rounded-lg bg-cyan-500 px-3 py-1.5 font-semibold text-slate-950 disabled:opacity-40"
          disabled={!isConvex(corners)}
          onClick={() => onSave(toNormalised(corners, item.width, item.height))}
        >
          Save
        </button>
      </div>
      <div className="min-h-0 flex-1">
        <CornerEditor src={item.url} width={item.width} height={item.height} corners={corners} onChange={setCorners} />
      </div>
    </div>
  )
}

function Harness() {
  const [items, setItems] = useState<Item[]>([])
  const [gt, setGt] = useState<GroundTruth>({ version: 1, images: {} })
  const [running, setRunning] = useState(false)
  const [labeling, setLabeling] = useState<Item | null>(null)
  const [label, setLabel] = useState('')
  const [status, setStatus] = useState('')
  const urls = useRef<string[]>([])
  const generation = useRef(0)

  const run = useCallback(async () => {
    // A newer run (or StrictMode's second effect) supersedes this one.
    const gen = ++generation.current
    setRunning(true)
    urls.current.forEach((u) => URL.revokeObjectURL(u))
    urls.current = []
    setItems([])
    const [files, truth] = await Promise.all([
      fetch('/__harness/images').then((r) => r.json() as Promise<string[]>),
      fetch('/__harness/ground-truth').then((r) => r.json() as Promise<GroundTruth>),
    ])
    if (gen !== generation.current) return
    setGt(truth)
    for (const f of files) {
      try {
        const it = await loadItem(f)
        urls.current.push(it.url)
        if (gen !== generation.current) return
        setItems((xs) => [...xs, it])
      } catch (e) {
        if (gen !== generation.current) return
        setItems((xs) => [...xs, { file: f, url: '', width: 1, height: 1, decodedSize: '?', decodeMs: 0, error: String(e) }])
      }
    }
    setRunning(false)
  }, [])

  useEffect(() => {
    void run()
  }, [run])

  const scores = items
    .filter((it) => it.det && gt.images[it.file] !== undefined)
    .map((it) => scoreDetection(it.file, gt.images[it.file].corners, it.det!, it.width, it.height))
  const summary = summarize(scores)

  const saveGt = async (file: string, corners: GtCorners) => {
    const next: GroundTruth = { ...gt, images: { ...gt.images, [file]: { corners } } }
    setGt(next)
    setLabeling(null)
    await fetch('/__harness/ground-truth', { method: 'POST', body: JSON.stringify(next) })
    setStatus(`Saved label for ${file}`)
  }

  const appendResults = async () => {
    const title = `${label || 'Browser run'} — ${new Date().toISOString().slice(0, 10)} · ${navigator.userAgent.match(/(Chrome|Firefox|Safari)\/[\d.]+/)?.[0] ?? 'browser'}`
    await fetch('/__harness/results', { method: 'POST', body: JSON.stringify({ markdown: toMarkdown(scores, title) }) })
    setStatus('Appended to docs/detection-benchmark.md')
  }

  return (
    <div className="mx-auto max-w-7xl p-4">
      <h1 className="text-xl font-bold">Detection harness</h1>
      <p className="mt-1 text-sm text-slate-400">
        Green = ground truth, red dashed = detection. Images come from <code>test-images/</code>, labels from{' '}
        <code>test-images/ground-truth.json</code>.
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-3 rounded-xl bg-slate-900 p-3 text-sm ring-1 ring-white/10">
        <span>
          labelled {scores.length}/{items.length} · mean IoU <b>{summary.meanIoU.toFixed(3)}</b> · IoU ≥ 0.9{' '}
          <b>{(summary.hitRate90 * 100).toFixed(0)} %</b> · mean detect <b>{summary.meanMs.toFixed(0)} ms</b>
        </span>
        <button className="rounded-lg bg-slate-800 px-3 py-1.5" disabled={running} onClick={() => void run()}>
          {running ? 'Running…' : 'Re-run'}
        </button>
        <input
          className="rounded-lg bg-slate-800 px-3 py-1.5"
          placeholder="Run label (e.g. Phase 1 baseline)"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
        />
        <button className="rounded-lg bg-slate-800 px-3 py-1.5" disabled={running || !scores.length} onClick={() => void appendResults()}>
          Append to benchmark doc
        </button>
        <span className="text-cyan-400">{status}</span>
      </div>
      <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {items.map((it) => (
          <Card
            key={it.file}
            item={it}
            gt={gt.images[it.file]?.corners}
            score={scores.find((s) => s.file === it.file)}
            onLabel={() => setLabeling(it)}
          />
        ))}
      </div>
      {labeling && (
        <Labeler
          item={labeling}
          gt={gt.images[labeling.file]?.corners}
          onSave={(c) => void saveGt(labeling.file, c)}
          onClose={() => setLabeling(null)}
        />
      )}
    </div>
  )
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Harness />
  </StrictMode>,
)
