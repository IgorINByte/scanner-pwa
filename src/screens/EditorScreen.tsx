import { useCallback, useEffect, useMemo, useState } from 'react'
import type { Nav, Screen } from '../App'
import { Modal, useDialogs } from '../components/dialogs'
import {
  BackIcon,
  CameraIcon,
  CropIcon,
  DuplicateIcon,
  ImageIcon,
  OcrIcon,
  PagesIcon,
  PdfIcon,
  PenIcon,
  RedoIcon,
  RotateIcon,
  RotateLeftIcon,
  SelectIcon,
  ShareIcon,
  SlidersIcon,
  TrashIcon,
  UndoIcon,
} from '../components/Icons'
import { ProgressBar, Spinner, useFilePicker } from '../components/ui'
import AnnotateView from '../editor/AnnotateView'
import CropView from '../editor/CropView'
import EnhanceView, { rotateBy } from '../editor/EnhanceView'
import ExportDialog from '../editor/ExportDialog'
import OcrView from '../editor/OcrView'
import PageList from '../editor/PageList'
import { Notice, PageNav } from '../editor/ToolLayout'
import { clearPreviewCache } from '../editor/usePreview'
import { importImages, importPdf, scanPageFromImage, type ImportIssue } from '../lib/document/import'
import { useDocument, type SaveState } from '../lib/document/useDocument'
import { useProcessing } from '../lib/document/useProcessing'
import { IMAGE_ACCEPT, PDF_ACCEPT, sanitizeFileName } from '../lib/files'
import type { PreparedImage } from '../lib/image'
import { releasePdf } from '../lib/pdf/pdfjs'
import { repository } from '../lib/storage/repository'
import { uid } from '../lib/uid'
import { FILTERS, type FilterId, type Page, type ScanDocument, type ScanMode, type ScanPage } from '../types'
import CameraScreen from './CameraScreen'

type Tab = 'pages' | 'crop' | 'enhance' | 'annotate' | 'ocr'

const TABS: { id: Tab; label: string; icon: typeof PagesIcon }[] = [
  { id: 'pages', label: 'Pages', icon: PagesIcon },
  { id: 'crop', label: 'Crop', icon: CropIcon },
  { id: 'enhance', label: 'Enhance', icon: SlidersIcon },
  { id: 'annotate', label: 'Annotate', icon: PenIcon },
  { id: 'ocr', label: 'Text (OCR)', icon: OcrIcon },
]

interface Props {
  screen: Extract<Screen, { name: 'editor' }>
  nav: Nav
  mode: ScanMode
}

export default function EditorScreen(props: Props) {
  const [doc, setDoc] = useState<ScanDocument | null | 'missing'>(null)
  useEffect(() => {
    repository.getDocument(props.screen.docId).then(
      (r) => {
        if (!r) return setDoc('missing')
        const { thumb: _t, pageCount: _p, kind: _k, searchText: _s, ...d } = r
        setDoc(d)
      },
      () => setDoc('missing'),
    )
  }, [props.screen.docId])

  if (doc === null)
    return (
      <div className="flex min-h-dvh items-center justify-center">
        <Spinner className="size-8 text-cyan-400" />
      </div>
    )
  if (doc === 'missing')
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center gap-4 p-6 text-center">
        <p className="text-slate-300">This document no longer exists on this device.</p>
        <button className="btn-primary" onClick={props.nav.back}>
          Back to documents
        </button>
      </div>
    )
  return <Editor {...props} initial={doc} />
}

