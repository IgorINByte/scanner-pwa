import { useCallback, useEffect, useRef, useState } from 'react'
import type { FilterId, Page } from '../types'
import { fullFrame } from './geometry'
import { canvasToBlob, releaseCanvas, type PreparedImage } from './image'
import { pageKey, renderPage } from './render'
import { detectCorners } from './scan'

const THUMB_SIDE = 480
const FILTER_KEY = 'scanner.defaultFilter'

export const uid = () =>
  typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`

function readDefaultFilter(): FilterId {
  try {
    return (localStorage.getItem(FILTER_KEY) as FilterId) || 'original'
  } catch {
    return 'original'
  }
}

export function rememberFilter(f: FilterId) {
  try {
    localStorage.setItem(FILTER_KEY, f)
  } catch {
    // storage unavailable (private mode) - not important
  }
}

/**
 * Holds the pages of the scan in progress and runs a background queue that
 * auto-detects corners for new pages and keeps thumbnails up to date.
 */
export function usePages() {
  const [pages, setPages] = useState<Page[]>([])
  const ref = useRef<Page[]>(pages)
  const running = useRef(false)

  // All mutations go through apply() so the queue always sees the latest list synchronously.
  const apply = useCallback((fn: (p: Page[]) => Page[]) => {
    ref.current = fn(ref.current)
    setPages(ref.current)
  }, [])

  const patch = useCallback(
    (id: string, changes: Partial<Page>) => apply((list) => list.map((p) => (p.id === id ? { ...p, ...changes } : p))),
    [apply],
  )

  const pump = useCallback(async () => {
    if (running.current) return
    running.current = true
    try {
      for (;;) {
        const pending = ref.current.find((p) => !p.corners)
        if (pending) {
          let corners
          try {
            corners = await detectCorners(pending.source, pending.width, pending.height)
          } catch (e) {
            console.warn('Corner detection failed', e)
            corners = fullFrame(pending.width, pending.height)
          }
          patch(pending.id, { corners })
          continue
        }
        const stale = ref.current.find((p) => p.thumbKey !== pageKey(p))
        if (!stale) break
        const key = pageKey(stale)
        let url: string | undefined
        try {
          const canvas = await renderPage(stale, THUMB_SIDE)
          url = URL.createObjectURL(await canvasToBlob(canvas, 'image/jpeg', 0.8))
          releaseCanvas(canvas)
        } catch (e) {
          console.warn('Thumbnail render failed', e)
        }
        const current = ref.current.find((p) => p.id === stale.id)
        if (!current) {
          if (url) URL.revokeObjectURL(url)
          continue
        }
        if (url && current.thumbUrl) URL.revokeObjectURL(current.thumbUrl)
        patch(stale.id, { thumbUrl: url ?? current.thumbUrl, thumbKey: key })
      }
    } finally {
      running.current = false
    }
  }, [patch])

  useEffect(() => {
    void pump()
  }, [pages, pump])

  const addImages = useCallback(
    (images: PreparedImage[]) => {
      const filter = readDefaultFilter()
      const added: Page[] = images.map((img) => ({
        id: uid(),
        source: img.blob,
        width: img.width,
        height: img.height,
        corners: null,
        filter,
        rotation: 0,
      }))
      apply((list) => [...list, ...added])
      return added.map((p) => p.id)
    },
    [apply],
  )

  const remove = useCallback(
    (id: string) =>
      apply((list) => {
        const page = list.find((p) => p.id === id)
        if (page?.thumbUrl) URL.revokeObjectURL(page.thumbUrl)
        return list.filter((p) => p.id !== id)
      }),
    [apply],
  )

  const move = useCallback(
    (from: number, to: number) =>
      apply((list) => {
        const next = [...list]
        const [item] = next.splice(from, 1)
        next.splice(to, 0, item)
        return next
      }),
    [apply],
  )

  const clear = useCallback(
    () =>
      apply((list) => {
        list.forEach((p) => p.thumbUrl && URL.revokeObjectURL(p.thumbUrl))
        return []
      }),
    [apply],
  )

  return { pages, addImages, patch, remove, move, clear }
}

export type PagesApi = ReturnType<typeof usePages>
