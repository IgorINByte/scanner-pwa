import { useEffect, useRef, useState } from 'react'
import { CameraIcon, CheckIcon, CloseIcon, ImageIcon } from '../components/Icons'
import { Spinner, useFilePicker } from '../components/ui'
import { prepareImage, type PreparedImage } from '../lib/image'
import type { ScanMode } from '../types'

interface Props {
  mode: ScanMode
  pageCount: number
  lastThumb?: string
  onCapture: (img: PreparedImage) => void
  onImport: (files: File[]) => void
  onDone: () => void
  onClose: () => void
}

type CamState = 'starting' | 'live' | 'unavailable'

export default function CameraScreen({ mode, pageCount, lastThumb, onCapture, onImport, onDone, onClose }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const [state, setState] = useState<CamState>('starting')
  const [error, setError] = useState('')
  const [shooting, setShooting] = useState(false)
  const [flash, setFlash] = useState(0)
  const nativeCamera = useFilePicker(onImport, { capture: true })
  const gallery = useFilePicker(onImport, { multiple: true })

  useEffect(() => {
    let stream: MediaStream | undefined
    let cancelled = false
    async function start() {
      if (!navigator.mediaDevices?.getUserMedia) {
        setError(window.isSecureContext ? 'Camera is not supported in this browser.' : 'Camera requires HTTPS.')
        setState('unavailable')
        return
      }
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: { facingMode: { ideal: 'environment' }, width: { ideal: 3840 }, height: { ideal: 2160 } },
        })
        if (cancelled) return stream.getTracks().forEach((t) => t.stop())
        const video = videoRef.current!
        video.srcObject = stream
        await video.play()
        setState('live')
      } catch (e) {
        if (cancelled) return
        console.warn('getUserMedia failed', e)
        const name = e instanceof DOMException ? e.name : ''
        setError(
          name === 'NotAllowedError'
            ? 'Camera access was denied. Allow it in your browser settings, or use the system camera below.'
            : 'Could not start the camera.',
        )
        setState('unavailable')
      }
    }
    void start()
    return () => {
      cancelled = true
      stream?.getTracks().forEach((t) => t.stop())
    }
  }, [])

  const shoot = async () => {
    const video = videoRef.current
    if (!video || shooting || !video.videoWidth) return
    setShooting(true)
    setFlash((f) => f + 1)
    try {
      onCapture(await prepareImage(video))
    } finally {
      setShooting(false)
    }
  }

  return (
    <div className="fixed inset-0 z-40 flex flex-col bg-black text-white">
      {nativeCamera.input}
      {gallery.input}

      <div className="relative flex-1 overflow-hidden">
        <video ref={videoRef} playsInline muted autoPlay className="absolute inset-0 size-full object-cover" />
        {flash > 0 && <div key={flash} className="animate-flash pointer-events-none absolute inset-0 bg-white" />}

        {state === 'starting' && (
          <div className="absolute inset-0 flex items-center justify-center">
            <Spinner className="size-8 text-white/70" />
          </div>
        )}

        {state === 'unavailable' && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 px-8 text-center">
            <CameraIcon className="size-12 text-slate-500" />
            <p className="text-slate-300">{error}</p>
            <button className="btn-primary w-full max-w-xs" onClick={nativeCamera.open}>
              <CameraIcon />
              Take photo
            </button>
            <button className="btn-secondary w-full max-w-xs" onClick={gallery.open}>
              <ImageIcon />
              Choose from gallery
            </button>
          </div>
        )}

        {state === 'live' && (
          // Framing guide
          <div className="pointer-events-none absolute inset-x-[8%] top-[10%] bottom-[10%] rounded-xl border-2 border-dashed border-white/30" />
        )}

        <div className="absolute inset-x-0 top-0 flex items-center justify-between px-3 pt-[calc(env(safe-area-inset-top)+0.5rem)]">
          <button className="icon-btn bg-black/40" onClick={onClose} aria-label="Close camera">
            <CloseIcon />
          </button>
          <span className="rounded-full bg-black/50 px-3 py-1 text-sm font-medium">
            {mode === 'multi' ? 'Multi-page' : 'Single page'}
          </span>
          <span className="size-11" />
        </div>
      </div>

      <div className="flex items-center justify-between bg-black px-6 pt-5 pb-[calc(env(safe-area-inset-bottom)+1.25rem)]">
        <button className="icon-btn size-12" onClick={gallery.open} aria-label="Import from gallery">
          <ImageIcon width={26} height={26} />
        </button>

        <button
          className="relative flex size-20 items-center justify-center rounded-full border-4 border-white disabled:opacity-40"
          onClick={() => void shoot()}
          disabled={state !== 'live' || shooting}
          aria-label="Take photo"
        >
          <span className="size-16 rounded-full bg-white transition active:scale-90" />
          {shooting && <Spinner className="absolute size-8 text-slate-900" />}
        </button>

        {mode === 'multi' ? (
          <button
            className="relative flex h-14 w-12 items-center justify-center overflow-hidden rounded-lg bg-slate-800 ring-2 ring-white/60 disabled:opacity-30"
            onClick={onDone}
            disabled={pageCount === 0}
            aria-label={`Done, ${pageCount} pages`}
          >
            {lastThumb ? (
              <img src={lastThumb} alt="" className="size-full object-cover" />
            ) : (
              <CheckIcon />
            )}
            {pageCount > 0 && (
              <span className="absolute -top-0 -right-0 min-w-6 rounded-bl-lg bg-cyan-500 px-1 text-center text-sm font-bold text-slate-950">
                {pageCount}
              </span>
            )}
          </button>
        ) : (
          <span className="w-12" />
        )}
      </div>
      {mode === 'multi' && pageCount > 0 && (
        <div className="pointer-events-none absolute inset-x-0 bottom-[calc(env(safe-area-inset-bottom)+7.5rem)] text-center text-sm">
          <span className="rounded-full bg-black/60 px-3 py-1">
            {pageCount} page{pageCount === 1 ? '' : 's'} · tap the stack when done
          </span>
        </div>
      )}
    </div>
  )
}
