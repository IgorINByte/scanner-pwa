import {
  closestCenter,
  DndContext,
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
import { rectSortingStrategy, SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { AlertIcon, CheckIcon, OcrIcon, PdfIcon } from '../components/Icons'
import { Spinner } from '../components/ui'
import type { Thumb } from '../lib/document/useProcessing'
import { pageKey } from '../lib/render'
import type { Page } from '../types'

export interface PageListProps {
  pages: Page[]
  thumbs: Record<string, Thumb>
  errors: Record<string, string>
  currentId: string | undefined
  selected: Set<string>
  selecting: boolean
  layout: 'grid' | 'rail'
  onOpen: (id: string) => void
  onToggle: (id: string) => void
  onMove: (from: number, to: number) => void
  onRetry: (id: string) => void
}

export function pageStatus(p: Page, thumb: Thumb | undefined, error: string | undefined) {
  if (error) return { kind: 'error' as const, label: 'Failed' }
  if (p.kind === 'scan' && !p.corners) return { kind: 'busy' as const, label: 'Detecting edges' }
  if (!thumb || thumb.key !== pageKey(p)) return { kind: 'busy' as const, label: 'Processing' }
  return { kind: 'ready' as const, label: 'Ready' }
}

export default function PageList(props: PageListProps) {
  const { pages, layout, onMove } = props
  // Long-press to drag on touch so normal scrolling still works.
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )
  const onDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return
    onMove(
      pages.findIndex((p) => p.id === active.id),
      pages.findIndex((p) => p.id === over.id),
    )
  }
  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
      <SortableContext items={pages.map((p) => p.id)} strategy={layout === 'grid' ? rectSortingStrategy : verticalListSortingStrategy}>
        <ul
          className={layout === 'grid' ? 'grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5' : 'space-y-3'}
          aria-label="Pages"
        >
          {pages.map((p, i) => (
            <Tile key={p.id} page={p} index={i} {...props} />
          ))}
        </ul>
      </SortableContext>
    </DndContext>
  )
}

function Tile({
  page,
  index,
  thumbs,
  errors,
  currentId,
  selected,
  selecting,
  layout,
  onOpen,
  onToggle,
  onRetry,
}: PageListProps & { page: Page; index: number }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: page.id })
  const thumb = thumbs[page.id]
  const status = pageStatus(page, thumb, errors[page.id])
  const isSelected = selected.has(page.id)
  const isCurrent = currentId === page.id
  const ocrStale = page.ocr && page.ocr.source === 'ocr' && page.ocr.key !== pageKey(page)

  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={`relative touch-manipulation select-none ${isDragging ? 'z-10 opacity-80' : ''}`}
      {...attributes}
      {...listeners}
      aria-roledescription="sortable page"
    >
      <button
        className={`relative block w-full overflow-hidden rounded-xl bg-slate-800 shadow-lg ring-2 transition ${
          layout === 'grid' ? 'aspect-[3/4]' : 'aspect-[3/4]'
        } ${isSelected ? 'ring-cyan-400' : isCurrent && layout === 'rail' ? 'ring-slate-300' : 'ring-transparent'}`}
        onClick={() => (selecting ? onToggle(page.id) : onOpen(page.id))}
        aria-label={`Page ${index + 1}, ${status.label}${isSelected ? ', selected' : ''}`}
        aria-current={isCurrent ? 'page' : undefined}
      >
        {thumb && <img src={thumb.url} alt="" draggable={false} className="size-full object-contain" />}
        {status.kind === 'busy' && (
          <span className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-slate-900/50 text-[11px] text-slate-200">
            <Spinner className="size-6 text-cyan-400" />
            {status.label}
          </span>
        )}
        {status.kind === 'error' && (
          <span className="absolute inset-0 flex flex-col items-center justify-center gap-1 bg-red-950/70 p-2 text-center text-[11px] text-red-100">
            <AlertIcon width={20} />
            {errors[page.id]}
          </span>
        )}
      </button>

      <span className="pointer-events-none absolute bottom-2 left-2 flex items-center gap-1">
        <span className="rounded-md bg-slate-950/85 px-2 py-0.5 text-xs font-semibold">{index + 1}</span>
        {page.kind === 'pdf' && (
          <span className="rounded-md bg-slate-950/85 p-0.5" title="PDF page">
            <PdfIcon width={14} height={14} />
          </span>
        )}
        {page.ocr && (
          <span className={`rounded-md bg-slate-950/85 p-0.5 ${ocrStale ? 'text-amber-300' : 'text-emerald-300'}`} title={ocrStale ? 'Text recognised before the last edit' : 'Text recognised'}>
            <OcrIcon width={14} height={14} />
          </span>
        )}
      </span>

      {status.kind === 'error' && (
        <button
          className="absolute right-2 bottom-2 rounded-md bg-red-500 px-2 py-0.5 text-xs font-semibold"
          onClick={() => onRetry(page.id)}
          onMouseDown={(e) => e.stopPropagation()}
          onTouchStart={(e) => e.stopPropagation()}
        >
          Retry
        </button>
      )}

      {(selecting || isSelected) && (
        <button
          className={`absolute top-2 right-2 flex size-7 items-center justify-center rounded-full ring-2 ${
            isSelected ? 'bg-cyan-400 text-slate-950 ring-cyan-400' : 'bg-slate-950/70 ring-white/70'
          }`}
          onClick={() => onToggle(page.id)}
          onMouseDown={(e) => e.stopPropagation()}
          onTouchStart={(e) => e.stopPropagation()}
          aria-label={isSelected ? `Deselect page ${index + 1}` : `Select page ${index + 1}`}
          aria-pressed={isSelected}
        >
          {isSelected && <CheckIcon width={16} height={16} />}
        </button>
      )}
    </li>
  )
}
