import { useCallback, useEffect, useMemo, useState } from 'react'
import type { Nav } from '../App'
import { Modal, useDialogs } from '../components/dialogs'
import {
  CameraIcon,
  DocIcon,
  DownloadIcon,
  FolderIcon,
  ImageIcon,
  MoreIcon,
  PdfIcon,
  PlusIcon,
  SearchIcon,
  SettingsIcon,
  ShareIcon,
  TrashIcon,
} from '../components/Icons'
import { ProgressBar, Segmented, SectionTitle, useFilePicker } from '../components/ui'
import { importImages, importPdf, newDocument, type ImportIssue } from '../lib/document/import'
import { formatBytes, IMAGE_ACCEPT, PDF_ACCEPT, sanitizeFileName } from '../lib/files'
import { buildPdf } from '../lib/pdf/export'
import { canShareFiles, downloadFiles, shareFiles } from '../lib/share'
import {
  deleteAllData,
  deleteExport,
  EXPORT_HISTORY_LIMIT,
  exportFiles,
  listExports,
  repository,
  storageEstimate,
  type DocumentRecord,
  type ExportRecord,
} from '../lib/storage/repository'
import { uid } from '../lib/uid'
import type { DocumentKind, Folder, ScanMode } from '../types'

interface Props {
  nav: Nav
  mode: ScanMode
  onModeChange: (m: ScanMode) => void
}

type DateFilter = 'any' | 'today' | 'week' | 'month' | 'year'
type KindFilter = 'all' | DocumentKind

const DATE_FILTERS: { id: DateFilter; label: string; ms: number }[] = [
  { id: 'any', label: 'Any time', ms: Infinity },
  { id: 'today', label: 'Today', ms: 0 },
  { id: 'week', label: 'Last 7 days', ms: 7 * 864e5 },
  { id: 'month', label: 'Last 30 days', ms: 30 * 864e5 },
  { id: 'year', label: 'Last year', ms: 365 * 864e5 },
]

const KIND_LABEL: Record<DocumentKind, string> = { scan: 'Scan', pdf: 'PDF', mixed: 'Mixed', empty: 'Empty' }

