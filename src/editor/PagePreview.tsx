import { useEffect, useRef, useState, type ReactNode } from 'react'
import { AlertIcon } from '../components/Icons'
import { Spinner } from '../components/ui'
import { displaySize } from '../lib/render'
import type { Page } from '../types'
import type { PreviewState } from './usePreview'

/** Measures the box available for the page and returns the fitted display size. */
export function useFit(page: Page | undefined, pad = 16) {
  const ref = useRef<HTMLDivElement>(null)
  const [box, setBox] = useState({ w: 0, h: 0 })
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const ro = new ResizeObserver(([e]) => setBox({ w: e.contentRect.width, h: e.contentRect.height }))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  const size = page ? displaySize(page) : { width: 1, height: 1 }
  const f = Math.max(0, Math.min((box.w - pad * 2) / size.width, (box.h - pad * 2) / size.height))
  return { ref, width: size.width * f, height: size.height * f, aspect: size.height / size.width }
}

/** Page image fitted into the workspace, with optional overlay content on top. */
export function PagePreview({
  page,
  preview,
  children,
  under,
}: {
  page: Page
  preview: PreviewState
  children?: ReactNode
  /** Rendered below the main image (e.g. the "before" layer). */
  under?: ReactNode
}) {
  const fit = useFit(page)
  return (
    <div ref={fit.ref} className="absolute inset-0 flex items-center justify-center overflow-hidden">
      {fit.width > 0 && (
        <div className="relative bg-white shadow-2xl ring-1 ring-white/10" style={{ width: fit.width, height: fit.height }}>
          {preview.url && <img src={preview.url} alt="Page preview" draggable={false} className="absolute inset-0 size-full select-none" />}
          {under}
          {children}
          {preview.loading && (
            <span className="absolute top-2 right-2 rounded-full bg-slate-900/80 p-2" aria-label="Rendering">
              <Spinner className="size-5 text-cyan-400" />
            </span>
          )}
          {preview.error && (
            <span className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-red-950/80 p-4 text-center text-sm text-red-100">
              <AlertIcon />
              {preview.error}
            </span>
          )}
        </div>
      )}
    </div>
  )
}
