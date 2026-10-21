// Promise-based confirm / prompt / choose dialogs and toasts (accessible, styled,
// and unlike window.confirm they work the same in installed iOS PWAs).
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { AlertIcon, CheckIcon, CloseIcon, InfoIcon } from './Icons'

interface ConfirmOpts {
  title: string
  message?: ReactNode
  confirmLabel?: string
  danger?: boolean
}

interface PromptOpts {
  title: string
  message?: ReactNode
  label?: string
  initial?: string
  placeholder?: string
  confirmLabel?: string
  type?: 'text' | 'password'
  multiline?: boolean
}

interface ChooseOpts<T> {
  title: string
  options: { value: T; label: string }[]
}

type Toast = { id: number; kind: 'success' | 'error' | 'info'; text: string; action?: { label: string; run: () => void } }

interface DialogApi {
  confirm(o: ConfirmOpts): Promise<boolean>
  prompt(o: PromptOpts): Promise<string | null>
  choose<T>(o: ChooseOpts<T>): Promise<T | null>
  toast(text: string, kind?: Toast['kind'], action?: Toast['action']): void
}

const Ctx = createContext<DialogApi | null>(null)

export function useDialogs() {
  const api = useContext(Ctx)
  if (!api) throw new Error('DialogProvider missing')
  return api
}

type Open =
  | { kind: 'confirm'; o: ConfirmOpts; resolve: (v: boolean) => void }
  | { kind: 'prompt'; o: PromptOpts; resolve: (v: string | null) => void }
  | { kind: 'choose'; o: ChooseOpts<unknown>; resolve: (v: unknown) => void }

export function DialogProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState<Open | null>(null)
  const [toasts, setToasts] = useState<Toast[]>([])
  const nextId = useRef(1)

  const api = useRef<DialogApi>({
    confirm: (o) => new Promise((resolve) => setOpen({ kind: 'confirm', o, resolve })),
    prompt: (o) => new Promise((resolve) => setOpen({ kind: 'prompt', o, resolve })),
    choose: <T,>(o: ChooseOpts<T>) =>
      new Promise<T | null>((resolve) =>
        setOpen({ kind: 'choose', o: o as ChooseOpts<unknown>, resolve: resolve as (v: unknown) => void }),
      ),
    toast: (text, kind = 'info', action) => {
      const id = nextId.current++
      setToasts((t) => [...t.slice(-2), { id, kind, text, action }])
      setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), action ? 7000 : 4000)
    },
  }).current

  const close = useCallback(
    (value: unknown) => {
      if (!open) return
      ;(open.resolve as (v: unknown) => void)(value)
      setOpen(null)
    },
    [open],
  )

  return (
    <Ctx.Provider value={api}>
      {children}
      {open && (
        <Modal onClose={() => close(open.kind === 'confirm' ? false : null)} title={open.o.title}>
          {open.kind === 'confirm' && <ConfirmBody o={open.o} onDone={close} />}
          {open.kind === 'prompt' && <PromptBody o={open.o} onDone={close} />}
          {open.kind === 'choose' && (
            <div className="space-y-1.5">
              {open.o.options.map((opt, i) => (
                <button key={i} className="btn-secondary w-full justify-start" onClick={() => close(opt.value)}>
                  {opt.label}
                </button>
              ))}
              <button className="btn-ghost mt-2 w-full" onClick={() => close(null)}>
                Cancel
              </button>
            </div>
          )}
        </Modal>
      )}
      <div
        className="pointer-events-none fixed inset-x-0 bottom-[calc(env(safe-area-inset-bottom)+5.5rem)] z-[80] flex flex-col items-center gap-2 px-4"
        aria-live="polite"
      >
        {toasts.map((t) => (
          <div
            key={t.id}
            role={t.kind === 'error' ? 'alert' : 'status'}
            className={`pointer-events-auto flex max-w-md items-center gap-3 rounded-xl px-4 py-3 text-sm shadow-xl ring-1 ${
              t.kind === 'error'
                ? 'bg-red-950 text-red-100 ring-red-500/40'
                : t.kind === 'success'
                  ? 'bg-emerald-950 text-emerald-100 ring-emerald-500/40'
                  : 'bg-slate-800 text-slate-100 ring-white/10'
            }`}
          >
            {t.kind === 'error' ? <AlertIcon width={18} /> : t.kind === 'success' ? <CheckIcon width={18} /> : <InfoIcon width={18} />}
            <span className="flex-1">{t.text}</span>
            {t.action && (
              <button
                className="font-semibold text-cyan-300"
                onClick={() => {
                  t.action!.run()
                  setToasts((x) => x.filter((y) => y.id !== t.id))
                }}
              >
                {t.action.label}
              </button>
            )}
          </div>
        ))}
      </div>
    </Ctx.Provider>
  )
}

