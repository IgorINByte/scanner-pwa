import { useMemo, useState } from 'react'
import { useDialogs } from '../components/dialogs'
import { DownloadIcon, EyeIcon, LockIcon, MailIcon, ShareIcon } from '../components/Icons'
import { ProgressBar, Segmented, SectionTitle, Toggle } from '../components/ui'
import { formatBytes, sanitizeFileName } from '../lib/files'
import { buildDocx, buildTxt } from '../lib/ocr/text-export'
import { buildPdf, QUALITY } from '../lib/pdf/export'
import type { Orientation, PageSize } from '../lib/pdf/layout'
import { describeRange, parseRanges } from '../lib/pdf/ranges'
import { renderPageFlattened } from '../lib/render'
import { canShareFiles, downloadFiles, mailtoHref, shareFiles } from '../lib/share'
import { saveExport } from '../lib/storage/repository'
import { uid } from '../lib/uid'
import type { Page, Quality, ScanDocument } from '../types'

type Format = 'pdf' | 'jpeg' | 'png' | 'txt' | 'docx'
type Scope = 'all' | 'selected' | 'ranges'

interface Props {
  doc: ScanDocument
  selectedIds: string[]
  thumbUrl: string | undefined
  onClose: () => void
  onExported: () => void
}

const FORMATS: { id: Format; label: string }[] = [
  { id: 'pdf', label: 'PDF' },
  { id: 'jpeg', label: 'JPG' },
  { id: 'png', label: 'PNG' },
  { id: 'txt', label: 'TXT' },
  { id: 'docx', label: 'DOCX' },
]