export default function LibraryScreen({ nav, mode, onModeChange }: Props) {
  const dialogs = useDialogs()
  const [docs, setDocs] = useState<DocumentRecord[] | null>(null)
  const [folders, setFolders] = useState<Folder[]>([])
  const [query, setQuery] = useState('')
  const [folder, setFolder] = useState<string | 'all' | 'none'>('all')
  const [kind, setKind] = useState<KindFilter>('all')
  const [date, setDate] = useState<DateFilter>('any')
  const [busy, setBusy] = useState<{ label: string; progress: number } | null>(null)
  const [issues, setIssues] = useState<{ list: ImportIssue[]; retry: () => void } | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)

  const reload = useCallback(async () => {
    try {
      const [d, f] = await Promise.all([repository.listDocuments(), repository.listFolders()])
      // Empty documents left behind (e.g. camera closed without a photo) are cleaned up.
      const empty = d.filter((x) => x.pageCount === 0 && Date.now() - x.updatedAt > 60_000)
      await Promise.all(empty.map((x) => repository.deleteDocument(x.id)))
      setDocs(d.filter((x) => !empty.includes(x)))
      setFolders(f)
    } catch (e) {
      console.error(e)
      setDocs([])
      dialogs.toast('Could not read saved documents (storage unavailable).', 'error')
    }
  }, [dialogs])

  useEffect(() => {
    void reload()
  }, [reload])

  const askPassword = (file: string, incorrect: boolean) =>
    dialogs.prompt({
      title: incorrect ? 'Wrong password' : 'Password required',
      message: `“${file}” is password protected. Enter its password to open it.`,
      type: 'password',
      confirmLabel: 'Open',
    })

  /** Creates a document from files and opens it in the editor. */
  const importInto = async (files: File[], type: 'images' | 'pdf', retry: () => void) => {
    const doc = newDocument()
    const issues: ImportIssue[] = []
    try {
      if (type === 'images') {
        const res = await importImages(doc.id, files, (done, total, name) =>
          setBusy({ label: name ? `Importing ${name}` : 'Finishing…', progress: done / total }),
        )
        doc.pages.push(...res.pages)
        issues.push(...res.issues)
      } else {
        for (const [i, f] of files.entries()) {
          setBusy({ label: `Opening ${f.name}`, progress: i / files.length })
          try {
            doc.pages.push(...(await importPdf(doc.id, f, askPassword)))
          } catch (e) {
            issues.push({ file: f.name, message: e instanceof Error ? e.message : 'Could not open the PDF.' })
          }
        }
        if (files.length === 1 && doc.pages.length) doc.name = sanitizeFileName(files[0].name, doc.name)
      }
    } finally {
      setBusy(null)
    }
    if (!doc.pages.length) {
      await repository.deleteDocument(doc.id)
      if (issues.length) setIssues({ list: issues, retry })
      return
    }
    // The editor opens next, so report skipped files with a (global) toast instead of the dialog.
    if (issues.length)
      dialogs.toast(
        `${issues.length} file${issues.length === 1 ? ' was' : 's were'} skipped: ${issues.map((i) => `${i.file} — ${i.message}`).join('; ')}`,
        'error',
      )
    await repository.saveDocument(doc, null)
    nav.go({ name: 'editor', docId: doc.id, overlay: null, startTab: type === 'pdf' ? 'pages' : mode === 'single' && doc.pages.length === 1 ? 'crop' : 'pages' })
  }

  const photos = useFilePicker((f) => void importInto(f, 'images', photos.open), { multiple: true, accept: IMAGE_ACCEPT })
  const pdfs = useFilePicker((f) => void importInto(f, 'pdf', pdfs.open), { multiple: true, accept: PDF_ACCEPT })

  const scan = async () => {
    const doc = newDocument()
    await repository.saveDocument(doc, null)
    // Editor first, camera on top: closing the camera returns to the (possibly empty) editor.
    nav.go({ name: 'editor', docId: doc.id, overlay: null, startTab: 'pages' })
    nav.go({ name: 'editor', docId: doc.id, overlay: 'camera', startTab: 'pages' })
  }

  const filtered = useMemo(() => {
    if (!docs) return []
    const q = query.trim().toLowerCase()
    const df = DATE_FILTERS.find((d) => d.id === date)!
    const startOfToday = new Date().setHours(0, 0, 0, 0)
    return docs.filter((d) => {
      if (folder === 'none' && d.folderId) return false
      if (folder !== 'all' && folder !== 'none' && d.folderId !== folder) return false
      if (kind !== 'all' && d.kind !== kind) return false
      if (date === 'today' && d.updatedAt < startOfToday) return false
      if (date !== 'any' && date !== 'today' && Date.now() - d.updatedAt > df.ms) return false
      return !q || q.split(/\s+/).every((t) => d.searchText.includes(t))
    })
  }, [docs, query, folder, kind, date])

  // ---------------------------------------------------------------- folder / doc actions

  const newFolder = async () => {
    const name = (await dialogs.prompt({ title: 'New folder', label: 'Folder name', confirmLabel: 'Create' }))?.trim()
    if (!name) return
    const f = { id: uid(), name: name.slice(0, 60), createdAt: Date.now() }
    await repository.saveFolder(f)
    setFolders((list) => [...list, f].sort((a, b) => a.name.localeCompare(b.name)))
    setFolder(f.id)
  }

  const folderMenu = async (f: Folder) => {
    const action = await dialogs.choose({
      title: f.name,
      options: [
        { value: 'rename', label: 'Rename folder' },
        { value: 'delete', label: 'Delete folder (keeps documents)' },
      ],
    })
    if (action === 'rename') {
      const name = (await dialogs.prompt({ title: 'Rename folder', initial: f.name, confirmLabel: 'Rename' }))?.trim()
      if (!name) return
      await repository.saveFolder({ ...f, name: name.slice(0, 60) })
    } else if (action === 'delete') {
      if (!(await dialogs.confirm({ title: `Delete folder “${f.name}”?`, message: 'Documents in it are kept and moved to “No folder”.', confirmLabel: 'Delete', danger: true })))
        return
      await repository.deleteFolder(f.id)
      setFolder('all')
    }
    await reload()
  }

  const docMenu = async (d: DocumentRecord) => {
    const action = await dialogs.choose({
      title: d.name,
      options: [
        { value: 'open', label: 'Open' },
        { value: 'rename', label: 'Rename' },
        { value: 'move', label: 'Move to folder' },
        { value: 'download', label: 'Download as PDF' },
        { value: 'delete', label: 'Delete' },
      ],
    })
    if (action === 'open') nav.go({ name: 'editor', docId: d.id, overlay: null })
    else if (action === 'rename') {
      const name = await dialogs.prompt({ title: 'Rename document', initial: d.name, confirmLabel: 'Rename' })
      if (name?.trim()) {
        await repository.saveDocument({ ...stripRecord(d), name: sanitizeFileName(name, d.name), updatedAt: Date.now() })
        await reload()
      }
    } else if (action === 'move') {
      const target = await dialogs.choose<string>({
        title: 'Move to folder',
        options: [{ value: '', label: 'No folder' }, ...folders.map((f) => ({ value: f.id, label: f.name }))],
      })
      if (target === null) return
      await repository.saveDocument({ ...stripRecord(d), folderId: target || null })
      await reload()
    } else if (action === 'download') {
      setBusy({ label: 'Creating PDF…', progress: 0 })
      try {
        const bytes = await buildPdf(
          d.pages,
          {
            pageSize: 'a4',
            orientation: 'auto',
            quality: 'medium',
            textLayer: true,
            annotations: true,
            watermark: d.watermark,
            rasterizePdfPages: false,
            password: '',
            title: d.name,
          },
          (done, total) => setBusy({ label: `Creating PDF… page ${Math.min(done + 1, total)} of ${total}`, progress: done / total }),
        )
        await downloadFiles([new File([bytes as BlobPart], `${d.name}.pdf`, { type: 'application/pdf' })])
      } catch (e) {
        console.error(e)
        dialogs.toast('Could not create the PDF.', 'error')
      } finally {
        setBusy(null)
      }
    } else if (action === 'delete') {
      if (await dialogs.confirm({ title: `Delete “${d.name}”?`, message: 'The document and all its pages are permanently removed from this device.', confirmLabel: 'Delete', danger: true })) {
        await repository.deleteDocument(d.id)
        dialogs.toast('Document deleted', 'success')
        await reload()
      }
    }
  }

  return (
    <div className="mx-auto flex min-h-dvh max-w-5xl flex-col px-4 pt-[calc(env(safe-area-inset-top)+1.25rem)] pb-[calc(env(safe-area-inset-bottom)+1.5rem)]">
      {photos.input}
      {pdfs.input}
      <header className="mb-6 flex items-center gap-3">
        <img src={`${import.meta.env.BASE_URL}favicon.svg`} alt="" className="size-10" />
        <div className="flex-1">
          <h1 className="text-2xl font-bold tracking-tight">Scanner</h1>
          <p className="text-sm text-slate-400">Everything is processed and stored on this device</p>
        </div>
        <button className="icon-btn text-slate-300" onClick={() => setSettingsOpen(true)} aria-label="Storage & privacy">
          <SettingsIcon />
        </button>
      </header>

      <section className="grid gap-3 sm:grid-cols-[1.4fr_1fr_1fr]">
        <div className="space-y-2">
          <button className="btn-primary w-full py-5 text-lg" onClick={() => void scan()}>
            <CameraIcon width={26} height={26} />
            Scan document
          </button>
          <Segmented
            label="Scan mode"
            value={mode}
            onChange={onModeChange}
            options={[
              { id: 'single', label: 'Single page' },
              { id: 'multi', label: 'Multi-page' },
            ]}
          />
        </div>
        <button className="btn-secondary h-full min-h-16 w-full flex-col gap-1 py-4" onClick={photos.open}>
          <ImageIcon />
          Upload photos
          <span className="text-xs font-normal text-slate-400">JPG · PNG · WebP</span>
        </button>
        <button className="btn-secondary h-full min-h-16 w-full flex-col gap-1 py-4" onClick={pdfs.open}>
          <PdfIcon />
          Open PDF
          <span className="text-xs font-normal text-slate-400">Edit, merge, split, OCR</span>
        </button>
      </section>

      <section className="mt-8">
        <div className="mb-3 flex items-center gap-2">
          <div className="relative flex-1">
            <SearchIcon className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-slate-500" width={18} />
            <input
              className="field pl-10"
              type="search"
              placeholder="Search names and recognised text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              aria-label="Search documents"
            />
          </div>
          <select className="field w-auto" value={kind} onChange={(e) => setKind(e.target.value as KindFilter)} aria-label="Document type">
            <option value="all">All types</option>
            <option value="scan">Scans</option>
            <option value="pdf">PDFs</option>
            <option value="mixed">Mixed</option>
          </select>
          <select className="field hidden w-auto sm:block" value={date} onChange={(e) => setDate(e.target.value as DateFilter)} aria-label="Date">
            {DATE_FILTERS.map((d) => (
              <option key={d.id} value={d.id}>
                {d.label}
              </option>
            ))}
          </select>
        </div>
        <select className="field mb-3 sm:hidden" value={date} onChange={(e) => setDate(e.target.value as DateFilter)} aria-label="Date">
          {DATE_FILTERS.map((d) => (
            <option key={d.id} value={d.id}>
              {d.label}
            </option>
          ))}
        </select>

        <div className="-mx-4 mb-4 flex gap-2 overflow-x-auto px-4 pb-1" role="tablist" aria-label="Folders">
          {[
            { id: 'all', name: 'All documents' },
            { id: 'none', name: 'No folder' },
          ].map((f) => (
            <button
              key={f.id}
              role="tab"
              aria-selected={folder === f.id}
              className={`chip ${folder === f.id ? 'bg-slate-100 text-slate-900 ring-slate-100' : 'bg-slate-800 text-slate-300 ring-white/10'}`}
              onClick={() => setFolder(f.id)}
            >
              {f.name}
            </button>
          ))}
          {folders.map((f) => (
            <button
              key={f.id}
              role="tab"
              aria-selected={folder === f.id}
              className={`chip ${folder === f.id ? 'bg-slate-100 text-slate-900 ring-slate-100' : 'bg-slate-800 text-slate-300 ring-white/10'}`}
              onClick={() => (folder === f.id ? void folderMenu(f) : setFolder(f.id))}
              title={folder === f.id ? 'Tap again for folder options' : undefined}
            >
              <FolderIcon width={16} height={16} />
              {f.name}
              {folder === f.id && <MoreIcon width={14} height={14} />}
            </button>
          ))}
          <button className="chip bg-transparent text-cyan-300 ring-cyan-400/40" onClick={() => void newFolder()}>
            <PlusIcon width={16} height={16} />
            New folder
          </button>
        </div>

        {docs === null ? null : filtered.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-slate-700 px-4 py-12 text-center text-sm text-slate-500">
            <DocIcon className="mx-auto mb-2 size-8 text-slate-600" />
            {docs.length === 0 ? 'Your documents will appear here. Scan or import something to start.' : 'No documents match the filters.'}
          </div>
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {filtered.map((d) => (
              <DocCard key={d.id} doc={d} folder={folders.find((f) => f.id === d.folderId)} onOpen={() => nav.go({ name: 'editor', docId: d.id, overlay: null })} onMenu={() => void docMenu(d)} />
            ))}
          </ul>
        )}
      </section>

      <ExportHistory />

      {busy && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-950/70 px-6 backdrop-blur-sm">
          <div className="w-full max-w-sm rounded-2xl bg-slate-800 p-5 shadow-xl">
            <ProgressBar value={busy.progress} label={busy.label} />
          </div>
        </div>
      )}

      {issues && (
        <Modal title="Some files could not be imported" onClose={() => setIssues(null)}>
          <ul className="mb-5 space-y-2 text-sm">
            {issues.list.map((i, k) => (
              <li key={k} className="rounded-lg bg-red-500/10 p-2.5 ring-1 ring-red-500/20">
                <div className="truncate font-medium text-red-200">{i.file}</div>
                <div className="text-red-300/80">{i.message}</div>
              </li>
            ))}
          </ul>
          <div className="flex justify-end gap-2">
            <button className="btn-secondary" onClick={() => setIssues(null)}>
              Close
            </button>
            <button
              className="btn-primary"
              onClick={() => {
                const r = issues.retry
                setIssues(null)
                r()
              }}
            >
              Choose other files
            </button>
          </div>
        </Modal>
      )}

      {settingsOpen && <SettingsDialog onClose={() => setSettingsOpen(false)} onCleared={() => void reload()} />}
    </div>
  )
}

