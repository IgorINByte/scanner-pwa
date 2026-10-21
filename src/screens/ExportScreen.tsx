import { useEffect, useMemo, useState } from 'react'
import { DocIcon, DownloadIcon, ImageIcon, MailIcon, ShareIcon } from '../components/Icons'
import { Header, Segmented, Spinner } from '../components/ui'
import { saveScan } from '../lib/db'
import { buildExport, defaultFileName, formatBytes, QUALITY, sanitizeFileName } from '../lib/export'
import { pageKey } from '../lib/render'
import { canShareFiles, downloadFiles, mailtoHref, shareFiles } from '../lib/share'
import { uid } from '../lib/usePages'
import type { ExportFormat, Page, Quality } from '../types'

interface Props {
  pages: Page[]
  onBack: () => void
  onFinish: () => void
}

const FORMATS: { id: ExportFormat; label: string }[] = [
  { id: 'pdf', label: 'PDF' },
  { id: 'jpeg', label: 'JPEG' },
  { id: 'png', label: 'PNG' },
]

const QUALITIES = (Object.keys(QUALITY) as Quality[]).map((id) => ({ id, label: QUALITY[id].label }))

export default function ExportScreen({ pages, onBack, onFinish }: Props) {
  const [name, setName] = useState(defaultFileName)
  const [format, setFormat] = useState<ExportFormat>('pdf')
  const [quality, setQuality] = useState<Quality>('medium')
  const [output, setOutput] = useState<{ key: string; files: File[] } | null>(null)
  const [progress, setProgress] = useState<[number, number]>([0, pages.length])
  const [error, setError] = useState('')
  const [savedKey, setSavedKey] = useState('')
  const [notice, setNotice] = useState('')

  const ready = pages.every((p) => p.corners)
  const renderKey = JSON.stringify([pages.map((p) => [p.id, pageKey(p)]), format, quality])

  // Files are generated ahead of time: iOS only allows navigator.share() synchronously inside a tap.
  useEffect(() => {
    if (!ready) return
    let cancelled = false
    setError('')
    setOutput(null)
    buildExport(pages, format, quality, 'scan', (done, total) => !cancelled && setProgress([done, total]))
      .then((files) => !cancelled && setOutput({ key: renderKey, files }))
      .catch((e) => {
        console.error(e)
        if (!cancelled) setError('Export failed. Try a lower quality.')
      })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [renderKey, ready])

  const baseName = sanitizeFileName(name)
  // Renaming is free: only the File wrappers change, not the rendered content.
  const files = useMemo(() => {
    if (!output) return []
    return output.files.map((f) => {
      const ext = f.name.slice(f.name.indexOf('.'))
      const suffix = f.name.slice('scan'.length, f.name.indexOf('.'))
      return new File([f], `${baseName}${suffix}${ext}`, { type: f.type })
    })
  }, [output, baseName])

  const shareable = files.length > 0 && canShareFiles(files)
  const totalSize = files.reduce((s, f) => s + f.size, 0)
  const historyKey = `${output?.key}|${baseName}`

  const saveToHistory = async () => {
    if (savedKey === historyKey || !files.length) return
    setSavedKey(historyKey)
    try {
      const thumb = pages[0].thumbUrl ? await (await fetch(pages[0].thumbUrl)).blob() : files[0]
      await saveScan({
        id: uid(),
        name: baseName,
        createdAt: Date.now(),
        pageCount: pages.length,
        format,
        thumb,
        files: files.map((f) => ({ name: f.name, type: f.type, blob: f })),
        size: totalSize,
      })
    } catch (e) {
      console.warn('Could not save to history', e)
    }
  }

  const share = () => {
    // share() must be the first thing that happens in the tap handler.
    const sharing = shareFiles(files, baseName)
    void saveToHistory()
    sharing
      .then((ok) => ok && setNotice('Shared'))
      .catch((e) => {
        console.warn('Share failed', e)
        setNotice('Sharing failed — use Download instead.')
      })
  }

  const download = () => {
    void downloadFiles(files)
    void saveToHistory()
    setNotice(files.length > 1 ? `Downloading ${files.length} files…` : 'Downloaded')
  }

  const finish = () => {
    if (savedKey || confirm('Leave without exporting? The scan will be discarded.')) onFinish()
  }

  const [done, total] = progress

  return (
    <div className="flex min-h-dvh flex-col">
      <Header
        title="Export"
        onBack={onBack}
        right={
          <button className="btn-ghost px-3 text-sm font-semibold text-cyan-400" onClick={finish}>
            Finish
          </button>
        }
      />
      <main className="mx-auto w-full max-w-xl flex-1 space-y-6 px-4 pt-2 pb-[calc(env(safe-area-inset-bottom)+2rem)]">
        <div className="flex gap-2 overflow-x-auto pb-1">
          {pages.map((p, i) => (
            <img
              key={p.id}
              src={p.thumbUrl}
              alt={`Page ${i + 1}`}
              className="h-24 w-auto shrink-0 rounded-md bg-slate-800 ring-1 ring-white/10"
            />
          ))}
        </div>

        <label className="block">
          <span className="mb-1.5 block text-sm font-medium text-slate-300">File name</span>
          <div className="flex items-center rounded-xl bg-slate-800 ring-1 ring-white/10 focus-within:ring-2 focus-within:ring-cyan-400">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              onBlur={() => setName(baseName)}
              className="min-w-0 flex-1 bg-transparent px-3 py-3 text-base outline-none"
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
              enterKeyHint="done"
            />
            <span className="pr-3 text-slate-500">.{format === 'jpeg' ? 'jpg' : format}</span>
          </div>
        </label>

        <div>
          <span className="mb-1.5 block text-sm font-medium text-slate-300">Format</span>
          <Segmented value={format} options={FORMATS} onChange={setFormat} />
          <p className="mt-1.5 text-xs text-slate-500">
            {format === 'pdf'
              ? `All ${pages.length} page${pages.length === 1 ? '' : 's'} in one A4 PDF`
              : `${pages.length} separate image${pages.length === 1 ? '' : 's'}`}
          </p>
        </div>

        {format !== 'png' && (
          <div>
            <span className="mb-1.5 block text-sm font-medium text-slate-300">Quality</span>
            <Segmented value={quality} options={QUALITIES} onChange={setQuality} />
          </div>
        )}

        <div className="rounded-2xl bg-slate-800/60 p-4 ring-1 ring-white/5">
          {error ? (
            <p className="text-sm text-red-400">{error}</p>
          ) : !output ? (
            <div className="flex items-center gap-3 text-sm text-slate-300">
              <Spinner className="size-5 text-cyan-400" />
              {ready ? `Preparing page ${Math.min(done + 1, total)} of ${total}…` : 'Processing pages…'}
            </div>
          ) : (
            <div className="flex items-center gap-3 text-sm">
              {format === 'pdf' ? <DocIcon className="text-cyan-400" /> : <ImageIcon className="text-cyan-400" />}
              <div className="min-w-0 flex-1">
                <div className="truncate font-medium">
                  {files.length === 1 ? files[0].name : `${files.length} files`}
                </div>
                <div className="text-slate-400">{formatBytes(totalSize)}</div>
              </div>
            </div>
          )}
        </div>

        <div className="space-y-3">
          {shareable && (
            <button className="btn-primary w-full" disabled={!output} onClick={share}>
              <ShareIcon />
              Share
            </button>
          )}
          <button className={`${shareable ? 'btn-secondary' : 'btn-primary'} w-full`} disabled={!output} onClick={download}>
            <DownloadIcon />
            Download
          </button>
          {!shareable && output && (
            <>
              <a className="btn-secondary w-full" href={mailtoHref(baseName, files.map((f) => f.name))} onClick={() => void saveToHistory()}>
                <MailIcon />
                Send by email
              </a>
              <p className="rounded-xl bg-amber-400/10 p-3 text-xs leading-relaxed text-amber-200 ring-1 ring-amber-400/20">
                Your browser can’t share files directly. Tap <b>Download</b> first, then <b>Send by email</b> and
                attach the downloaded file{files.length > 1 ? 's' : ''} from your Downloads folder.
              </p>
            </>
          )}
          {notice && <p className="text-center text-sm text-slate-400">{notice}</p>}
        </div>
      </main>
    </div>
  )
}
