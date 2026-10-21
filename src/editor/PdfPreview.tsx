import { useEffect, useState } from 'react'
import { Modal } from '../components/dialogs'
import { Spinner } from '../components/ui'
import { formatBytes } from '../lib/files'
import { openPdf, renderPdfPageToCanvas } from '../lib/pdf/pdfjs'

const BATCH = 10

/** Renders a generated PDF with pdf.js, exactly as a PDF viewer would show it. */
export default function PdfPreview({ file, password, onClose }: { file: File; password?: string; onClose: () => void }) {
  const [pages, setPages] = useState<string[]>([])
  const [total, setTotal] = useState(0)
  const [limit, setLimit] = useState(BATCH)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)

  useEffect(() => {
    let cancelled = false
    const urls: string[] = []
    ;(async () => {
      try {
        const doc = await openPdf(await file.arrayBuffer(), password || undefined)
        setTotal(doc.numPages)
        for (let i = 0; i < Math.min(doc.numPages, limit); i++) {
          if (cancelled) break
          const canvas = await renderPdfPageToCanvas(doc, i, ((await doc.getPage(i + 1)).rotate + 360) % 360, 1100)
          const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/jpeg', 0.85))
          canvas.width = canvas.height = 0
          if (!blob || cancelled) continue
          const url = URL.createObjectURL(blob)
          urls.push(url)
          setPages([...urls])
        }
        setDone(true)
        await doc.loadingTask.destroy()
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Could not open the PDF')
      }
    })()
    return () => {
      cancelled = true
      urls.forEach((u) => URL.revokeObjectURL(u))
    }
  }, [file, password, limit])

  return (
    <Modal title={`Preview · ${file.name}`} onClose={onClose} wide>
      <p className="mb-3 text-xs text-slate-400">
        {total} page{total === 1 ? '' : 's'} · {formatBytes(file.size)}
        {password ? ' · password protected' : ''}
      </p>
      {error ? (
        <p className="text-sm text-red-300">{error}</p>
      ) : (
        <div className="space-y-4 rounded-xl bg-slate-950 p-3">
          {pages.map((u, i) => (
            <figure key={u} className="text-center">
              <img src={u} alt={`Page ${i + 1}`} className="mx-auto max-w-full bg-white shadow-lg" />
              <figcaption className="mt-1 text-xs text-slate-500">Page {i + 1}</figcaption>
            </figure>
          ))}
          {!done && (
            <div className="flex justify-center py-6">
              <Spinner className="size-7 text-cyan-400" />
            </div>
          )}
          {done && total > limit && (
            <button className="btn-secondary w-full" onClick={() => setLimit((l) => l + BATCH)}>
              Show more pages ({total - limit} left)
            </button>
          )}
        </div>
      )}
    </Modal>
  )
}
