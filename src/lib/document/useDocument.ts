import { useCallback, useEffect, useRef, useState } from 'react'
import type { Page, ScanDocument } from '../../types'
import { repository } from '../storage/repository'

const HISTORY_LIMIT = 100
const SAVE_DELAY = 600

export type SaveState = 'saved' | 'pending' | 'saving' | 'error'

interface UpdateOptions {
  /** false for automatic changes (e.g. edge detection) that should not be undoable. */
  undoable?: boolean
  /** Consecutive updates with the same key within 1.5 s collapse into one undo step (sliders, drags). */
  merge?: string
}

/**
 * Editable document with undo/redo and debounced autosave to IndexedDB. Every change is
 * persisted as a draft, so nothing is lost if the tab is closed or the app crashes.
 */
export function useDocument(initial: ScanDocument, getThumb: () => Promise<Blob | null>) {
  const [doc, setDoc] = useState(initial)
  const docRef = useRef(initial)
  const past = useRef<ScanDocument[]>([])
  const future = useRef<ScanDocument[]>([])
  const lastMerge = useRef<{ key: string; at: number } | null>(null)
  const [, force] = useState(0)
  const [saveState, setSaveState] = useState<SaveState>('saved')
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const thumbRef = useRef(getThumb)
  thumbRef.current = getThumb

  const save = useCallback(async () => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = null
    setSaveState('saving')
    try {
      await repository.saveDocument(docRef.current, await thumbRef.current().catch(() => null))
      setSaveState((s) => (s === 'saving' ? 'saved' : s))
    } catch (e) {
      console.error('Autosave failed', e)
      setSaveState('error')
    }
  }, [])

  const schedule = useCallback(() => {
    setSaveState('pending')
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => void save(), SAVE_DELAY)
  }, [save])

  const commit = useCallback(
    (next: ScanDocument) => {
      docRef.current = next
      setDoc(next)
      schedule()
    },
    [schedule],
  )

  const update = useCallback(
    (fn: (d: ScanDocument) => ScanDocument, opts: UpdateOptions = {}) => {
      const prev = docRef.current
      const next = { ...fn(prev), updatedAt: Date.now() }
      if (opts.undoable !== false) {
        const now = Date.now()
        const merging = opts.merge && lastMerge.current?.key === opts.merge && now - lastMerge.current.at < 1500
        if (!merging) {
          past.current.push(prev)
          if (past.current.length > HISTORY_LIMIT) past.current.shift()
        }
        future.current = []
        lastMerge.current = opts.merge ? { key: opts.merge, at: now } : null
      } else {
        // Keep automatic results (e.g. detected corners) when stepping through history.
        const patchHistory = (d: ScanDocument) => ({
          ...d,
          pages: d.pages.map((p) => {
            const n = next.pages.find((x) => x.id === p.id)
            return n && p.kind === 'scan' && n.kind === 'scan' && p.corners === null ? { ...p, corners: n.corners, detection: n.detection } : p
          }),
        })
        past.current = past.current.map(patchHistory)
        future.current = future.current.map(patchHistory)
      }
      commit(next)
    },
    [commit],
  )

  const updatePage = useCallback(
    (id: string, fn: (p: Page) => Page, opts?: UpdateOptions) =>
      update((d) => ({ ...d, pages: d.pages.map((p) => (p.id === id ? fn(p) : p)) }), opts),
    [update],
  )

  const undo = useCallback(() => {
    const prev = past.current.pop()
    if (!prev) return
    future.current.push(docRef.current)
    lastMerge.current = null
    commit(prev)
    force((n) => n + 1)
  }, [commit])

  const redo = useCallback(() => {
    const next = future.current.pop()
    if (!next) return
    past.current.push(docRef.current)
    lastMerge.current = null
    commit(next)
    force((n) => n + 1)
  }, [commit])

  // Flush pending saves when leaving the editor, and warn before closing the tab mid-save.
  useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (timer.current) {
        void save()
        e.preventDefault()
      }
    }
    const onHide = () => {
      if (document.visibilityState === 'hidden' && timer.current) void save()
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    document.addEventListener('visibilitychange', onHide)
    return () => {
      window.removeEventListener('beforeunload', onBeforeUnload)
      document.removeEventListener('visibilitychange', onHide)
      if (timer.current) void save()
    }
  }, [save])

  return {
    doc,
    docRef,
    update,
    updatePage,
    undo,
    redo,
    canUndo: past.current.length > 0,
    canRedo: future.current.length > 0,
    saveState,
    saveNow: save,
  }
}

export type DocumentApi = ReturnType<typeof useDocument>