function stripRecord(d: DocumentRecord) {
  const { thumb: _t, pageCount: _p, kind: _k, searchText: _s, ...doc } = d
  return doc
}

function useObjectUrl(blob: Blob | null) {
  const [url, setUrl] = useState<string | null>(null)
  useEffect(() => {
    if (!blob) return setUrl(null)
    const u = URL.createObjectURL(blob)
    setUrl(u)
    return () => URL.revokeObjectURL(u)
  }, [blob])
  return url
}

const fmtDate = (t: number) => new Date(t).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })

function DocCard({ doc, folder, onOpen, onMenu }: { doc: DocumentRecord; folder?: Folder; onOpen: () => void; onMenu: () => void }) {
  const thumb = useObjectUrl(doc.thumb)
  return (
    <li className="flex gap-3 rounded-2xl bg-slate-800/70 p-2.5 ring-1 ring-white/5">
      <button className="flex min-w-0 flex-1 gap-3 text-left" onClick={onOpen}>
        <span className="flex h-20 w-15 shrink-0 items-center justify-center overflow-hidden rounded-md bg-white ring-1 ring-white/10">
          {thumb ? <img src={thumb} alt="" className="size-full object-cover" /> : <DocIcon className="text-slate-400" />}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate font-medium">{doc.name}</span>
          <span className="mt-0.5 flex flex-wrap gap-1 text-[11px]">
            <span className="rounded bg-slate-700 px-1.5 py-0.5 text-slate-300">{KIND_LABEL[doc.kind]}</span>
            <span className="rounded bg-slate-700 px-1.5 py-0.5 text-slate-300">
              {doc.pageCount} page{doc.pageCount === 1 ? '' : 's'}
            </span>
            {doc.status === 'draft' && <span className="rounded bg-amber-400/15 px-1.5 py-0.5 text-amber-300">Draft</span>}
            {folder && (
              <span className="inline-flex items-center gap-1 rounded bg-slate-700 px-1.5 py-0.5 text-slate-300">
                <FolderIcon width={11} height={11} />
                {folder.name}
              </span>
            )}
          </span>
          <span className="mt-1 block text-xs text-slate-400">Edited {fmtDate(doc.updatedAt)}</span>
          <span className="block text-xs text-slate-500">Created {fmtDate(doc.createdAt)}</span>
        </span>
      </button>
      <button className="icon-btn self-start text-slate-400" onClick={onMenu} aria-label={`Actions for ${doc.name}`}>
        <MoreIcon />
      </button>
    </li>
  )
}

