// Lazy loader for OpenCV.js. The ~11 MB script is only fetched the first time it is needed.

// OpenCV.js ships without usable types for the browser build.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type CV = any
export type CvStatus = 'idle' | 'loading' | 'ready' | 'error'

let cv: CV | null = null
let loading: Promise<void> | null = null
let status: CvStatus = 'idle'
const listeners = new Set<() => void>()

function setStatus(s: CvStatus) {
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

export function loadOpenCv(): Promise<void> {
  if (cv) return Promise.resolve()
  if (loading) return loading
  setStatus('loading')
  loading = new Promise<void>((resolve, reject) => {
    const script = document.createElement('script')
    const fail = (err: Error) => {
      loading = null
      script.remove()
      setStatus('error')
      reject(err)
    }
    const done = (instance: CV) => {
      // The Emscripten module can itself be "thenable"; strip that so it is never
      // assimilated by a Promise (which would hang forever).
      if (instance && typeof instance.then === 'function') delete instance.then
      cv = instance
      setStatus('ready')
      resolve()
    }
    const whenReady = (instance: CV) => {
      if (instance.Mat) done(instance)
      else instance.onRuntimeInitialized = () => done(instance)
    }
    script.src = `${import.meta.env.BASE_URL}vendor/opencv.js`
    script.async = true
    script.onload = () => {
      const mod = (window as unknown as { cv?: CV }).cv
      if (!mod) fail(new Error('OpenCV did not initialise'))
      else if (typeof mod.then === 'function') mod.then(whenReady)
      else whenReady(mod)
    }
    script.onerror = () => fail(new Error('Failed to load OpenCV'))
    document.head.appendChild(script)
  })
  return loading
}

/** Returns the loaded OpenCV instance; call loadOpenCv() first. */
export function getCv(): CV {
  if (!cv) throw new Error('OpenCV not loaded')
  return cv
}