function Editor({ screen, nav, mode, initial }: Props & { initial: ScanDocument }) {
  const dialogs = useDialogs()
  const [thumbUrl, setThumbUrl] = useState<string | undefined>()
  const getThumb = useCallback(async () => (thumbUrl ? (await fetch(thumbUrl)).blob() : null), [thumbUrl])
  const api = useDocument(initial, getThumb)
  const { doc, update, updatePage, undo, redo, canUndo, canRedo, saveState, docRef } = api

  const setDetection = useCallback(
    (id: string, d: { corners: NonNullable<ScanPage['corners']>; detection: ScanPage['detection'] }) =>
      updatePage(id, (p) => (p.kind === 'scan' ? { ...p, corners: d.corners, detection: d.detection } : p), { undoable: false }),
    [updatePage],
  )
  const getPages = useCallback(() => docRef.current.pages, [docRef])
  const { thumbs, errors, retry } = useProcessing(doc, getPages, setDetection)

  const [tab, setTab] = useState<Tab>((screen.startTab as Tab) ?? 'pages')
  const [currentId, setCurrentId] = useState<string | undefined>(initial.pages[0]?.id)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [selecting, setSelecting] = useState(false)
  const [busy, setBusy] = useState<{ label: string; value: number } | null>(null)
  const [issues, setIssues] = useState<ImportIssue[] | null>(null)

  const pages = doc.pages
  const index = Math.max(0, pages.findIndex((p) => p.id === currentId))
  const current: Page | undefined = pages[index]
  const firstThumb = pages[0] ? thumbs[pages[0].id]?.url : undefined
  useEffect(() => setThumbUrl(firstThumb), [firstThumb])

  // Keep the current page valid after deletions / undo.
  useEffect(() => {
    if (pages.length && !pages.some((p) => p.id === currentId)) setCurrentId(pages[Math.min(index, pages.length - 1)].id)
    setSelected((s) => {
      const ids = new Set(pages.map((p) => p.id))
      const next = new Set([...s].filter((id) => ids.has(id)))
      return next.size === s.size ? s : next
    })
  }, [pages, currentId, index])

  // Ctrl/Cmd+Z, Ctrl+Shift+Z / Ctrl+Y
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || (e.target as HTMLElement).closest('input,textarea')) return
      const k = e.key.toLowerCase()
      if (k === 'z' && !e.shiftKey) (e.preventDefault(), undo())
      else if ((k === 'z' && e.shiftKey) || k === 'y') (e.preventDefault(), redo())
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [undo, redo])

  // Release cached rendering resources when the editor closes.
  useEffect(
    () => () => {
      clearPreviewCache()
      const ids = new Set(docRef.current.pages.filter((p) => p.kind === 'pdf').map((p) => p.sourceId))
      ids.forEach((id) => void releasePdf(id))
    },
    [docRef],
  )

  // ---------------------------------------------------------------- page operations

  const addPages = (added: Page[], focus = true) => {
    if (!added.length) return
    update((d) => ({ ...d, pages: [...d.pages, ...added] }))
    if (focus) setCurrentId(added[0].id)
  }

  const onCapture = async (img: PreparedImage) => {
    const page = await scanPageFromImage(doc.id, img)
    addPages([page])
    if (mode === 'single') {
      nav.back() // close camera
      setTab('crop')
    }
  }

  const importFiles = async (files: File[], kind: 'images' | 'pdf') => {
    const list: ImportIssue[] = []
    try {
      if (kind === 'images') {
        const res = await importImages(doc.id, files, (d, t, n) => setBusy({ label: n ? `Importing ${n}` : 'Finishing…', value: d / t }))
        addPages(res.pages)
        list.push(...res.issues)
        if (res.pages.length) dialogs.toast(`${res.pages.length} page${res.pages.length === 1 ? '' : 's'} added`, 'success')
      } else {
        for (const [i, f] of files.entries()) {
          setBusy({ label: `Opening ${f.name}`, value: i / files.length })
          try {
            const added = await importPdf(doc.id, f, (file, incorrect) =>
              dialogs.prompt({ title: incorrect ? 'Wrong password' : 'Password required', message: `“${file}” is password protected.`, type: 'password', confirmLabel: 'Open' }),
            )
            addPages(added)
            dialogs.toast(`${added.length} page${added.length === 1 ? '' : 's'} added from ${f.name}`, 'success')
          } catch (e) {
            list.push({ file: f.name, message: e instanceof Error ? e.message : 'Could not open the PDF.' })
          }
        }
      }
    } finally {
      setBusy(null)
    }
    if (list.length) setIssues(list)
  }

  const photos = useFilePicker((f) => void importFiles(f, 'images'), { multiple: true, accept: IMAGE_ACCEPT })
  const pdfs = useFilePicker((f) => void importFiles(f, 'pdf'), { multiple: true, accept: PDF_ACCEPT })

  const rotate = (ids: string[], delta: 90 | -90) =>
    update((d) => ({ ...d, pages: d.pages.map((p) => (ids.includes(p.id) ? { ...p, rotation: rotateBy(p.rotation, delta) } : p)) }))

  const remove = async (ids: string[]) => {
    if (!ids.length) return
    const ok = await dialogs.confirm({
      title: ids.length > 1 ? `Delete ${ids.length} pages?` : 'Delete this page?',
      message: 'You can restore it with Undo.',
      confirmLabel: 'Delete',
      danger: true,
    })
    if (!ok) return
    update((d) => ({ ...d, pages: d.pages.filter((p) => !ids.includes(p.id)) }))
    setSelected(new Set())
    dialogs.toast(ids.length > 1 ? `${ids.length} pages deleted` : 'Page deleted', 'info', { label: 'Undo', run: undo })
  }

  const duplicate = (ids: string[]) => {
    update((d) => ({
      ...d,
      pages: d.pages.flatMap((p) => (ids.includes(p.id) ? [p, { ...p, id: uid(), ocr: p.ocr ? { ...p.ocr } : null, annotations: p.annotations.map((a) => ({ ...a, id: uid() })) }] : [p])),
    }))
    dialogs.toast(ids.length > 1 ? `${ids.length} pages duplicated` : 'Page duplicated', 'success')
  }

  const applyFilter = async (ids: string[]) => {
    const filter = await dialogs.choose<FilterId>({ title: 'Apply filter to selected photo pages', options: FILTERS.map((f) => ({ value: f.id, label: `${f.label} — ${f.hint}` })) })
    if (!filter) return
    update((d) => ({ ...d, pages: d.pages.map((p) => (ids.includes(p.id) && p.kind === 'scan' ? { ...p, filter } : p)) }))
  }

  const move = (from: number, to: number) =>
    update((d) => {
      const next = [...d.pages]
      const [it] = next.splice(from, 1)
      next.splice(to, 0, it)
      return { ...d, pages: next }
    })

  const patchScan = (patch: Partial<ScanPage>, merge?: string) =>
    current && updatePage(current.id, (p) => (p.kind === 'scan' ? { ...p, ...patch } : p), { merge: merge && `${merge}:${current.id}` })

  const rename = async () => {
    const name = await dialogs.prompt({ title: 'Rename document', initial: doc.name, confirmLabel: 'Rename' })
    if (name?.trim()) update((d) => ({ ...d, name: sanitizeFileName(name, d.name) }))
  }

  const leave = async () => {
    await api.saveNow()
    if (!docRef.current.pages.length) await repository.deleteDocument(doc.id)
    else void repository.collectGarbage(docRef.current)
    nav.back()
  }

  const goto = (delta: number) => {
    const p = pages[index + delta]
    if (p) setCurrentId(p.id)
  }

  const top = current && (
    <PageNav
      index={index}
      total={pages.length}
      onPrev={() => goto(-1)}
      onNext={() => goto(1)}
      extra={
        <button className="icon-btn size-9 text-slate-400" onClick={() => void remove([current.id])} aria-label="Delete this page">
          <TrashIcon width={18} />
        </button>
      }
    />
  )

  const scanCount = pages.filter((p) => p.kind === 'scan').length

  let body: React.ReactNode
  if (!pages.length) {
    body = (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
        <PagesIcon className="size-10 text-slate-600" />
        <p className="text-slate-400">This document has no pages yet.</p>
        <AddButtons onCamera={() => nav.go({ ...screen, overlay: 'camera' })} onPhotos={photos.open} onPdf={pdfs.open} />
      </div>
    )
  } else if (tab === 'pages' || !current) {
    const ids = [...selected]
    body = (
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="flex shrink-0 items-center gap-1 overflow-x-auto border-b border-white/5 px-2 py-1.5" role="toolbar" aria-label="Page actions">
          <button className="tool-btn" aria-pressed={selecting} onClick={() => (setSelecting((s) => !s), setSelected(new Set()))}>
            <SelectIcon width={20} />
            {selecting ? 'Done' : 'Select'}
          </button>
          {selecting && (
            <button className="tool-btn" onClick={() => setSelected(selected.size === pages.length ? new Set() : new Set(pages.map((p) => p.id)))}>
              <PagesIcon width={20} />
              {selected.size === pages.length ? 'None' : 'All'}
            </button>
          )}
          {selecting && (
            <>
              <span className="mx-1 h-8 w-px bg-white/10" />
              <button className="tool-btn" disabled={!ids.length} onClick={() => rotate(ids, -90)}>
                <RotateLeftIcon width={20} />
                Left
              </button>
              <button className="tool-btn" disabled={!ids.length} onClick={() => rotate(ids, 90)}>
                <RotateIcon width={20} />
                Right
              </button>
              <button className="tool-btn" disabled={!ids.length} onClick={() => duplicate(ids)}>
                <DuplicateIcon width={20} />
                Duplicate
              </button>
              <button className="tool-btn" disabled={!ids.some((id) => pages.find((p) => p.id === id)?.kind === 'scan')} onClick={() => void applyFilter(ids)}>
                <SlidersIcon width={20} />
                Filter
              </button>
              <button className="tool-btn" disabled={!ids.length} onClick={() => nav.go({ ...screen, overlay: 'export' })}>
                <ShareIcon width={20} />
                Extract
              </button>
              <button className="tool-btn text-red-300" disabled={!ids.length} onClick={() => void remove(ids)}>
                <TrashIcon width={20} />
                Delete
              </button>
            </>
          )}
          <span className="ml-auto pr-2 text-xs whitespace-nowrap text-slate-500">
            {selecting ? `${selected.size} selected` : `${pages.length} page${pages.length === 1 ? '' : 's'}`}
          </span>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-4 pt-4 pb-8">
          {pages.length > 1 && !selecting && <p className="mb-3 text-center text-xs text-slate-500">Tap a page to edit it · long-press and drag to reorder</p>}
          <PageList
            pages={pages}
            thumbs={thumbs}
            errors={errors}
            currentId={currentId}
            selected={selected}
            selecting={selecting}
            layout="grid"
            onOpen={(id) => {
              setCurrentId(id)
              const p = pages.find((x) => x.id === id)
              setTab(p?.kind === 'scan' ? 'enhance' : 'annotate')
            }}
            onToggle={(id) =>
              setSelected((s) => {
                const n = new Set(s)
                if (n.has(id)) n.delete(id)
                else n.add(id)
                return n
              })
            }
            onMove={move}
            onRetry={retry}
          />
          <div className="mt-6">
            <AddButtons onCamera={() => nav.go({ ...screen, overlay: 'camera' })} onPhotos={photos.open} onPdf={pdfs.open} />
          </div>
        </div>
      </div>
    )
  } else if (tab === 'crop') {
    body =
      current.kind === 'scan' ? (
        <CropView key={current.id} page={current} top={top} onChange={patchScan} onDone={() => setTab('enhance')} />
      ) : (
        <div className="flex flex-1 flex-col">
          {top}
          <div className="m-4">
            <Notice>Cropping and perspective correction apply to photos. This page comes from a PDF and keeps its original layout.</Notice>
          </div>
        </div>
      )
  } else if (tab === 'enhance') {
    body = (
      <EnhanceView
        page={current}
        top={top}
        onChange={patchScan}
        onRotate={(d) => rotate([current.id], d)}
        scanCount={scanCount}
        onApplyToAll={() =>
          current.kind === 'scan' &&
          update((d) => ({ ...d, pages: d.pages.map((p) => (p.kind === 'scan' ? { ...p, filter: current.filter, adjust: { ...current.adjust } } : p)) }))
        }
      />
    )
  } else if (tab === 'annotate') {
    body = (
      <AnnotateView
        page={current}
        top={top}
        watermark={doc.watermark}
        onAnnotations={(annotations, merge) => updatePage(current.id, (p) => ({ ...p, annotations }), { merge })}
        onWatermark={(watermark, merge) => update((d) => ({ ...d, watermark }), { merge })}
      />
    )
  } else {
    body = (
      <OcrView
        page={current}
        pages={pages}
        top={top}
        lang={doc.ocrLang}
        docName={sanitizeFileName(doc.name, 'Scan')}
        onLang={(ocrLang) => update((d) => ({ ...d, ocrLang }), { undoable: false })}
        onResult={(id, ocr, merge) => updatePage(id, (p) => ({ ...p, ocr }), { merge })}
        onGoTo={setCurrentId}
      />
    )
  }

  const showRail = tab !== 'pages' && pages.length > 0

  return (
    <div className="fixed inset-0 flex flex-col bg-slate-950">
      {photos.input}
      {pdfs.input}
      <header className="flex h-[calc(env(safe-area-inset-top)+3.5rem)] shrink-0 items-end border-b border-white/5 bg-slate-900 px-2 pb-1">
        <div className="flex h-12 w-full items-center gap-1">
          <button className="icon-btn" onClick={() => void leave()} aria-label="Back to documents">
            <BackIcon />
          </button>
          <button className="min-w-0 flex-1 truncate text-left" onClick={() => void rename()} title="Rename">
            <span className="block truncate font-semibold">{doc.name}</span>
            <SaveIndicator state={saveState} />
          </button>
          <button className="icon-btn" onClick={undo} disabled={!canUndo} aria-label="Undo">
            <UndoIcon />
          </button>
          <button className="icon-btn" onClick={redo} disabled={!canRedo} aria-label="Redo">
            <RedoIcon />
          </button>
          <button className="btn-primary min-h-10 px-3 py-2 text-sm" onClick={() => nav.go({ ...screen, overlay: 'export' })} disabled={!pages.length} aria-label="Export">
            <ShareIcon width={18} />
            <span className="hidden sm:inline">Export</span>
          </button>
        </div>
      </header>

      <nav className="order-last flex shrink-0 justify-around border-t border-white/5 bg-slate-900 px-1 pt-1 pb-[calc(env(safe-area-inset-bottom)+0.25rem)] lg:order-none lg:justify-start lg:gap-1 lg:border-t-0 lg:border-b lg:px-3 lg:pb-1" role="tablist" aria-label="Editor tools">
        {TABS.map((t) => (
          <button key={t.id} role="tab" aria-selected={tab === t.id} aria-pressed={tab === t.id} className="tool-btn lg:flex-row lg:gap-2 lg:px-3 lg:text-sm" onClick={() => setTab(t.id)} disabled={!pages.length && t.id !== 'pages'}>
            <t.icon width={20} />
            {t.label}
          </button>
        ))}
      </nav>

      <div className="flex min-h-0 flex-1">
        {showRail && (
          <aside className="hidden w-44 shrink-0 overflow-y-auto border-r border-white/5 p-3 lg:block" aria-label="Page thumbnails">
            <PageList
              pages={pages}
              thumbs={thumbs}
              errors={errors}
              currentId={currentId}
              selected={new Set()}
              selecting={false}
              layout="rail"
              onOpen={setCurrentId}
              onToggle={() => {}}
              onMove={move}
              onRetry={retry}
            />
          </aside>
        )}
        <main className="flex min-h-0 min-w-0 flex-1 flex-col">{body}</main>
      </div>

      {screen.overlay === 'camera' && (
        <CameraScreen
          mode={mode}
          pageCount={pages.length}
          lastThumb={pages.length ? thumbs[pages[pages.length - 1].id]?.url : undefined}
          onCapture={(img) => void onCapture(img)}
          onImport={(f) => {
            nav.back()
            void importFiles(f, 'images')
          }}
          onDone={nav.back}
          onClose={nav.back}
        />
      )}

      {screen.overlay === 'export' && (
        <ExportDialog
          doc={doc}
          selectedIds={pages.filter((p) => selected.has(p.id)).map((p) => p.id)}
          thumbUrl={thumbUrl}
          onClose={nav.back}
          onExported={() => update((d) => ({ ...d, status: 'exported' }), { undoable: false })}
        />
      )}

      {busy && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-950/70 px-6 backdrop-blur-sm">
          <div className="w-full max-w-sm rounded-2xl bg-slate-800 p-5 shadow-xl">
            <ProgressBar value={busy.value} label={busy.label} />
          </div>
        </div>
      )}

      {issues && (
        <Modal title="Some files could not be added" onClose={() => setIssues(null)}>
          <ul className="mb-5 space-y-2 text-sm">
            {issues.map((i, k) => (
              <li key={k} className="rounded-lg bg-red-500/10 p-2.5 ring-1 ring-red-500/20">
                <div className="truncate font-medium text-red-200">{i.file}</div>
                <div className="text-red-300/80">{i.message}</div>
              </li>
            ))}
          </ul>
          <button className="btn-secondary w-full" onClick={() => setIssues(null)}>
            OK
          </button>
        </Modal>
      )}
    </div>
  )
}