function ExportHistory() {
  const dialogs = useDialogs()
  const [list, setList] = useState<ExportRecord[]>([])
  const [open, setOpen] = useState(false)
  useEffect(() => {
    listExports()
      .then(setList)
      .catch(() => setList([]))
  }, [])
  if (!list.length) return null

  const share = async (r: ExportRecord) => {
    const files = exportFiles(r)
    if (!canShareFiles(files)) return downloadFiles(files)
    try {
      await shareFiles(files, r.name)
    } catch {
      await downloadFiles(files)
    }
  }
  const remove = async (r: ExportRecord) => {
    if (!(await dialogs.confirm({ title: `Remove “${r.name}” from export history?`, confirmLabel: 'Remove', danger: true }))) return
    await deleteExport(r.id)
    setList((l) => l.filter((x) => x.id !== r.id))
  }

  return (
    <section className="mt-8">
      <button className="mb-3 flex w-full items-baseline justify-between" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <SectionTitle>Recent exports ({list.length})</SectionTitle>
        <span className="text-xs text-slate-500">{open ? 'Hide' : 'Show'} · last {EXPORT_HISTORY_LIMIT} kept</span>
      </button>
      {open && (
        <ul className="space-y-2">
          {list.map((r) => (
            <ExportRow key={r.id} r={r} onShare={() => void share(r)} onDelete={() => void remove(r)} />
          ))}
        </ul>
      )}
    </section>
  )
}

