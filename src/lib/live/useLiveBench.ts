// Developer readout of live tracking (det/s, ms): samples the tracker's stats a few times a
// second so the numbers do not re-render the camera on every detection.
import { useEffect, useState } from 'react'
import type { LiveStats } from './useLiveTracking'

export function useLiveBench(stats: React.RefObject<LiveStats>, enabled: boolean): LiveStats | null {
  const [snap, setSnap] = useState<LiveStats | null>(null)
  useEffect(() => {
    if (!enabled) return
    const id = window.setInterval(() => setSnap({ ...stats.current }), 250)
    return () => {
      clearInterval(id)
      setSnap(null)
    }
  }, [stats, enabled])
  return snap
}
