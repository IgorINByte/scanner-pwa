import type { ReactNode } from 'react'
import { ChevronRightIcon, BackIcon } from '../components/Icons'

/** Workspace + tool panel: panel on the right on desktop, at the bottom on phones. */
export function ToolLayout({ canvas, panel, top }: { canvas: ReactNode; panel: ReactNode; top?: ReactNode }) {
  return (
    <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
      <div className="relative flex min-h-0 min-w-0 flex-1 flex-col">
        {top}
        <div className="relative min-h-0 flex-1">{canvas}</div>
      </div>
      <aside className="max-h-[42dvh] shrink-0 overflow-y-auto border-t border-white/5 bg-slate-900 px-4 pt-3 pb-4 lg:max-h-none lg:w-80 lg:border-t-0 lg:border-l lg:pt-4">
        {panel}
      </aside>
    </div>
  )
}

/** "‹ Page 2 of 5 ›" switcher shown above the workspace. */
export function PageNav({ index, total, onPrev, onNext, extra }: { index: number; total: number; onPrev: () => void; onNext: () => void; extra?: ReactNode }) {
  return (
    <div className="flex h-11 shrink-0 items-center gap-1 border-b border-white/5 px-2 text-sm">
      <button className="icon-btn size-9" onClick={onPrev} disabled={index <= 0} aria-label="Previous page">
        <BackIcon width={18} />
      </button>
      <span className="min-w-24 text-center tabular-nums text-slate-300">
        Page {index + 1} of {total}
      </span>
      <button className="icon-btn size-9" onClick={onNext} disabled={index >= total - 1} aria-label="Next page">
        <ChevronRightIcon width={18} />
      </button>
      <div className="ml-auto flex items-center gap-1">{extra}</div>
    </div>
  )
}

export function Notice({ tone = 'info', children }: { tone?: 'info' | 'warn' | 'ok'; children: ReactNode }) {
  const cls =
    tone === 'warn'
      ? 'bg-amber-400/10 text-amber-200 ring-amber-400/20'
      : tone === 'ok'
        ? 'bg-emerald-400/10 text-emerald-200 ring-emerald-400/20'
        : 'bg-slate-800 text-slate-300 ring-white/5'
  return <div className={`rounded-xl p-3 text-xs leading-relaxed ring-1 ${cls}`}>{children}</div>
}