export default function ExportDialog({ doc, selectedIds, thumbUrl, onClose, onExported }: Props) {
  const dialogs = useDialogs()
  const [format, setFormat] = useState<Format>('pdf')
  const [scope, setScope] = useState<Scope>(selectedIds.length ? 'selected' : 'all')
  const [ranges, setRanges] = useState('')
  const [split, setSplit] = useState(false)
  const [name, setName] = useState(doc.name)
  const [pageSize, setPageSize] = useState<PageSize>('a4')
  const [orientation, setOrientation] = useState<Orientation>('auto')
  const [quality, setQuality] = useState<Quality>('medium')
  const [textLayer, setTextLayer] = useState(true)
  const [annotations, setAnnotations] = useState(true)
  const [watermark, setWatermark] = useState(doc.watermark.enabled)
  const [rasterize, setRasterize] = useState(false)
  const [protect, setProtect] = useState(false)
  const [password, setPassword] = useState('')
  const [password2, setPassword2] = useState('')
  const [progress, setProgress] = useState<{ label: string; value: number } | null>(null)
  const [result, setResult] = useState<{ files: File[]; password: string } | null>(null)
  const [saved, setSaved] = useState(false)
  const [previewing, setPreviewing] = useState<File | null>(null)
  const [PdfPreview, setPdfPreview] = useState<typeof import('./PdfPreview').default | null>(null)

  const pages = doc.pages
  const hasOcr = pages.some((p) => p.ocr?.words.length)
  const hasPdfPages = pages.some((p) => p.kind === 'pdf')
  const hasMarks = pages.some((p) => p.annotations.length)
  const baseName = sanitizeFileName(name, doc.name)

  /** Groups of pages to export (several groups = split into several files). */
  const groups = useMemo((): { pages: Page[]; error?: string } [] => {
    try {
      if (scope === 'selected') return [{ pages: pages.filter((p) => selectedIds.includes(p.id)) }]
      if (scope === 'ranges') {
        const g = parseRanges(ranges, pages.length).map((idx) => ({ pages: idx.map((i) => pages[i]) }))
        return split && format === 'pdf' ? g : [{ pages: g.flatMap((x) => x.pages) }]
      }
      return [{ pages }]
    } catch (e) {
      return [{ pages: [], error: e instanceof Error ? e.message : 'Invalid range' }]
    }
  }, [scope, ranges, split, format, pages, selectedIds])

  const rangeError = groups[0]?.error
  const pageCount = groups.reduce((n, g) => n + g.pages.length, 0)
  const pwError = protect && (password.length < 4 ? 'Use at least 4 characters' : password !== password2 ? 'Passwords do not match' : null)

  const invalidate = () => {
    setResult(null)
    setSaved(false)
  }

  const generate = async () => {
    if (!pageCount || rangeError || pwError) return
    invalidate()
    const files: File[] = []
    try {
      if (format === 'pdf') {
        for (const [gi, g] of groups.entries()) {
          const label = groups.length > 1 ? `File ${gi + 1} of ${groups.length}: ` : ''
          const bytes = await buildPdf(
            g.pages,
            {
              pageSize,
              orientation,
              quality,
              textLayer: textLayer && hasOcr,
              annotations,
              watermark: watermark ? doc.watermark : null,
              rasterizePdfPages: rasterize,
              password: protect ? password : '',
              title: baseName,
            },
            (done, total) => setProgress({ label: `${label}page ${Math.min(done + 1, total)} of ${total}`, value: (gi + done / total) / groups.length }),
          )
          const suffix = groups.length > 1 ? `_p${describeRange(g.pages.map((p) => pages.indexOf(p)))}` : ''
          files.push(new File([bytes as BlobPart], `${baseName}${suffix}.pdf`, { type: 'application/pdf' }))
        }
      } else if (format === 'jpeg' || format === 'png') {
        const list = groups[0].pages
        const q = QUALITY[quality]
        for (const [i, p] of list.entries()) {
          setProgress({ label: `Page ${i + 1} of ${list.length}`, value: i / list.length })
          const img = await renderPageFlattened(p, watermark ? doc.watermark : null, {
            maxSide: q.maxSide,
            type: format === 'png' ? 'image/png' : 'image/jpeg',
            quality: q.jpeg,
          })
          const suffix = list.length > 1 ? `_${String(pages.indexOf(p) + 1).padStart(2, '0')}` : ''
          files.push(new File([img.blob], `${baseName}${suffix}.${format === 'png' ? 'png' : 'jpg'}`, { type: img.blob.type }))
        }
      } else {
        const list = groups[0].pages
        if (!list.some((p) => p.ocr)) {
          dialogs.toast('No recognised text yet — run OCR first (OCR tab).', 'error')
          return
        }
        setProgress({ label: 'Creating document…', value: 0.5 })
        files.push(format === 'txt' ? buildTxt(list, baseName) : await buildDocx(list, baseName))
      }
      setResult({ files, password: protect ? password : '' })
    } catch (e) {
      console.error(e)
      dialogs.toast(e instanceof Error ? `Export failed: ${e.message}` : 'Export failed', 'error')
    } finally {
      setProgress(null)
    }
  }

  const total = result?.files.reduce((s, f) => s + f.size, 0) ?? 0
  const shareable = !!result && canShareFiles(result.files)

  const remember = async () => {
    if (!result || saved) return
    setSaved(true)
    onExported()
    try {
      const thumb = thumbUrl ? await (await fetch(thumbUrl)).blob() : new Blob()
      await saveExport({
        id: uid(),
        name: baseName,
        createdAt: Date.now(),
        pageCount,
        format,
        thumb,
        files: result.files.map((f) => ({ name: f.name, type: f.type, blob: f })),
        size: total,
      })
    } catch (e) {
      console.warn('Could not save to export history', e)
    }
  }

  const share = () => {
    if (!result) return
    // share() must run synchronously inside the tap (iOS), so files were generated beforehand.
    const p = shareFiles(result.files, baseName)
    void remember()
    p.catch(() => dialogs.toast('Sharing failed — use Download instead.', 'error'))
  }

  const download = () => {
    if (!result) return
    void downloadFiles(result.files)
    void remember()
    dialogs.toast(result.files.length > 1 ? `Downloading ${result.files.length} files…` : 'Download started', 'success')
  }

  const preview = async (f: File) => {
    if (!PdfPreview) {
      const m = await import('./PdfPreview')
      setPdfPreview(() => m.default)
    }
    setPreviewing(f)
  }

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-slate-900">
      <header className="flex h-[calc(env(safe-area-inset-top)+3.5rem)] shrink-0 items-end border-b border-white/5 px-2 pb-1">
        <div className="flex h-12 w-full items-center gap-2">
          <button className="btn-ghost" onClick={onClose}>
            Close
          </button>
          <h1 className="flex-1 text-center text-lg font-semibold">Export</h1>
          <span className="w-16" />
        </div>
      </header>
      <main className="mx-auto w-full max-w-xl flex-1 space-y-5 overflow-y-auto px-4 pt-4 pb-[calc(env(safe-area-inset-bottom)+2rem)]">
        <label className="block">
          <span className="mb-1.5 block text-sm font-medium text-slate-300">File name</span>
          <input className="field" value={name} onChange={(e) => (setName(e.target.value), invalidate())} onBlur={() => setName(baseName)} autoComplete="off" spellCheck={false} />
        </label>

        <div>
          <SectionTitle>Format</SectionTitle>
          <Segmented label="Format" value={format} options={FORMATS} onChange={(f) => (setFormat(f), invalidate())} />
          <p className="mt-1.5 text-xs text-slate-500">
            {format === 'pdf'
              ? 'One PDF with all chosen pages (or several files when splitting).'
              : format === 'txt' || format === 'docx'
                ? 'Recognised (OCR) text of the chosen pages.'
                : 'One image per page, with marks and watermark burned in.'}
          </p>
        </div>

        <div>
          <SectionTitle>Pages</SectionTitle>
          <Segmented
            label="Pages"
            value={scope}
            onChange={(s) => (setScope(s), invalidate())}
            options={[
              { id: 'all', label: `All (${pages.length})` },
              { id: 'selected', label: `Selected (${selectedIds.length})`, disabled: !selectedIds.length },
              { id: 'ranges', label: 'Ranges' },
            ]}
          />
          {scope === 'ranges' && (
            <div className="mt-2 space-y-1">
              <input className="field" placeholder="e.g. 1-3, 5, 8-" value={ranges} onChange={(e) => (setRanges(e.target.value), invalidate())} aria-label="Page ranges" inputMode="numeric" />
              {rangeError && ranges && <p className="text-xs text-red-300">{rangeError}</p>}
              {format === 'pdf' && <Toggle checked={split} onChange={(v) => (setSplit(v), invalidate())} label="Split: one PDF per range" hint="Otherwise the ranges are joined into one PDF" />}
            </div>
          )}
        </div>

        {(format === 'pdf' || format === 'jpeg') && (
          <div>
            <SectionTitle>Quality / file size</SectionTitle>
            <Segmented label="Quality" value={quality} onChange={(q) => (setQuality(q), invalidate())} options={(Object.keys(QUALITY) as Quality[]).map((id) => ({ id, label: QUALITY[id].label }))} />
            <p className="mt-1.5 text-xs text-slate-500">{QUALITY[quality].hint} · JPEG compression for scanned pages</p>
          </div>
        )}

        {format === 'pdf' && (
          <>
            <div className="grid grid-cols-2 gap-3">
              <label className="block">
                <span className="mb-1.5 block text-sm text-slate-300">Page size</span>
                <select className="field" value={pageSize} onChange={(e) => (setPageSize(e.target.value as PageSize), invalidate())}>
                  <option value="a4">A4</option>
                  <option value="a5">A5</option>
                  <option value="letter">Letter</option>
                  <option value="auto">Auto (fit image)</option>
                </select>
              </label>
              <label className="block">
                <span className="mb-1.5 block text-sm text-slate-300">Orientation</span>
                <select className="field" value={orientation} onChange={(e) => (setOrientation(e.target.value as Orientation), invalidate())}>
                  <option value="auto">Auto</option>
                  <option value="portrait">Portrait</option>
                  <option value="landscape">Landscape</option>
                </select>
              </label>
            </div>
            {hasPdfPages && !rasterize && <p className="-mt-3 text-xs text-slate-500">Pages from imported PDFs keep their original size, text and vector content.</p>}

            <div className="rounded-xl bg-slate-800/60 px-3 py-1 ring-1 ring-white/5">
              <Toggle checked={textLayer && hasOcr} onChange={(v) => (setTextLayer(v), invalidate())} label="Searchable text (OCR layer)" hint={hasOcr ? 'Invisible text over scans so you can search, select and copy' : 'Run OCR first to enable this'} />
              <Toggle checked={annotations} onChange={(v) => (setAnnotations(v), invalidate())} label="Include marks & signatures" hint={hasMarks ? undefined : 'No marks in this document'} />
              <Toggle checked={watermark} onChange={(v) => (setWatermark(v), invalidate())} label="Watermark" hint={doc.watermark.text ? `“${doc.watermark.text}” — edit in the Annotate tab` : undefined} />
              {hasPdfPages && (
                <Toggle checked={rasterize} onChange={(v) => (setRasterize(v), invalidate())} label="Convert PDF pages to images" hint="Re-encodes imported pages as JPEG at the chosen quality. Shrinks PDFs made of large images; text/vector pages lose selectable text and can get bigger" />
              )}
              <Toggle checked={protect} onChange={(v) => (setProtect(v), invalidate())} label="Protect with password" hint="AES-256 encryption; the password is needed to open the PDF" />
              {protect && (
                <div className="space-y-2 pb-3">
                  <input className="field" type="password" placeholder="Password" value={password} onChange={(e) => (setPassword(e.target.value), invalidate())} autoComplete="new-password" />
                  <input className="field" type="password" placeholder="Repeat password" value={password2} onChange={(e) => (setPassword2(e.target.value), invalidate())} autoComplete="new-password" />
                  {pwError && (password || password2) && <p className="text-xs text-red-300">{pwError}</p>}
                  <p className="text-xs text-slate-500">The password is not stored anywhere. If you forget it, the file cannot be opened.</p>
                </div>
              )}
            </div>
          </>
        )}

        {progress ? (
          <div className="rounded-2xl bg-slate-800 p-4">
            <ProgressBar value={progress.value} label={progress.label} />
          </div>
        ) : !result ? (
          <button className="btn-primary w-full" onClick={() => void generate()} disabled={!pageCount || !!rangeError || !!pwError}>
            {protect && <LockIcon width={18} />}
            Create {format.toUpperCase()} · {pageCount} page{pageCount === 1 ? '' : 's'}
          </button>
        ) : (
          <div className="space-y-3">
            <div className="rounded-2xl bg-slate-800/70 p-3 ring-1 ring-white/5">
              <ul className="space-y-1 text-sm">
                {result.files.map((f) => (
                  <li key={f.name} className="flex items-center gap-2">
                    <span className="min-w-0 flex-1 truncate">{f.name}</span>
                    <span className="text-slate-400 tabular-nums">{formatBytes(f.size)}</span>
                    {f.type === 'application/pdf' && (
                      <button className="icon-btn size-9" onClick={() => void preview(f)} aria-label={`Preview ${f.name}`}>
                        <EyeIcon width={18} />
                      </button>
                    )}
                  </li>
                ))}
              </ul>
              {result.files.length > 1 && <p className="mt-2 border-t border-white/5 pt-2 text-xs text-slate-400">Total {formatBytes(total)}</p>}
            </div>
            {shareable && (
              <button className="btn-primary w-full" onClick={share}>
                <ShareIcon />
                Share
              </button>
            )}
            <button className={`${shareable ? 'btn-secondary' : 'btn-primary'} w-full`} onClick={download}>
              <DownloadIcon />
              Download
            </button>
            {!shareable && (
              <>
                <a className="btn-secondary w-full" href={mailtoHref(baseName, result.files.map((f) => f.name))} onClick={() => void remember()}>
                  <MailIcon />
                  Send by email
                </a>
                <p className="rounded-xl bg-amber-400/10 p-3 text-xs leading-relaxed text-amber-200 ring-1 ring-amber-400/20">
                  This browser can’t share files directly. Tap <b>Download</b> first, then <b>Send by email</b> and attach the downloaded file
                  {result.files.length > 1 ? 's' : ''}.
                </p>
              </>
            )}
            <button className="btn-ghost w-full text-sm" onClick={invalidate}>
              Change options
            </button>
          </div>
        )}
      </main>
      {previewing && PdfPreview && <PdfPreview file={previewing} password={result?.password} onClose={() => setPreviewing(null)} />}
    </div>
  )
}
