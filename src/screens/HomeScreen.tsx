import { useEffect, useState } from 'react'
import { CameraIcon, DocIcon, DownloadIcon, ImageIcon, ShareIcon, TrashIcon } from '../components/Icons'
import { Segmented, useFilePicker } from '../components/ui'
import { deleteScan, HISTORY_LIMIT, listScans, toFiles, type ScanRecord } from '../lib/db'
import { formatBytes } from '../lib/export'
import { canShareFiles, downloadFiles, shareFiles } from '../lib/share'
import type { ScanMode } from '../types'

interface Props {
  mode: ScanMode
  onModeChange: (m: ScanMode) => void
  currentPages: number
  onScan: () => void
  onImport: (files: File[]) => void
  onContinue: () => void
  onDiscard: () => void
}

export default function HomeScreen({ mode, onModeChange, currentPages, onScan, onImport, onContinue, onDiscard }: Props) {
  const gallery = useFilePicker(onImport, { multiple: true })

  return (
    <div className="mx-auto flex min-h-dvh max-w-xl flex-col px-4 pt-[calc(env(safe-area-inset-top)+1.25rem)] pb-[calc(env(safe-area-inset-bottom)+1.5rem)]">
      {gallery.input}
      <div className="mb-6 flex items-center gap-3">
        <img src={`${import.meta.env.BASE_URL}favicon.svg`} alt="" className="size-10" />
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Scanner</h1>
          <p className="text-sm text-slate-400">Everything stays on your device</p>
        </div>
      </div>

      {currentPages > 0 && (
        <div className="mb-4 flex items-center gap-3 rounded-2xl bg-cyan-500/10 p-3 ring-1 ring-cyan-400/30">
          <div className="flex-1 text-sm">
            <div className="font-semibold text-cyan-200">Scan in progress</div>
            <div className="text-slate-400">
              {currentPages} page{currentPages === 1 ? '' : 's'}, not exported yet
            </div>
          </div>
          <button className="btn-ghost text-sm" onClick={onDiscard}>
            Discard
          </button>
          <button className="btn-primary px-4 py-2 text-sm" onClick={onContinue}>
            Continue
          </button>
        </div>
      )}

      <div className="space-y-3">
        <Segmented
          value={mode}
          onChange={onModeChange}
          options={[
            { id: 'single', label: 'Single page' },
            { id: 'multi', label: 'Multi-page' },
          ]}
        />
        <button className="btn-primary w-full py-5 text-lg" onClick={onScan}>
          <CameraIcon width={26} height={26} />
          Scan document
        </button>
        <button className="btn-secondary w-full" onClick={gallery.open}>
          <ImageIcon />
          Import from gallery
        </button>
      </div>

      <History />
    </div>
  )
}

function History() {
  const [scans, setScans] = useState<ScanRecord[] | null>(null)
  const [thumbs, setThumbs] = useState<Record<string, string>>({})

  useEffect(() => {
    listScans()
      .then(setScans)
      .catch((e) => {
        console.warn('History unavailable', e)
        setScans([])
      })
  }, [])

  useEffect(() => {
    if (!scans) return
    const urls = Object.fromEntries(scans.map((s) => [s.id, URL.createObjectURL(s.thumb)]))
    setThumbs(urls)
    return () => Object.values(urls).forEach(URL.revokeObjectURL)
  }, [scans])

  const remove = async (s: ScanRecord) => {
    if (!confirm(`Delete “${s.name}” from history?`)) return
    await deleteScan(s.id)
    setScans((list) => list?.filter((x) => x.id !== s.id) ?? null)
  }

  const share = async (s: ScanRecord) => {
    const files = toFiles(s)
    try {
      await shareFiles(files, s.name)
    } catch (e) {
      console.warn('Share failed', e)
      await downloadFiles(files)
    }
  }

  return (
    <section className="mt-8">
      <h2 className="mb-3 flex items-baseline justify-between text-sm font-semibold uppercase tracking-wider text-slate-400">
        Recent scans
        <span className="text-xs font-normal normal-case tracking-normal text-slate-500">
          last {HISTORY_LIMIT} kept
        </span>
      </h2>
      {scans === null ? null : scans.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-700 px-4 py-10 text-center text-sm text-slate-500">
          <DocIcon className="mx-auto mb-2 size-8 text-slate-600" />
          Your exported scans will appear here.
        </div>
      ) : (
        <ul className="space-y-2">
          {scans.map((s) => {
            const shareable = canShareFiles(toFiles(s))
            return (
              <li key={s.id} className="flex items-center gap-3 rounded-2xl bg-slate-800/70 p-2 pr-1">
                <img
                  src={thumbs[s.id]}
                  alt=""
                  className="h-16 w-12 shrink-0 rounded-md bg-white object-cover ring-1 ring-white/10"
                />
                <div className="min-w-0 flex-1">
                  <div className="truncate font-medium">{s.name}</div>
                  <div className="text-xs text-slate-400">
                    {new Date(s.createdAt).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}
                  </div>
                  <div className="text-xs text-slate-500">
                    {s.pageCount} page{s.pageCount === 1 ? '' : 's'} · {s.format.toUpperCase()} · {formatBytes(s.size)}
                  </div>
                </div>
                <button
                  className="icon-btn"
                  aria-label={shareable ? 'Share' : 'Download'}
                  onClick={() => void (shareable ? share(s) : downloadFiles(toFiles(s)))}
                >
                  {shareable ? <ShareIcon /> : <DownloadIcon />}
                </button>
                <button className="icon-btn text-slate-400" aria-label="Delete" onClick={() => void remove(s)}>
                  <TrashIcon />
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}