function SaveIndicator({ state }: { state: SaveState }) {
  const label = { saved: 'All changes saved on this device', pending: 'Unsaved changes…', saving: 'Saving…', error: 'Saving failed — storage may be full' }[state]
  return (
    <span className={`block truncate text-[11px] ${state === 'error' ? 'text-red-300' : 'text-slate-500'}`} aria-live="polite">
      {label}
    </span>
  )
}

function AddButtons({ onCamera, onPhotos, onPdf }: { onCamera: () => void; onPhotos: () => void; onPdf: () => void }) {
  const items = useMemo(
    () => [
      { label: 'Camera', icon: CameraIcon, run: onCamera },
      { label: 'Photos', icon: ImageIcon, run: onPhotos },
      { label: 'PDF', icon: PdfIcon, run: onPdf },
    ],
    [onCamera, onPhotos, onPdf],
  )
  return (
    <div>
      <p className="mb-2 text-center text-xs text-slate-500">Add pages</p>
      <div className="mx-auto grid max-w-md grid-cols-3 gap-2">
        {items.map((it) => (
          <button key={it.label} className="btn-secondary flex-col gap-1 px-2 py-3 text-sm" onClick={it.run}>
            <it.icon />
            {it.label}
          </button>
        ))}
      </div>
    </div>
  )
}
