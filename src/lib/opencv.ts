// Lazy loader for OpenCV.js. The ~11 MB script is only fetched the first time it is needed.
// Detection normally loads it inside the detection worker (see imaging/detect.ts); this
// main-thread loader is the fallback for browsers without worker OffscreenCanvas.

// OpenCV.js ships without usable types for the browser build.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type CV = any
export type CvStatus = 'idle' | 'loading' | 'ready' | 'error'

let cv: CV | null = null
let loading: Promise<void> | null = null
let status: CvStatus = 'idle'
const listeners = new Set<() => void>()

/** URL of the OpenCV.js build (lazy-loaded, precached by the service worker). */
export const OPENCV_URL = `${import.meta.env.BASE_URL}vendor/opencv.js`

/**
 * Resolves an Emscripten OpenCV module once its runtime is ready. The module can itself
 * be "thenable"; that is stripped so it is never assimilated by a Promise (which hangs).
 */
export function whenCvReady(mod: CV): Promise<CV> {
  return new Promise((resolve) => {
    const done = (instance: CV) => {
      if (instance && typeof instance.then === 'function') delete instance.then
      resolve(instance)
    }
    const ready = (instance: CV) => {
      if (instance.Mat) done(instance)
      else instance.onRuntimeInitialized = () => done(instance)
    }
    if (typeof mod.then === 'function' && !mod.Mat) mod.then(ready)
    else ready(mod)
  })
}

/** Lets the detection worker facade report its OpenCV load state to the UI. */
export function setCvStatus(s: CvStatus) {
  status = s
  listeners.forEach((l) => l())
}

export function getCvStatus() {
  return status
}

export function subscribeCvStatus(listener: () => void) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** Main-thread load (fallback path). */
export function loadOpenCv(): Promise<void> {
  if (cv) return Promise.resolve()
  if (loading) return loading
  setCvStatus('loading')
  loading = new Promise<void>((resolve, reject) => {
    const script = document.createElement('script')
    const fail = (err: Error) => {
      loading = null
      script.remove()
      setCvStatus('error')
      reject(err)
    }
    script.src = OPENCV_URL
    script.async = true
    script.onload = () => {
      const mod = (window as unknown as { cv?: CV }).cv
      if (!mod) return fail(new Error('OpenCV did not initialise'))
      void whenCvReady(mod).then((instance) => {
        cv = instance
        setCvStatus('ready')
        resolve()
      })
    }
    script.onerror = () => fail(new Error('Failed to load OpenCV'))
    document.head.appendChild(script)
  })
  return loading
}

/** Returns the main-thread OpenCV instance; call loadOpenCv() first. */
export function getCv(): CV {
  if (!cv) throw new Error('OpenCV not loaded')
  return cv
}
