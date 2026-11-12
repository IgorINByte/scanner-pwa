// Fixture test page (dev only, /fixtures.html): runs detection on every photo in each
// folder of test/fixtures/ in several variants and prints source, confidence and corners.
// SYN_* images come with a SYN_*.json holding the exact corners; for those the page also
// computes IoU and the worst corner error (% of the diagonal) and a pass/fail per variant:
//   pass = IoU >= 0.90 and corner error <= 3 %
//   expected "detect_clipped": a detected corner may lie up to OUTSIDE_MARGIN (5 %) outside
//   the image, as in the app; IoU is computed on both quads clipped to the image, and the
//   error between both quads' corners clamped to the image (the part the warp can show).
// Photos without JSON (the *_stvarne folders) get no automatic score; they are judged by eye.
import { StrictMode, useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { decodeInput } from '../lib/imaging/decode'
import { detect } from '../lib/imaging/detect'
import type { DetectOptions, DetectResult } from '../lib/imaging/detect-run'
import { workingSize } from '../lib/imaging/detect-core'
import { clippedIoU, maxCornerError, quadIoU } from '../lib/imaging/quad-metrics'
import { OUTSIDE_MARGIN, REFINE_SIZE } from '../lib/imaging/refine'
import type { Corners } from '../types'
import '../index.css'

const VIEW_SIDE = 700
const PASS_IOU = 0.9
const PASS_ERR = 0.03

const VARIANTS: { id: string; label: string; opts: DetectOptions }[] = [
  { id: 'before', label: 'prije (klasična)', opts: { only: 'classical', minArea: 0 } },
  { id: 'after', label: 'poslije (model)', opts: {} },
]

interface Truth {
  corners: Corners
  expected: 'detect' | 'detect_clipped'
  description?: string
}

interface Score {
  iou: number
  err: number
  inFrame: boolean
  pass: boolean
}

interface Row {
  file: string
  folder: string
  url: string
  /** Display size; detection results are scaled to it for drawing. */
  width: number
  height: number
  W: number
  H: number
  truth: Truth | null
  results: Record<string, DetectResult>
  scores: Record<string, Score>
  error?: string
}

/** Worst corner error, taking the best cyclic match (corner order of a ~45° page is ambiguous). */
const cornerError = (c: Corners, t: Corners, W: number, H: number) =>
  Math.min(...[0, 1, 2, 3].map((k) => maxCornerError([0, 1, 2, 3].map((i) => c[(i + k) % 4]) as Corners, t, W, H)))

function score(r: DetectResult, t: Truth, W: number, H: number): Score {
  const c = r.corners
  if (t.expected === 'detect_clipped') {
    const clamp = (q: Corners) => q.map((p) => ({ x: Math.min(W, Math.max(0, p.x)), y: Math.min(H, Math.max(0, p.y)) })) as Corners
    const tx = OUTSIDE_MARGIN * W
    const ty = OUTSIDE_MARGIN * H
    const inFrame = c.every((p) => p.x >= -tx && p.x <= W + tx && p.y >= -ty && p.y <= H + ty)
    const iou = clippedIoU(c, t.corners, W, H)
    const err = cornerError(clamp(c), clamp(t.corners), W, H)
    return { iou, err, inFrame, pass: iou >= PASS_IOU && err <= PASS_ERR && inFrame }
  }
  const iou = quadIoU(c, t.corners)
  const err = cornerError(c, t.corners, W, H)
  return { iou, err, inFrame: true, pass: iou >= PASS_IOU && err <= PASS_ERR }
}

async function loadTruth(path: string): Promise<Truth | null> {
  const res = await fetch(`/test/fixtures/${path.replace(/\.[^.]+$/, '.json')}`)
  if (!res.ok || !res.headers.get('content-type')?.includes('json')) return null
  const j = await res.json()
  return {
    corners: (j.corners_TL_TR_BR_BL as [number, number][]).map(([x, y]) => ({ x, y })) as Corners,
    expected: j.expected,
    description: j.description,
  }
}

async function runOne(folder: string, file: string): Promise<Row> {
  const path = `${folder}/${file}`
  const [blob, truth] = await Promise.all([fetch(`/test/fixtures/${path}`).then((r) => r.blob()), file.startsWith('SYN_') ? loadTruth(path) : null])
  const full = await decodeInput(new File([blob], file, { type: blob.type }))
  const W = full.width
  const H = full.height
  // Same input as the app: the stored source decoded at the refinement size.
  const ws = workingSize(W, H, REFINE_SIZE)
  const mk = () => createImageBitmap(full, { resizeWidth: ws.width, resizeHeight: ws.height, resizeQuality: 'high' })
  const s = Math.min(1, VIEW_SIDE / Math.max(W, H))
  const view = new OffscreenCanvas(Math.round(W * s), Math.round(H * s))
  view.getContext('2d')!.drawImage(full, 0, 0, view.width, view.height)
  const url = URL.createObjectURL(await view.convertToBlob({ type: 'image/jpeg', quality: 0.8 }))
  const row: Row = { file, folder, url, width: view.width, height: view.height, W, H, truth, results: {}, scores: {} }
  view.width = view.height = 1
  try {
    for (const v of VARIANTS) {
      // Bitmaps are transferred to the worker and closed there.
      const r = await detect(await mk(), W, H, undefined, v.opts)
      row.results[v.id] = r
      if (truth) row.scores[v.id] = score(r, truth, W, H)
    }
  } catch (e) {
    row.error = e instanceof Error ? e.message : String(e)
  } finally {
    full.close()
  }
  return row
}

const pct = (v: number) => `${(v * 100).toFixed(1)}%`
const fmtCorners = (c: Corners, W: number, H: number) => c.map((p) => `(${pct(p.x / W)}, ${pct(p.y / H)})`).join(' ')
const snapStr = (s: DetectResult['snapped']) => (s ? ` snap ${'TRBL'.split('').map((l, i) => (s[i] ? l : '-')).join('')}` : '')

function lines(r: Row): string[] {
  const out = [`${r.folder}/${r.file}${r.truth ? `  [${r.truth.expected}] ${r.truth.description ?? ''}` : ''}`]
  if (r.truth) out.push(`  truth:  ${fmtCorners(r.truth.corners, r.W, r.H)}`)
  for (const v of VARIANTS) {
    const d = r.results[v.id]
    if (!d) continue
    const sc = r.scores[v.id]
    const m = sc ? `  IoU ${sc.iou.toFixed(3)} err ${pct(sc.err)}${sc.inFrame ? '' : ' OUT'} ${sc.pass ? 'PASS' : 'fail'}` : ''
    out.push(`  ${v.id.padEnd(5)} ${d.source.padEnd(9)} conf ${d.confidence.toFixed(2)}${snapStr(d.snapped)}${m}  ${fmtCorners(d.corners, r.W, r.H)}`)
  }
  if (r.error) out.push(`  error: ${r.error}`)
  return out
}

const fmtTable = (head: string[], body: string[][]) => {
  const w = head.map((h, i) => Math.max(h.length, ...body.map((b) => b[i].length)))
  const fmt = (cells: string[]) => '| ' + cells.map((c, i) => c.padEnd(w[i])).join(' | ') + ' |'
  return [fmt(head), '|' + w.map((n) => '-'.repeat(n + 2)).join('|') + '|', ...body.map(fmt)].join('\n')
}

/** SYN table: passes per folder and variant. Folders without SYN photos are left out. */
function synTable(rows: Record<string, Row[]>): string {
  const body = Object.entries(rows)
    .map(([folder, rs]) => [folder, rs.filter((r) => r.truth)] as const)
    .filter(([, syn]) => syn.length)
    .map(([folder, syn]) => [folder, String(syn.length), ...VARIANTS.map((v) => `${syn.filter((r) => r.scores[v.id]?.pass).length}/${syn.length}`)])
  return fmtTable(['mapa', 'SYN', ...VARIANTS.map((v) => v.label)], body)
}

/** Real photos (no ground truth): which detector produced the frame, per variant. */
function realTable(rows: Record<string, Row[]>): string {
  const src = (rs: Row[], id: string) =>
    (['model', 'classical', 'none'] as const).map((k) => `${k[0]}${rs.filter((r) => r.results[id]?.source === k).length}`).join(' ')
  const body = Object.entries(rows)
    .map(([folder, rs]) => [folder, rs.filter((r) => !r.truth)] as const)
    .filter(([, real]) => real.length)
    .map(([folder, real]) => [folder, String(real.length), ...VARIANTS.map((v) => src(real, v.id))])
  return fmtTable(['mapa', 'slika', ...VARIANTS.map((v) => `${v.label} m/c/n`)], body)
}

const poly = (c: Corners, s: number) => c.map((p) => `${p.x * s},${p.y * s}`).join(' ')
const COLOR = { model: '#22c55e', classical: '#f59e0b', none: '#ef4444' } as const

function Fixtures() {
  const [rows, setRows] = useState<Record<string, Row[]>>({})
  const [status, setStatus] = useState('Loading…')
  const [shown, setShown] = useState('after')

  useEffect(() => {
    let cancelled = false
    void (async () => {
      const list = (await (await fetch('/__harness/fixtures')).json()) as Record<string, string[]>
      const folders = Object.keys(list)
      const total = folders.reduce((n, c) => n + list[c].length, 0)
      if (!total) {
        setStatus('test/fixtures/ is empty — add photos and reload.')
        return
      }
      let done = 0
      for (const c of folders) {
        for (const f of list[c]) {
          const r = await runOne(c, f).catch(
            (e) => ({ file: f, folder: c, url: '', width: 1, height: 1, W: 1, H: 1, truth: null, results: {}, scores: {}, error: String(e) }) as Row,
          )
          if (cancelled) return
          setRows((x) => ({ ...x, [c]: [...(x[c] ?? []), r] }))
          setStatus(`${++done}/${total}`)
        }
      }
      setStatus(`Done: ${total} photos`)
    })()
    return () => {
      cancelled = true
    }
  }, [])

  const log = Object.values(rows)
    .flat()
    .flatMap(lines)
    .join('\n')

  return (
    <div className="p-4">
      <h1 className="text-xl font-bold">Detection fixtures</h1>
      <p className="mt-1 text-sm text-slate-400">
        White = true corners (SYN). Grey dashed = before (classical). Solid = selected variant:{' '}
        <span style={{ color: COLOR.model }}>model</span>, <span style={{ color: COLOR.classical }}>classical</span>,{' '}
        <span style={{ color: COLOR.none }}>none</span>. Pass = IoU ≥ 0.90 and corner error ≤ 3 % of the diagonal.
      </p>
      <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
        <span className="text-cyan-400" id="status">
          {status}
        </span>
        {VARIANTS.slice(1).map((v) => (
          <button key={v.id} className={`rounded-lg px-2 py-1 ${shown === v.id ? 'bg-cyan-600' : 'bg-slate-800'}`} onClick={() => setShown(v.id)}>
            {v.label}
          </button>
        ))}
      </div>
      <pre id="table" className="mt-3 rounded-xl bg-slate-900 p-3 text-xs">
        {`STVARNE\n${realTable(rows)}\n\nSYN\n${synTable(rows)}`}
      </pre>
      {Object.entries(rows).map(([c, rs]) => (
        <section key={c} className="mt-4">
          <h2 className="font-semibold">{c}</h2>
          <div className="mt-2 grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-6">
            {rs.map((r) => {
              const s = r.width / r.W
              const sel = r.results[shown]
              const sc = r.scores[shown]
              return (
                <div key={r.file} className="rounded-xl bg-slate-900 p-2 ring-1 ring-white/10">
                  <div className="relative">
                    {r.url && <img src={r.url} alt={r.file} className="w-full" />}
                    <svg viewBox={`0 0 ${r.width} ${r.height}`} className="absolute inset-0 size-full overflow-visible">
                      {r.truth && <polygon points={poly(r.truth.corners, s)} fill="none" stroke="#fff" strokeWidth={2} />}
                      {r.results.before && <polygon points={poly(r.results.before.corners, s)} fill="none" stroke="#94a3b8" strokeWidth={2} strokeDasharray="8 6" />}
                      {sel && <polygon points={poly(sel.corners, s)} fill="none" stroke={COLOR[sel.source]} strokeWidth={3} />}
                    </svg>
                  </div>
                  <div className="mt-1 text-[11px] text-slate-300">
                    {r.file} · {sel?.source ?? '—'}
                    {sc && (
                      <span className={sc.pass ? 'text-green-400' : 'text-red-400'}>
                        {' '}
                        · IoU {sc.iou.toFixed(2)} · err {pct(sc.err)}
                        {!sc.inFrame && ' · OUT'}
                      </span>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </section>
      ))}
      <h2 className="mt-6 font-semibold">Plain-text log</h2>
      <pre id="log" className="mt-2 rounded-xl bg-slate-900 p-3 text-xs whitespace-pre">
        {log}
      </pre>
    </div>
  )
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Fixtures />
  </StrictMode>,
)
