import { useEffect, useState } from 'react'
import { pageKey, renderPage } from '../lib/render'
import type { Page } from '../types'

export const PREVIEW_SIDE = 1600
const CACHE_SIZE = 16

interface Entry {
  url: string
  width: number
  height: number
}

// Small LRU of rendered previews (object URLs), keyed by page render key.
const cache = new Map<string, Promise<Entry>>()

function evict() {
  while (cache.size > CACHE_SIZE) {
    const [k, p] = cache.entries().next().value!
    cache.delete(k)
    void p.then((e) => setTimeout(() => URL.revokeObjectURL(e.url), 5000), () => {})
  }
}

export function clearPreviewCache() {
  for (const p of cache.values()) void p.then((e) => URL.revokeObjectURL(e.url), () => {})
  cache.clear()
}

function getPreview(page: Page, unfiltered: boolean): Promise<Entry> {
  const key = `${pageKey(page)}|${unfiltered}`
  let p = cache.get(key)
  if (p) {
    cache.delete(key)
    cache.set(key, p)
    return p
  }
  p = renderPage(page, { maxSide: PREVIEW_SIDE, quality: 0.88, unfiltered }).then((r) => ({
    url: URL.createObjectURL(r.blob),
    width: r.width,
    height: r.height,
  }))
  p.catch(() => cache.delete(key))
  cache.set(key, p)
  evict()
  return p
}

export interface PreviewState {
  url: string | null
  width: number
  height: number
  loading: boolean
  error: string | null
}

/** Rendered preview of a page; keeps showing the previous image while a new one renders. */
export function usePreview(page: Page | undefined, unfiltered = false, enabled = true): PreviewState {
  const [state, setState] = useState<PreviewState>({ url: null, width: 0, height: 0, loading: true, error: null })
  const key = page ? `${pageKey(page)}|${unfiltered}` : ''
  useEffect(() => {
    if (!page || !enabled) return
    if (page.kind === 'scan' && !page.corners) {
      setState((s) => ({ ...s, loading: true }))
      return
    }
    let cancelled = false
    setState((s) => ({ ...s, loading: true, error: null }))
    getPreview(page, unfiltered).then(
      (e) => !cancelled && setState({ url: e.url, width: e.width, height: e.height, loading: false, error: null }),
      (err) => !cancelled && setState((s) => ({ ...s, loading: false, error: err instanceof Error ? err.message : 'Rendering failed' })),
    )
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, enabled])
  return state
}
