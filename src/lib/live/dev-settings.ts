// Per-device camera preferences (localStorage). Every access is guarded because storage can be
// unavailable (private mode, blocked site data); the defaults then apply.
function read(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

function write(key: string, value: string) {
  try {
    localStorage.setItem(key, value)
  } catch {
    // Not persisted; the default applies next time.
  }
}

const STATS_KEY = 'dev.liveStats'
const SHUTTER_KEY = 'camera.shutter'

/** Developer option: show det/s and ms of live tracking in the camera. Off by default. */
export const getLiveStats = () => read(STATS_KEY) === '1'
export const setLiveStats = (on: boolean) => write(STATS_KEY, on ? '1' : '0')

export type ShutterMode = 'auto' | 'manual'
/** Auto-shutter on by default. */
export const getShutterMode = (): ShutterMode => (read(SHUTTER_KEY) === 'manual' ? 'manual' : 'auto')
export const setShutterMode = (m: ShutterMode) => write(SHUTTER_KEY, m)