function ExportRow({ r, onShare, onDelete }: { r: ExportRecord; onShare: () => void; onDelete: () => void }) {
  const thumb = useObjectUrl(r.thumb)
  const shareable = canShareFiles(exportFiles(r))
  return (
    <li className="flex items-center gap-3 rounded-2xl bg-slate-800/50 p-2 pr-1">
      {thumb && <img src={thumb} alt="" className="h-14 w-10 shrink-0 rounded bg-white object-cover" />}
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium">{r.name}</div>
        <div className="text-xs text-slate-400">
          {fmtDate(r.createdAt)} · {r.pageCount} page{r.pageCount === 1 ? '' : 's'} · {r.format.toUpperCase()} · {formatBytes(r.size)}
        </div>
      </div>
      <button className="icon-btn" aria-label={shareable ? 'Share' : 'Download'} onClick={onShare}>
        {shareable ? <ShareIcon /> : <DownloadIcon />}
      </button>
      <button className="icon-btn text-slate-400" aria-label="Remove from history" onClick={onDelete}>
        <TrashIcon />
      </button>
    </li>
  )
}

function SettingsDialog({ onClose, onCleared }: { onClose: () => void; onCleared: () => void }) {
  const dialogs = useDialogs()
  const [est, setEst] = useState<{ usage: number; quota: number } | null>(null)
  const [persisted, setPersisted] = useState<boolean | null>(null)
  useEffect(() => {
    void storageEstimate().then(setEst)
    navigator.storage?.persisted?.().then(setPersisted, () => setPersisted(null))
  }, [])

  const wipe = async () => {
    const ok = await dialogs.confirm({
      title: 'Delete all data?',
      message: 'All documents, folders, signatures and export history on this device will be permanently deleted. This cannot be undone.',
      confirmLabel: 'Delete everything',
      danger: true,
    })
    if (!ok) return
    await deleteAllData()
    dialogs.toast('All local data deleted', 'success')
    onCleared()
    onClose()
  }

  return (
    <Modal title="Storage & privacy" onClose={onClose}>
      <div className="space-y-4 text-sm text-slate-300">
        <p>
          Scanner works entirely in your browser. Photos, PDFs, recognised text and signatures are processed locally and
          stored only on this device (IndexedDB). Nothing is uploaded to a server.
        </p>
        <div className="rounded-xl bg-slate-800 p-3">
          <div className="flex justify-between">
            <span>Used storage</span>
            <span className="tabular-nums">{est ? `${formatBytes(est.usage)} of ${formatBytes(est.quota)}` : '—'}</span>
          </div>
          <div className="mt-1 flex justify-between">
            <span>Protected from automatic cleanup</span>
            <span>{persisted === null ? '—' : persisted ? 'Yes' : 'No'}</span>
          </div>
        </div>
        <p className="text-xs text-slate-400">
          Browsers may clear site data when the device runs low on space, or after long inactivity (Safari). Export
          important documents. Installing the app to the home screen makes storage more durable.
        </p>
        <button className="btn-danger w-full" onClick={() => void wipe()}>
          <TrashIcon />
          Delete all local data
        </button>
      </div>
    </Modal>
  )
}
