import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  type DragEndEvent,
  closestCenter,
  useSensor,
  useSensors,
} from '@dnd-kit/core'
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { type Item, type Project, byOrder, itemById, keyBetween, statusById } from '@kanbo/core'
import { useMemo, useState } from 'react'

import { useDispatch } from '../../state/useStore.ts'
import { Icon } from '../design/Icon.tsx'
import { StatusChip, signalForCategory } from '../design/StatusChip.tsx'

type RowProps = {
  readonly project: Project
  readonly item: Item
  readonly onOpen: (itemId: string) => void
}

function Row({ project, item, onOpen }: RowProps) {
  const dispatch = useDispatch()
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: item.id,
  })
  const status = statusById(project, item.statusId)
  const parent = item.parentId === null ? null : itemById(project, item.parentId)

  return (
    <div
      ref={setNodeRef}
      className="kb-card"
      data-dragging={isDragging || undefined}
      style={{
        transform: CSS.Translate.toString(transform),
        transition,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 'var(--space-3)',
      }}
    >
      <span
        {...attributes}
        {...listeners}
        className="kb-muted"
        style={{ cursor: 'grab', display: 'inline-flex' }}
        aria-roledescription="drag handle"
        aria-label={`Reorder ${item.ref}. Press space to pick up.`}
      >
        <Icon name="grip" size={14} />
      </span>

      <button
        type="button"
        className="kb-button kb-button--quiet"
        style={{ fontFamily: 'var(--font-data)', padding: '0 0.25rem' }}
        onClick={() => onOpen(item.id)}
      >
        {item.ref}
      </button>

      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {item.title}
      </span>

      {/* The parent named rather than the row indented: this list is sortable,
          and an indent that survived a sort by priority would draw a hierarchy
          that is not the order on screen. */}
      {parent && (
        <span className="kb-token" title={`Part of ${parent.ref} — ${parent.title}`}>
          {parent.ref}
        </span>
      )}

      <span className="kb-spacer" />

      {status && (
        <StatusChip
          label={status.name}
          signal={signalForCategory(status.category)}
          animate={false}
        />
      )}

      <input
        className="kb-input data"
        type="number"
        min={0}
        style={{ width: '4rem' }}
        value={item.estimate ?? ''}
        placeholder="—"
        aria-label={`Points for ${item.ref}`}
        onChange={(event) =>
          void dispatch({
            kind: 'item.set',
            itemId: item.id,
            patch: { estimate: event.target.value === '' ? null : Number(event.target.value) },
          })
        }
      />

      <select
        className="kb-select"
        style={{ width: '9rem' }}
        value={item.iterationId ?? ''}
        aria-label={`Sprint for ${item.ref}`}
        onChange={(event) =>
          void dispatch({
            kind: 'item.set',
            itemId: item.id,
            patch: { iterationId: event.target.value || null },
          })
        }
      >
        <option value="">Backlog</option>
        {project.iterations.toSorted(byOrder).map((iteration) => (
          <option key={iteration.id} value={iteration.id}>
            {iteration.name}
          </option>
        ))}
      </select>
    </div>
  )
}

export function BacklogView({
  project,
  onOpen,
}: {
  readonly project: Project
  readonly onOpen: (itemId: string) => void
}) {
  const dispatch = useDispatch()
  const [dragging, setDragging] = useState<string | null>(null)

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  const items = useMemo(
    () => project.items.filter((item) => !item.archived).toSorted(byOrder),
    [project.items],
  )

  async function onDragEnd(event: DragEndEvent) {
    setDragging(null)
    const { active, over } = event
    if (!over || active.id === over.id) return

    const from = items.findIndex((item) => item.id === active.id)
    const to = items.findIndex((item) => item.id === over.id)
    if (from === -1 || to === -1) return

    // Neighbours are read from the list with the dragged row removed, so moving
    // down does not compute a position against the row's own old place.
    const without = items.filter((item) => item.id !== active.id)
    const before = to > 0 ? (without[to - 1]?.order ?? null) : null
    const after = without[to]?.order ?? null

    await dispatch({
      kind: 'item.move',
      itemId: String(active.id),
      statusId: itemById(project, String(active.id))?.statusId ?? '',
      order: keyBetween(before, after),
    })
  }

  if (items.length === 0) {
    return (
      <div className="kb-empty">
        <Icon name="backlog" size={28} />
        <p className="kb-empty__title">The backlog is empty</p>
        <p className="kb-empty__body">
          Items appear here in priority order. Drag to reorder, and assign one to a sprint from the
          menu on its row.
        </p>
      </div>
    )
  }

  const dragged = dragging ? itemById(project, dragging) : null

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragStart={(event) => setDragging(String(event.active.id))}
      onDragEnd={onDragEnd}
      onDragCancel={() => setDragging(null)}
    >
      <div
        style={{
          overflowY: 'auto',
          padding: 'var(--space-4)',
          display: 'flex',
          flexDirection: 'column',
          gap: 'var(--space-2)',
          maxWidth: '72rem',
        }}
      >
        <SortableContext
          items={items.map((item) => item.id)}
          strategy={verticalListSortingStrategy}
        >
          {items.map((item) => (
            <Row key={item.id} project={project} item={item} onOpen={onOpen} />
          ))}
        </SortableContext>
      </div>

      <DragOverlay dropAnimation={null}>
        {dragged && (
          <div
            className="kb-card kb-card__overlay"
            style={{ flexDirection: 'row', alignItems: 'center', gap: 'var(--space-3)' }}
          >
            <Icon name="grip" size={14} />
            <span className="kb-card__ref">{dragged.ref}</span>
            <span>{dragged.title}</span>
          </div>
        )}
      </DragOverlay>
    </DndContext>
  )
}
