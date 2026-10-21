import { useMemo, useRef, useState } from 'react'
import { useDialogs } from '../components/dialogs'
import { CopyIcon, DocIcon, DownloadIcon, OcrIcon, SearchIcon } from '../components/Icons'
import { ProgressBar, SectionTitle, Toggle } from '../components/ui'
import { rememberSetting } from '../lib/document/import'
import { recognizePage, terminateOcr } from '../lib/ocr/engine'
import { buildDocx, buildTxt, documentText } from '../lib/ocr/text-export'
import { pageKey } from '../lib/render'
import { downloadFiles } from '../lib/share'
import { pageOcrText } from '../lib/storage/repository'
import { OCR_LANGS, type OcrLang, type OcrResult, type Page } from '../types'
import { PagePreview } from './PagePreview'
import { Notice, ToolLayout } from './ToolLayout'
import { usePreview } from './usePreview'

interface Props {
  page: Page
  pages: Page[]
  top: React.ReactNode
  lang: OcrLang
  docName: string
  onLang: (l: OcrLang) => void
  onResult: (pageId: string, r: OcrResult | null, merge?: string) => void
  onGoTo: (pageId: string) => void
}

const STATUS_LABEL: Record<string, string> = {
  'loading tesseract core': 'Loading OCR engine',
  'initializing tesseract': 'Starting OCR engine',
  'loading language traineddata': 'Loading language model',
  'loading language traineddata (from cache)': 'Loading language model',
  'initializing api': 'Starting OCR engine',
  'recognizing text': 'Recognising text',
  'preparing page': 'Preparing page',
}

const norm = (s: string) => s.toLocaleLowerCase()

