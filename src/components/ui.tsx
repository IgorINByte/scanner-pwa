import { useRef, useSyncExternalStore, type ReactNode } from 'react'
import { getCvStatus, loadOpenCv, subscribeCvStatus } from '../lib/opencv'
import { BackIcon } from './Icons'

export function Spinner({ className = 'size-6' }: { className?: string }) {
  return (
    <span
      className={`inline-block animate-spin rounded-full border-2 border-current border-r-transparent ${className}`}
      role="status"
      aria-label="Loading"
    />
  )
}

export function useCvStatus() {
  return useSyncExternalStore(subscribeCvStatus, getCvStatus)
}

/** Floating notice while OpenCV is downloading / initialising. */
export function CvBanner() {
  const status = useCvStatus()
  if (status !== 'loading' && status !== 'error') return null
  return (
    <div className="pointer-events-none fixed inset-x-0 top-[calc(env(safe-area-inset-top)+4.25rem)] z-50 flex justify-center px-4">
      <div className="pointer-events-auto flex items-center gap-3 rounded-full bg-slate-800/95 px-4 py-2 text-sm text-slate-100 shadow-lg ring-1 ring-white/10 backdrop-blur">
        {status === 'loading' ? (
          <>
            <Spinner className="size-4 text-cyan-400" />
            Loading scanner engine…
          </>
        ) : (
          <>
            <span>Couldn’t load scanner engine.</span>
            <button className="font-semibold text-cyan-400" onClick={() => void loadOpenCv().catch(() => {})}>
              Retry
            </button>
          </>
        )}
      </div>
    </div>
  )
}

export function Header({
  title,
  onBack,
  right,
}: {
  title: ReactNode
  onBack?: () => void
  right?: ReactNode
}) {
  return (
    <header className="sticky top-0 z-30 flex h-[calc(env(safe-area-inset-top)+3.5rem)] items-end bg-slate-900/90 px-2 pb-1 backdrop-blur">
      <div className="flex h-12 w-full items-center gap-1">
        {onBack ? (
          <button className="icon-btn" onClick={onBack} aria-label="Back">
            <BackIcon />
          </button>
        ) : (
          <span className="w-2" />
        )}
        <h1 className="min-w-0 flex-1 truncate text-lg font-semibold">{title}</h1>
        {right}
      </div>
    </header>
  )
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T
  options: { id: T; label: string }[]
  onChange: (v: T) => void
}) {
  return (
    <div className="grid auto-cols-fr grid-flow-col gap-1 rounded-xl bg-slate-800 p-1" role="radiogroup">
      {options.map((o) => (
        <button
          key={o.id}
          role="radio"
          aria-checked={value === o.id}
          onClick={() => onChange(o.id)}
          className={`rounded-lg px-2 py-2 text-sm font-medium transition ${
            value === o.id ? 'bg-slate-100 text-slate-900 shadow' : 'text-slate-300 active:bg-slate-700'
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

/** Hidden <input type=file>; call open() from a click handler. */
export function useFilePicker(onFiles: (files: File[]) => void, opts: { multiple?: boolean; capture?: boolean } = {}) {
  const ref = useRef<HTMLInputElement>(null)
  const input = (
    <input
      ref={ref}
      type="file"
      accept="image/*"
      className="hidden"
      multiple={opts.multiple}
      {...(opts.capture ? { capture: 'environment' } : {})}
      onChange={(e) => {
        const files = Array.from(e.target.files ?? [])
        e.target.value = ''
        if (files.length) onFiles(files)
      }}
    />
  )
  return { input, open: () => ref.current?.click() }
}
