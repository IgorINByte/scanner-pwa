import {
  closestCenter,
  DndContext,
  MouseSensor,
  TouchSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
import { rectSortingStrategy, SortableContext, useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { CameraIcon, ImageIcon, ShareIcon, TrashIcon } from '../components/Icons'
import { Header, Spinner, useFilePicker } from '../components/ui'
import type { PagesApi } from '../lib/usePages'
import type { Page } from '../types'

interface Props {
  api: PagesApi
  onBack: () => void
  onEdit: (id: string) => void
  onCamera: () => void
  onImport: (files: File[]) => void
  onExport: () => void
}

export default function PagesScreen({ api, onBack, onEdit, onCamera, onImport, onExport }: Props) {
  const { pages, move, remove } = api
  const gallery = useFilePicker(onImport, { multiple: true })
  // Long-press to drag on touch so normal scrolling still works.
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 8 } }),
  )

  const onDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return
    move(
      pages.findIndex((p) => p.id === active.id),
      pages.findIndex((p) => p.id === over.id),
    )
  }

  return (
    <div className="flex min-h-dvh flex-col">
      {gallery.input}
      <Header
        title={`${pages.length} page${pages.length === 1 ? '' : 's'}`}
        onBack={onBack}
      />

      <main className="mx-auto w-full max-w-xl flex-1 px-4 pt-2 pb-40">
        {pages.length > 1 && (
          <p className="mb-3 text-center text-xs text-slate-500">Tap a page to edit · long-press and drag to reorder</p>
        )}
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
          <SortableContext items={pages.map((p) => p.id)} strategy={rectSortingStrategy}>
            <ul className="grid grid-cols-2 gap-4 sm:grid-cols-3">
              {pages.map((p, i) => (
                <PageTile key={p.id} page={p} index={i} onEdit={() => onEdit(p.id)} onDelete={() => remove(p.id)} />
              ))}
              <li>
                <div className="flex aspect-[3/4] flex-col overflow-hidden rounded-xl border-2 border-dashed border-slate-700">
                  <button className="flex flex-1 flex-col items-center justify-center gap-1 text-sm text-slate-300 active:bg-slate-800" onClick={onCamera}>
                    <CameraIcon />
                    Add with camera
                  </button>
                  <div className="h-px bg-slate-700" />
                  <button className="flex flex-1 flex-col items-center justify-center gap-1 text-sm text-slate-300 active:bg-slate-800" onClick={gallery.open}>
                    <ImageIcon />
                    Add from gallery
                  </button>
                </div>
              </li>
            </ul>
          </SortableContext>
        </DndContext>
      </main>

      <div className="fixed inset-x-0 bottom-0 z-20 bg-gradient-to-t from-slate-900 via-slate-900 to-transparent px-4 pt-8 pb-[calc(env(safe-area-inset-bottom)+1rem)]">
        <div className="mx-auto max-w-xl">
          <button className="btn-primary w-full" disabled={!pages.length} onClick={onExport}>
            <ShareIcon />
            Export & share
          </button>
        </div>
      </div>
    </div>
  )
}

function PageTile({ page, index, onEdit, onDelete }: { page: Page; index: number; onEdit: () => void; onDelete: () => void }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: page.id })
  const processing = !page.corners || !page.thumbUrl

  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={`relative touch-manipulation select-none ${isDragging ? 'z-10 scale-105 opacity-90' : ''}`}
      {...attributes}
      {...listeners}
    >
      <button
        className="block aspect-[3/4] w-full overflow-hidden rounded-xl bg-slate-800 shadow-lg ring-1 ring-white/10"
        onClick={onEdit}
        aria-label={`Edit page ${index + 1}`}
      >
        {page.thumbUrl && (
          <img src={page.thumbUrl} alt="" draggable={false} className="size-full object-contain" />
        )}
        {processing && (
          <span className="absolute inset-0 flex items-center justify-center rounded-xl bg-slate-900/40">
            <Spinner className="size-6 text-cyan-400" />
          </span>
        )}
      </button>
      <span className="absolute bottom-2 left-2 rounded-md bg-slate-950/80 px-2 py-0.5 text-xs font-semibold">
        {index + 1}
      </span>
      <button
        className="absolute top-1.5 right-1.5 flex size-8 items-center justify-center rounded-full bg-slate-950/80 text-slate-200"
        onClick={(e) => {
          e.stopPropagation()
          if (confirm(`Delete page ${index + 1}?`)) onDelete()
        }}
        onMouseDown={(e) => e.stopPropagation()}
        onTouchStart={(e) => e.stopPropagation()}
        aria-label={`Delete page ${index + 1}`}
      >
        <TrashIcon width={16} height={16} />
      </button>
    </li>
  )
}