export default function OcrView({ page, pages, top, lang, docName, onLang, onResult, onGoTo }: Props) {
  const dialogs = useDialogs()
  const preview = usePreview(page)
  const [run, setRun] = useState<{ index: number; total: number; status: string; progress: number } | null>(null)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [query, setQuery] = useState('')
  const [boxes, setBoxes] = useState(false)
  const stop = useRef(false)

  const ocr = page.ocr
  const stale = ocr && ocr.source === 'ocr' && ocr.key !== pageKey(page)
  const text = pageOcrText(ocr)

  const recognize = async (targets: Page[]) => {
    stop.current = false
    for (const [i, p] of targets.entries()) {
      if (stop.current) break
      setRun({ index: i, total: targets.length, status: 'Preparing page', progress: 0 })
      try {
        const r = await recognizePage(p, lang, (status, progress) =>
          setRun({ index: i, total: targets.length, status: STATUS_LABEL[status] ?? status, progress }),
        )
        if (stop.current) break
        onResult(p.id, r)
        setErrors((e) => {
          const { [p.id]: _, ...rest } = e
          return rest
        })
      } catch (e) {
        if (stop.current) break
        console.error('OCR failed', e)
        setErrors((er) => ({ ...er, [p.id]: e instanceof Error ? e.message : 'Recognition failed' }))
      }
    }
    setRun(null)
    if (!stop.current) dialogs.toast(targets.length > 1 ? `Text recognised on ${targets.length} pages` : 'Text recognised', 'success')
  }

  const cancel = async () => {
    stop.current = true
    await terminateOcr()
    setRun(null)
    dialogs.toast('Recognition stopped', 'info')
  }

  const copy = async (t: string) => {
    try {
      await navigator.clipboard.writeText(t)
      dialogs.toast('Copied to clipboard', 'success')
    } catch {
      dialogs.toast('Copying is not allowed here — select the text and copy manually.', 'error')
    }
  }

  const exportText = async (kind: 'txt' | 'docx') => {
    const name = docName
    const file = kind === 'txt' ? buildTxt(pages, name) : await buildDocx(pages, name)
    await downloadFiles([file])
  }

  // Search across all pages (recognised or edited text).
  const results = useMemo(() => {
    const q = norm(query.trim())
    if (!q) return []
    return pages
      .map((p, i) => {
        const t = pageOcrText(p.ocr)
        const lower = norm(t)
        let count = 0
        let at = lower.indexOf(q)
        const first = at
        while (at >= 0) {
          count++
          at = lower.indexOf(q, at + q.length)
        }
        return { p, i, count, snippet: first >= 0 ? t.slice(Math.max(0, first - 30), first + q.length + 30).replace(/\s+/g, ' ') : '' }
      })
      .filter((r) => r.count > 0)
  }, [pages, query])

  const q = norm(query.trim())
  const hitWords = q && ocr ? ocr.words.filter((w) => norm(w.t).includes(q) || q.includes(norm(w.t).replace(/[.,;:!?]$/, ''))) : []
  const recognised = pages.filter((p) => p.ocr).length
  const missing = pages.filter((p) => !p.ocr || (p.ocr.source === 'ocr' && p.ocr.key !== pageKey(p)))

  return (
    <ToolLayout
      top={top}
      canvas={
        <PagePreview page={page} preview={preview}>
          {ocr && (boxes || q) && (
            <svg viewBox="0 0 1 1" preserveAspectRatio="none" className="pointer-events-none absolute inset-0 size-full">
              {(q ? hitWords : ocr.words).map((w, i) => (
                <rect
                  key={i}
                  x={w.b[0]}
                  y={w.b[1]}
                  width={w.b[2] - w.b[0]}
                  height={w.b[3] - w.b[1]}
                  fill={q ? 'rgb(250 204 21 / 0.45)' : 'none'}
                  stroke={q ? 'none' : 'rgb(34 211 238 / 0.8)'}
                  strokeWidth={1}
                  vectorEffect="non-scaling-stroke"
                />
              ))}
            </svg>
          )}
        </PagePreview>
      }
      panel={
        <div className="space-y-4">
          <label className="block">
            <span className="mb-1 block text-sm text-slate-300">Document language</span>
            <select
              className="field"
              value={lang}
              onChange={(e) => {
                onLang(e.target.value as OcrLang)
                rememberSetting('ocrLang', e.target.value)
              }}
              disabled={!!run}
            >
              {OCR_LANGS.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.label}
                </option>
              ))}
            </select>
          </label>

          {run ? (
            <div className="space-y-2 rounded-xl bg-slate-800 p-3">
              <ProgressBar
                value={(run.index + run.progress) / run.total}
                label={`${run.status}${run.total > 1 ? ` · page ${run.index + 1} of ${run.total}` : ''}`}
              />
              <button className="btn-ghost w-full text-sm" onClick={() => void cancel()}>
                Stop
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-2">
              <button className="btn-primary px-2 text-sm" onClick={() => void recognize([page])}>
                <OcrIcon width={18} />
                {ocr ? 'Re-run page' : 'Recognise page'}
              </button>
              <button className="btn-secondary px-2 text-sm" onClick={() => void recognize(missing.length ? missing : pages)} disabled={pages.length < 2}>
                {missing.length && missing.length < pages.length ? `Remaining (${missing.length})` : `All ${pages.length} pages`}
              </button>
            </div>
          )}

          {errors[page.id] && (
            <Notice tone="warn">
              Recognition failed: {errors[page.id]}{' '}
              <button className="font-semibold underline" onClick={() => void recognize([page])}>
                Try again
              </button>
            </Notice>
          )}
          {page.kind === 'pdf' && page.hasText && !ocr && (
            <Notice>This PDF page already contains text — it will be extracted directly, without OCR.</Notice>
          )}
          {stale && <Notice tone="warn">The page was edited after recognition. Re-run to update the text.</Notice>}

          {ocr && (
            <div>
              <div className="mb-1.5 flex items-center justify-between">
                <SectionTitle>
                  Page text {ocr.source === 'pdf-text' ? '(from PDF)' : ocr.confidence != null ? `· ${Math.round(ocr.confidence)}% confidence` : ''}
                </SectionTitle>
                {ocr.edited !== null && (
                  <button className="text-xs text-cyan-300" onClick={() => onResult(page.id, { ...ocr, edited: null })}>
                    Revert edits
                  </button>
                )}
              </div>
              <textarea
                className="field min-h-48 font-mono text-sm leading-relaxed"
                value={text}
                onChange={(e) => onResult(page.id, { ...ocr, edited: e.target.value }, `ocr-edit:${page.id}`)}
                aria-label="Recognised text (editable)"
                spellCheck={false}
              />
              {!text.trim() && <p className="mt-1 text-xs text-slate-500">No text was found on this page.</p>}
              <div className="mt-2 flex gap-2">
                <button className="btn-secondary flex-1 px-2 text-sm" onClick={() => void copy(text)}>
                  <CopyIcon width={18} />
                  Copy page
                </button>
                <button className="btn-secondary flex-1 px-2 text-sm" onClick={() => void copy(documentText(pages, false))} disabled={!recognised}>
                  <CopyIcon width={18} />
                  Copy all
                </button>
              </div>
              {ocr.words.length > 0 && <Toggle checked={boxes} onChange={setBoxes} label="Show recognised word boxes" />}
            </div>
          )}

          {recognised > 0 && (
            <>
              <div>
                <SectionTitle>Search text</SectionTitle>
                <div className="relative">
                  <SearchIcon className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-slate-500" width={18} />
                  <input className="field pl-10" type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Find in recognised text" aria-label="Search recognised text" />
                </div>
                {q && (
                  <ul className="mt-2 space-y-1 text-sm">
                    {results.length === 0 && <li className="text-slate-500">No matches</li>}
                    {results.map((r) => (
                      <li key={r.p.id}>
                        <button className={`w-full rounded-lg px-2 py-1.5 text-left hover:bg-slate-800 ${r.p.id === page.id ? 'bg-slate-800' : ''}`} onClick={() => onGoTo(r.p.id)}>
                          <span className="font-medium">
                            Page {r.i + 1} · {r.count} match{r.count === 1 ? '' : 'es'}
                          </span>
                          <span className="block truncate text-xs text-slate-400">…{r.snippet}…</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              <div>
                <SectionTitle>Export text ({recognised} of {pages.length} pages)</SectionTitle>
                <div className="grid grid-cols-2 gap-2">
                  <button className="btn-secondary px-2 text-sm" onClick={() => void exportText('txt')}>
                    <DownloadIcon width={18} />
                    TXT
                  </button>
                  <button className="btn-secondary px-2 text-sm" onClick={() => void exportText('docx')}>
                    <DocIcon width={18} />
                    Word (DOCX)
                  </button>
                </div>
              </div>
            </>
          )}

          <p className="text-xs leading-relaxed text-slate-500">
            OCR runs on this device (Tesseract). It works best on sharp, evenly lit printed text. Handwriting, very small
            or low-contrast text, tables and multi-column layouts may be recognised incompletely or out of order — check
            and correct the text above. The language model (~2–3 MB) is downloaded once on first use.
          </p>
        </div>
      }
    />
  )
}
