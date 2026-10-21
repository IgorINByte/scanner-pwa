import { useCallback, useEffect, useRef, useState } from 'react'
import type { Page, ScanDocument } from '../../types'
import { detectCorners } from '../imaging/detect'
import { fullFrame } from '../geometry'
import { pageKey, renderPage } from '../render'
import { repository } from '../storage/repository'

const THUMB_SIDE = 360

export interface Thumb {
  key: string
  url: string
}

/**
 * Background queue for the open document: runs edge detection on new scan pages and
 * keeps one thumbnail per page in sync with its current settings. Work runs one item
 * at a time so large documents never flood the worker or memory.
 */
export function useProcessing(
  doc: ScanDocument,
  /** Synchronous access to the latest pages (updated before React re-renders). */
  getPages: () => Page[],
  setDetection: (pageId: string, d: { corners: NonNullable<Extract<Page, { kind: 'scan' }>['corners']>; detection: 'found' | 'approx' | 'none' }) => void,
) {
  const [thumbs, setThumbs] = useState<Record<string, Thumb>>({})
  const [errors, setErrors] = useState<Record<string, string>>({})
  const thumbsRef = useRef(thumbs)
  const running = useRef(false)
  const failed = useRef(new Set<string>())

  const pump = useCallback(async () => {
    if (running.current) return
    running.current = true
    try {
      for (;;) {
        const pages = getPages()
        const pending = pages.find((p) => p.kind === 'scan' && !p.corners && !failed.current.has(`d:${p.id}`))
        if (pending && pending.kind === 'scan') {
          try {
            const d = await detectCorners(await repository.getBlob(pending.sourceId), pending.width, pending.height)
            setDetection(pending.id, d)
          } catch (e) {
            console.warn('Edge detection failed', e)
            failed.current.add(`d:${pending.id}`)
            setDetection(pending.id, { corners: fullFrame(pending.width, pending.height), detection: 'none' })
          }
          continue
        }
        const stale = pages.find(
          (p) => (p.kind === 'pdf' || p.corners) && thumbsRef.current[p.id]?.key !== pageKey(p) && !failed.current.has(`t:${pageKey(p)}`),
        )
        if (!stale) break
        const key = pageKey(stale)
        try {
          const img = await renderPage(stale, { maxSide: THUMB_SIDE, quality: 0.8 })
          const url = URL.createObjectURL(img.blob)
          const old = thumbsRef.current[stale.id]
          thumbsRef.current = { ...thumbsRef.current, [stale.id]: { key, url } }
          setThumbs(thumbsRef.current)
          setErrors((e) => {
            if (!e[stale.id]) return e
            const { [stale.id]: _, ...rest } = e
            return rest
          })
          if (old) setTimeout(() => URL.revokeObjectURL(old.url), 2000)
        } catch (e) {
          console.warn('Thumbnail failed', e)
          failed.current.add(`t:${key}`)
          setErrors((er) => ({ ...er, [stale.id]: e instanceof Error ? e.message : 'Processing failed' }))
        }
      }
    } finally {
      running.current = false
    }
  }, [setDetection, getPages])

  useEffect(() => {
    void pump()
  }, [doc.pages, pump])

  // Free object URLs of thumbnails when the editor closes.
  useEffect(
    () => () => {
      Object.values(thumbsRef.current).forEach((t) => URL.revokeObjectURL(t.url))
    },
    [],
  )

  const retry = useCallback(
    (pageId: string) => {
      const p = getPages().find((x) => x.id === pageId)
      if (!p) return
      failed.current.delete(`t:${pageKey(p)}`)
      failed.current.delete(`d:${p.id}`)
      void pump()
    },
    [pump, getPages],
  )

  return { thumbs, errors, retry }
}
