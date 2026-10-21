import { useCallback, useEffect, useState } from 'react'
import { DialogProvider } from './components/dialogs'
import { CvBanner } from './components/ui'
import { requestPersistence } from './lib/storage/repository'
import EditorScreen from './screens/EditorScreen'
import LibraryScreen from './screens/LibraryScreen'
import type { ScanMode } from './types'

export type Overlay = 'camera' | 'export' | null

export type Screen = { name: 'library' } | { name: 'editor'; docId: string; overlay: Overlay; startTab?: string }

const MODE_KEY = 'scanner.mode'

function readMode(): ScanMode {
  try {
    return localStorage.getItem(MODE_KEY) === 'multi' ? 'multi' : 'single'
  } catch {
    return 'single'
  }
}

export interface Nav {
  go(s: Screen, replace?: boolean): void
  back(): void
}

export default function App() {
  const [screen, setScreen] = useState<Screen>({ name: 'library' })
  const [mode, setModeState] = useState<ScanMode>(readMode)

  // Screens are mirrored into browser history so the Android back button / iOS swipe work.
  useEffect(() => {
    history.replaceState({ screen: { name: 'library' } }, '')
    const onPop = (e: PopStateEvent) => setScreen((e.state?.screen as Screen) ?? { name: 'library' })
    window.addEventListener('popstate', onPop)
    void requestPersistence()
    return () => window.removeEventListener('popstate', onPop)
  }, [])

  const go = useCallback((s: Screen, replace = false) => {
    if (replace) history.replaceState({ screen: s }, '')
    else history.pushState({ screen: s }, '')
    setScreen(s)
  }, [])
  const back = useCallback(() => history.back(), [])
  const nav: Nav = { go, back }

  const setMode = (m: ScanMode) => {
    setModeState(m)
    try {
      localStorage.setItem(MODE_KEY, m)
    } catch {
      // ignore
    }
  }

  return (
    <DialogProvider>
      <div className="min-h-dvh bg-slate-900 text-slate-100">
        {screen.name === 'library' ? (
          <LibraryScreen nav={nav} mode={mode} onModeChange={setMode} />
        ) : (
          <EditorScreen key={screen.docId} screen={screen} nav={nav} mode={mode} />
        )}
        <CvBanner />
      </div>
    </DialogProvider>
  )
}
