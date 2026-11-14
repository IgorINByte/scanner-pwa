import type { LiveStats } from '../lib/live/useLiveTracking'

/** Developer readout of live tracking performance (Storage & privacy → Developer). */
export default function LiveBenchOverlay({ stats }: { stats: LiveStats }) {
  return (
    <div className="pointer-events-none absolute top-[calc(env(safe-area-inset-top)+3.5rem)] left-3 rounded-md bg-black/70 px-2 py-1 font-mono text-[11px] leading-4 text-white">
      <div>scanic LEAN (live)</div>
      {stats.status === 'loading' && <div>loading model…</div>}
      {stats.status === 'paused' && <div>paused</div>}
      {stats.status === 'error' && <div className="text-red-300">{stats.error}</div>}
      {stats.status === 'running' && (
        <>
          <div>
            {stats.fps} det/s · every {stats.intervalMs.toFixed(0)} ms
          </div>
          <div>
            model {stats.inferMs.toFixed(0)} ms · total {stats.totalMs.toFixed(0)} ms
          </div>
          {stats.loadMs !== undefined && <div>load {stats.loadMs.toFixed(0)} ms</div>}
          {stats.frame && stats.source && (
            <div>
              frame {stats.frame.width}×{stats.frame.height} · camera {stats.source.width}×{stats.source.height}
            </div>
          )}
          <div>
            paper {Math.round(stats.paperPx ?? 0)} / {Math.round(stats.requiredPx ?? 0)} px · found {stats.found ?? 0}/{stats.total ?? 0}
          </div>
          {stats.color && (
            <div>
              rgb {stats.color.map((c) => c.toFixed(0)).join(',')} · {stats.settled ? 'settled' : 'settling'}
            </div>
          )}
        </>
      )}
    </div>
  )
}
