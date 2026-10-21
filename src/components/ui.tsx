import { useRef, useSyncExternalStore, type ReactNode } from 'react'
import { getCvStatus, loadOpenCv, subscribeCvStatus } from '../lib/opencv'

export function Spinner({ className = 'size-6' }: { className?: string }) {
  return (
    <span
      className={`inline-block animate-spin rounded-full border-2 border-current border-r-transparent ${className}`}
      role="status"
      aria-label="Loading"
    />
  )
}

export function ProgressBar({ value, label }: { value: number; label?: string }) {
  return (
    <div className="w-full">
      {label && <div className="mb-1.5 text-sm text-slate-300">{label}</div>}
      <div
        className="h-2 overflow-hidden rounded-full bg-slate-800"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(value * 100)}
      >
        <div className="h-full rounded-full bg-cyan-400 transition-[width]" style={{ width: `${Math.max(2, value * 100)}%` }} />
      </div>
    </div>
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
            <span>Couldn’t load the edge detector.</span>
            <button className="font-semibold text-cyan-400" onClick={() => void loadOpenCv().catch(() => {})}>
              Retry
            </button>
          </>
        )}
      </div>
    </div>
  )
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: T
  options: { id: T; label: string; disabled?: boolean }[]
  onChange: (v: T) => void
  label?: string
}) {
  return (
    <div className="grid auto-cols-fr grid-flow-col gap-1 rounded-xl bg-slate-800 p-1" role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button
          key={o.id}
          type="button"
          role="radio"
          aria-checked={value === o.id}
          disabled={o.disabled}
          onClick={() => onChange(o.id)}
          className={`rounded-lg px-2 py-2 text-sm font-medium transition disabled:opacity-40 ${
            value === o.id ? 'bg-slate-100 text-slate-900 shadow' : 'text-slate-300 active:bg-slate-700'
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

export function Slider({
  label,
  value,
  min,
  max,
  onChange,
  format = (v) => String(v),
}: {
  label: string
  value: number
  min: number
  max: number
  onChange: (v: number) => void
  format?: (v: number) => string
}) {
  return (
    <label className="block">
      <span className="mb-1 flex justify-between text-sm">
        <span className="text-slate-300">{label}</span>
        <span className="tabular-nums text-slate-400">{format(value)}</span>
      </span>
      <input
        type="range"
        className="range"
        min={min}
        max={max}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        onDoubleClick={() => onChange(0)}
      />
    </label>
  )
}

export function Toggle({ checked, onChange, label, hint }: { checked: boolean; onChange: (v: boolean) => void; label: ReactNode; hint?: ReactNode }) {
  return (
    <label className="flex cursor-pointer items-start gap-3 py-1.5">
      <input type="checkbox" className="peer sr-only" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span className="relative mt-0.5 inline-flex h-6 w-10 shrink-0 rounded-full bg-slate-700 transition peer-checked:bg-cyan-500 peer-focus-visible:ring-2 peer-focus-visible:ring-cyan-300 after:absolute after:top-0.5 after:left-0.5 after:size-5 after:rounded-full after:bg-white after:transition peer-checked:after:translate-x-4" />
      <span className="text-sm">
        <span className="text-slate-100">{label}</span>
        {hint && <span className="block text-xs text-slate-400">{hint}</span>}
      </span>
    </label>
  )
}

/** Hidden <input type=file>; call open() from a click handler. */
export function useFilePicker(
  onFiles: (files: File[]) => void,
  opts: { multiple?: boolean; capture?: boolean; accept?: string } = {},
) {
  const ref = useRef<HTMLInputElement>(null)
  const input = (
    <input
      ref={ref}
      type="file"
      accept={opts.accept ?? 'image/*'}
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

export function SectionTitle({ children }: { children: ReactNode }) {
  return <h3 className="mb-2 text-xs font-semibold tracking-wider text-slate-400 uppercase">{children}</h3>
}
