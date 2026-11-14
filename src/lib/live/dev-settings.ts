// Developer options (per device, localStorage). Off by default; every access is guarded
// because storage can be unavailable (private mode, blocked site data).
export type LiveBenchModel = 'off' | 'lcnet050' | 'lean'

const KEY = 'dev.liveBench'

export function getLiveBench(): LiveBenchModel {
  try {
    const v = localStorage.getItem(KEY)
    return v === 'lcnet050' || v === 'lean' ? v : 'off'
  } catch {
    return 'off'
  }
}

export function setLiveBench(v: LiveBenchModel) {
  try {
    localStorage.setItem(KEY, v)
  } catch {
    // Not persisted; the option simply stays off next time.
  }
}
