import type { LiveStats } from '../lib/live/useLiveBench'

const LABEL = { lcnet050: 'DocAligner lcnet050', lean: 'scanic LEAN' } as const

/** Raw (unsmoothed) live quad over an object-cover video, plus the benchmark readout. */
export default function LiveBenchOverlay({ stats, video }: { stats: LiveStats; video: HTMLVideoElement | null }) {
  let points = ''
  if (stats.corners && stats.frame && video?.videoWidth) {
    const ew = video.clientWidth
    const eh = video.clientHeight
    const k = video.videoWidth / stats.frame.width
    const s = Math.max(ew / video.videoWidth, eh / video.videoHeight)
    const ox = (ew - video.videoWidth * s) / 2
    const oy = (eh - video.videoHeight * s) / 2
    points = stats.corners.map((p) => `${ox + p.x * k * s},${oy + p.y * k * s}`).join(' ')
  }
  return (
    <>
      {points && (
        <svg className="pointer-events-none absolute inset-0 size-full">
          <polygon points={points} fill="rgba(34,211,238,0.18)" stroke="rgb(34,211,238)" strokeWidth={2} />
        </svg>
      )}
      <div className="pointer-events-none absolute top-[calc(env(safe-area-inset-top)+3.5rem)] left-3 rounded-md bg-black/70 px-2 py-1 font-mono text-[11px] leading-4 text-white">
        <div>
          {LABEL[stats.model]} · {stats.frame ? `${stats.frame.width}×${stats.frame.height}` : '—'}
        </div>
        {stats.status === 'loading' && <div>loading model…</div>}
        {stats.status === 'paused' && <div>paused</div>}
        {stats.status === 'error' && <div className="text-red-300">{stats.error}</div>}
        {stats.status === 'running' && (
          <>
            <div>{stats.fps} det/s</div>
            <div>
              model {stats.inferMs.toFixed(0)} ms · total {stats.totalMs.toFixed(0)} ms
            </div>
            {stats.loadMs !== undefined && <div>load {stats.loadMs.toFixed(0)} ms</div>}
          </>
        )}
      </div>
    </>
  )
}