function ConfirmBody({ o, onDone }: { o: ConfirmOpts; onDone: (v: boolean) => void }) {
  return (
    <>
      {o.message && <div className="mb-5 text-sm text-slate-300">{o.message}</div>}
      <div className="flex justify-end gap-2">
        <button className="btn-secondary" onClick={() => onDone(false)}>
          Cancel
        </button>
        <button className={o.danger ? 'btn-danger' : 'btn-primary'} onClick={() => onDone(true)} autoFocus>
          {o.confirmLabel ?? 'OK'}
        </button>
      </div>
    </>
  )
}

function PromptBody({ o, onDone }: { o: PromptOpts; onDone: (v: string | null) => void }) {
  const [value, setValue] = useState(o.initial ?? '')
  const field = useRef<HTMLInputElement & HTMLTextAreaElement>(null)
  // Focus after the triggering pointer gesture has finished (autoFocus can lose to its mouseup/click).
  useEffect(() => {
    const t = setTimeout(() => {
      field.current?.focus()
      if (o.type !== 'password') field.current?.select()
    }, 60)
    return () => clearTimeout(t)
  }, [o.type])
  const submit = () => onDone(value)
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        submit()
      }}
    >
      {o.message && <div className="mb-3 text-sm text-slate-300">{o.message}</div>}
      <label className="mb-5 block">
        {o.label && <span className="mb-1.5 block text-sm text-slate-300">{o.label}</span>}
        {o.multiline ? (
          <textarea ref={field} className="field min-h-28" value={value} placeholder={o.placeholder} onChange={(e) => setValue(e.target.value)} />
        ) : (
          <input
            ref={field}
            className="field"
            type={o.type ?? 'text'}
            value={value}
            placeholder={o.placeholder}
            onChange={(e) => setValue(e.target.value)}
            autoComplete={o.type === 'password' ? 'current-password' : 'off'}
          />
        )}
      </label>
      <div className="flex justify-end gap-2">
        <button type="button" className="btn-secondary" onClick={() => onDone(null)}>
          Cancel
        </button>
        <button type="submit" className="btn-primary">
          {o.confirmLabel ?? 'OK'}
        </button>
      </div>
    </form>
  )
}

export function Modal({
  title,
  onClose,
  children,
  wide,
}: {
  title: ReactNode
  onClose: () => void
  children: ReactNode
  wide?: boolean
}) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  return (
    <div
      className="fixed inset-0 z-[70] flex items-end justify-center bg-slate-950/70 backdrop-blur-sm sm:items-center sm:p-4"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-label={typeof title === 'string' ? title : undefined}
        className={`max-h-[92dvh] w-full overflow-y-auto rounded-t-2xl bg-slate-900 p-5 pb-[calc(env(safe-area-inset-bottom)+1.25rem)] shadow-2xl ring-1 ring-white/10 sm:rounded-2xl sm:pb-5 ${
          wide ? 'sm:max-w-3xl' : 'sm:max-w-md'
        }`}
      >
        <div className="mb-4 flex items-start gap-3">
          <h2 className="flex-1 text-lg font-semibold">{title}</h2>
          <button className="icon-btn -mt-2 -mr-2 text-slate-400" onClick={onClose} aria-label="Close">
            <CloseIcon />
          </button>
        </div>
        {children}
      </div>
    </div>
  )
}
