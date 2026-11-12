// ML corner detector (scanic, DocCornerNet model). The model and the ONNX Runtime wasm are
// self-hosted under public/scanic-ml/ (precached by the service worker), never fetched
// from a CDN. Runs wherever it is called from: normally inside the detection worker.
import { Scanner } from 'scanic'
import type { Corners } from '../../types'

/** Absolute URL of the self-hosted scanic-ml assets (works under the /scanner-pwa/ base). */
const assetBaseUrl = () => new URL(`${import.meta.env.BASE_URL}scanic-ml/`, self.location.href).href

let scanner: Scanner | null = null

function getScanner() {
  scanner ??= new Scanner({ detector: 'ml', ml: { assetBaseUrl: assetBaseUrl() } })
  return scanner
}

/** Fetches and compiles the model and runtime ahead of the first scan. */
export async function initModel(): Promise<void> {
  try {
    await getScanner().initialize()
  } catch (e) {
    scanner = null
    throw e
  }
}

export interface ModelResult {
  /** Corners in the source's pixels, ordered TL, TR, BR, BL. */
  corners: Corners
  /** P(document present), 0..1. */
  score: number
  /** scanic's verdict (score >= its default minScore of 0.5). */
  success: boolean
}

/** Runs the model; returns null if it produced no corners. */
export async function detectWithModel(image: ImageBitmap): Promise<ModelResult | null> {
  const r = await getScanner().scan(image, { detector: 'ml', ml: { assetBaseUrl: assetBaseUrl() } })
  if (!r.corners) return null
  const { topLeft, topRight, bottomRight, bottomLeft } = r.corners
  return { corners: [topLeft, topRight, bottomRight, bottomLeft], score: r.score ?? 0, success: r.success }
}
