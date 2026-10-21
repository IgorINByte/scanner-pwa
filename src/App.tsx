import { useCallback, useEffect, useState } from 'react'
import { CvBanner, Spinner } from './components/ui'
import { prepareImage, type PreparedImage } from './lib/image'
import { loadOpenCv } from './lib/opencv'
import { usePages } from './lib/usePages'
import CameraScreen from './screens/CameraScreen'
import EditScreen from './screens/EditScreen'
import ExportScreen from './screens/ExportScreen'
import HomeScreen from './screens/HomeScreen'
import PagesScreen from './screens/PagesScreen'
import type { ScanMode } from './types'

export type Screen =
  | { name: 'home' }
  | { name: 'camera' }
  | { name: 'pages' }
  | { name: 'edit'; id: string }
  | { name: 'export' }

const MODE_KEY = 'scanner.mode'

function readMode(): ScanMode {
  try {
    return localStorage.getItem(MODE_KEY) === 'multi' ? 'multi' : 'single'
  } catch {
    return 'single'
  }
}

/** Starts fetching OpenCV in the background; failures surface via the banner's Retry. */
const warmUpCv = () => void loadOpenCv().catch(() => {})

export default function App() {
  const pagesApi = usePages()
  const { pages, addImages, clear } = pagesApi
  const [screen, setScreen] = useState<Screen>({ name: 'home' })
  const [mode, setModeState] = useState<ScanMode>(readMode)
  const [busy, setBusy] = useState<string | null>(null)

  // Screens are mirrored into browser history so the Android back button / iOS swipe work.
  useEffect(() => {
    history.replaceState({ screen: { name: 'home' } }, '')
    const onPop = (e: PopStateEvent) => setScreen((e.state?.screen as Screen) ?? { name: 'home' })
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])

  const navigate = useCallback((s: Screen, replace = false) => {
    if (replace) history.replaceState({ screen: s }, '')
    else history.pushState({ screen: s }, '')
    setScreen(s)
  }, [])
  const back = useCallback(() => history.back(), [])

  const setMode = (m: ScanMode) => {
    setModeState(m)
    try {
      localStorage.setItem(MODE_KEY, m)
    } catch {
      // ignore
    }
  }

  /** Where to go after new pages were added from `from`. */
  const afterAdd = (ids: string[], from: 'camera' | 'other') => {
    if (!ids.length) return
    const replace = from === 'camera' || screen.name !== 'home'
    if (mode === 'single' && ids.length === 1 && pages.length === 0) navigate({ name: 'edit', id: ids[0] }, replace)
    else if (screen.name !== 'pages') navigate({ name: 'pages' }, replace)
  }

  const importFiles = async (files: File[]) => {
    warmUpCv()
    setBusy(files.length > 1 ? `Importing ${files.length} images…` : 'Importing image…')
    const prepared: PreparedImage[] = []
    for (const f of files) {
      try {
        prepared.push(await prepareImage(f))
      } catch (e) {
        console.warn('Could not read image', f.name, e)
      }
    }
    setBusy(null)
    if (!prepared.length) {
      alert('Could not read the selected image(s).')
      return
    }
    afterAdd(addImages(prepared), 'other')
  }

  const onCapture = (img: PreparedImage) => {
    const ids = addImages([img])
    if (mode === 'single') afterAdd(ids, 'camera')
  }

  const startNew = (then: () => void) => {
    if (pages.length && !confirm('Start a new scan? The current unsaved pages will be discarded.')) return
    clear()
    then()
  }

  const finish = () => {
    clear()
    navigate({ name: 'home' }, true)
  }

  let content
  switch (screen.name) {
    case 'home':
      content = (
        <HomeScreen
          mode={mode}
          onModeChange={setMode}
          currentPages={pages.length}
          onScan={() =>
            startNew(() => {
              warmUpCv()
              navigate({ name: 'camera' })
            })
          }
          onImport={(files) => startNew(() => void importFiles(files))}
          onContinue={() => navigate({ name: 'pages' })}
          onDiscard={() => confirm('Discard the current scan?') && clear()}
        />
      )
      break
    case 'camera':
      content = (
        <CameraScreen
          mode={mode}
          pageCount={pages.length}
          lastThumb={pages.at(-1)?.thumbUrl}
          onCapture={onCapture}
          onImport={importFiles}
          onDone={() => (pages.length ? navigate({ name: 'pages' }, true) : back())}
          onClose={back}
        />
      )
      break
    case 'pages':
      content = (
        <PagesScreen
          api={pagesApi}
          onBack={back}
          onEdit={(id) => navigate({ name: 'edit', id })}
          onCamera={() => {
            warmUpCv()
            navigate({ name: 'camera' })
          }}
          onImport={importFiles}
          onExport={() => navigate({ name: 'export' })}
        />
      )
      break
    case 'edit': {
      const page = pages.find((p) => p.id === screen.id)
      content = page ? (
        <EditScreen
          key={page.id}
          page={page}
          index={pages.indexOf(page)}
          total={pages.length}
          api={pagesApi}
          onDone={() => navigate({ name: 'pages' }, true)}
          onDeleted={() => (pages.length > 1 ? navigate({ name: 'pages' }, true) : navigate({ name: 'home' }, true))}
        />
      ) : (
        <Redirect to={() => navigate(pages.length ? { name: 'pages' } : { name: 'home' }, true)} />
      )
      break
    }
    case 'export':
      content = pages.length ? (
        <ExportScreen pages={pages} onBack={back} onFinish={finish} />
      ) : (
        <Redirect to={() => navigate({ name: 'home' }, true)} />
      )
      break
  }

  return (
    <div className="min-h-dvh bg-slate-900 text-slate-100">
      {content}
      <CvBanner />
      {busy && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-950/70 backdrop-blur-sm">
          <div className="flex items-center gap-3 rounded-2xl bg-slate-800 px-5 py-4 shadow-xl">
            <Spinner className="size-5 text-cyan-400" />
            <span>{busy}</span>
          </div>
        </div>
      )}
    </div>
  )
}

function Redirect({ to }: { to: () => void }) {
  useEffect(() => to(), [to])
  return null
}
