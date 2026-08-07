/**
 * Editing the board's columns.
 *
 * The domain has always allowed any number of them — a status is an ordinary
 * entity with a name, an order and a category, and the reducer has always
 * handled `status.upsert` and `status.delete`. What was missing was a way to
 * say so: the four columns a project started with were the four it kept, and
 * the only route to a fifth was editing the source.
 *
 * The category is the field that matters and the one people will be tempted to
 * ignore, so it is a labelled control rather than an advanced setting: every
 * metric in the app reads it, and a column filed under the wrong one produces a
 * cycle time that is wrong without ever looking wrong.
 */
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
import {
  type Status,
  type StatusCategory,
  byOrder,
  itemsInStatus,
  keyBetween,
  orderForStatusReorder,
  statusById,
} from '@kanbo/core'
import { useState } from 'react'

import { createPorts } from '../../state/store.ts'
import { useDispatch, useProject } from '../../state/useStore.ts'
import { Button } from '../design/Button.tsx'
import { Icon } from '../design/Icon.tsx'

const CATEGORIES: readonly (readonly [StatusCategory, string])[] = [
  ['todo', 'To do'],
  ['in-progress', 'In progress'],
  ['done', 'Done'],
]

/** The palette a new column is offered, kept away from the signal colours. */
const SWATCHES = [
  '#6b7280',
  '#0891b2',
  '#2563eb',
  '#7c3aed',
  '#dc2626',
  '#16a34a',
  '#ca8a04',
  '#db2777',
]

export function ColumnsSection() {
  const project = useProject()
  const dispatch = useDispatch()
  const [dragging, setDragging] = useState<string | null>(null)
  const [deleting, setDeleting] = useState<string | null>(null)

  const statuses = project.statuses.toSorted(byOrder)

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  async function addColumn() {
    const ports = createPorts()
    const last = statuses.at(-1)
    const status: Status = {
      id: ports.random.id(),
      name: 'New column',
      // A new column holds work that has started until someone says otherwise.
      // Guessing `todo` would quietly reset the cycle time of every card
      // dropped into it, which is the more expensive of the two wrong guesses.
      category: 'in-progress',
      order: keyBetween(last?.order ?? null, null),
      wipLimit: null,
      color: SWATCHES[statuses.length % SWATCHES.length] ?? null,
    }
    await dispatch({ kind: 'status.upsert', status })
  }

  async function onDragEnd(event: DragEndEvent) {
    setDragging(null)
    const { active, over } = event
    if (!over || active.id === over.id) return

    const to = statuses.findIndex((status) => status.id === over.id)
    if (to === -1) return

    const status = statusById(project, String(active.id))
    if (!status) return

    await dispatch({
      kind: 'status.upsert',
      status: { ...status, order: orderForStatusReorder(project, status.id, to) },
    })
  }

  const dragged = dragging ? statusById(project, dragging) : null

  return (
    <section className="kb-field">
      <h2 className="kb-field__label">Columns</h2>
      <p className="kb-muted" style={{ margin: 0, lineHeight: 1.6 }}>
        The board is whatever you say it is. Every metric reads the category rather than the name,
        so renaming a column, or running three of them at once, keeps cycle time and the flow
        diagram working.
      </p>

      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragStart={(event) => setDragging(String(event.active.id))}
        onDragEnd={onDragEnd}
        onDragCancel={() => setDragging(null)}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
          <SortableContext
            items={statuses.map((status) => status.id)}
            strategy={verticalListSortingStrategy}
          >
            {statuses.map((status) => (
              <ColumnRow
                key={status.id}
                status={status}
                count={itemsInStatus(project, status.id).length}
                deletable={statuses.length > 1}
                deleting={deleting === status.id}
                onDeleting={(open) => setDeleting(open ? status.id : null)}
                destinations={statuses.filter((other) => other.id !== status.id)}
              />
            ))}
          </SortableContext>
        </div>

        <DragOverlay dropAnimation={null}>
          {dragged && (
            <div
              className="kb-card"
              style={{ flexDirection: 'row', alignItems: 'center', gap: 'var(--space-3)' }}
            >
              <Icon name="grip" size={14} />
              <span>{dragged.name}</span>
            </div>
          )}
        </DragOverlay>
      </DndContext>

      <div>
        <Button icon="plus" onClick={() => void addColumn()}>
          Add a column
        </Button>
      </div>
    </section>
  )
}

type ColumnRowProps = {
  readonly status: Status
  readonly count: number
  readonly deletable: boolean
  readonly deleting: boolean
  readonly onDeleting: (open: boolean) => void
  readonly destinations: readonly Status[]
}

function ColumnRow({
  status,
  count,
  deletable,
  deleting,
  onDeleting,
  destinations,
}: ColumnRowProps) {
  const dispatch = useDispatch()
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: status.id,
  })
  const [moveTo, setMoveTo] = useState(destinations[0]?.id ?? '')

  function update(patch: Partial<Status>) {
    void dispatch({ kind: 'status.upsert', status: { ...status, ...patch } })
  }

  return (
    <div
      ref={setNodeRef}
      className="kb-card"
      data-dragging={isDragging || undefined}
      style={{ transform: CSS.Translate.toString(transform), transition }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 'var(--space-2)',
          flexWrap: 'wrap',
        }}
      >
        <span
          {...attributes}
          {...listeners}
          className="kb-muted"
          style={{ cursor: 'grab', display: 'inline-flex' }}
          aria-roledescription="drag handle"
          aria-label={`Reorder ${status.name}. Press space to pick up.`}
        >
          <Icon name="grip" size={14} />
        </span>

        <input
          className="kb-input"
          type="color"
          style={{ width: '2rem', padding: 0, flex: '0 0 auto' }}
          value={status.color ?? '#6b7280'}
          aria-label={`Colour for ${status.name}`}
          onChange={(event) => update({ color: event.target.value })}
        />

        <input
          className="kb-input"
          style={{ flex: '1 1 8rem', minWidth: '6rem' }}
          value={status.name}
          aria-label={`Name of the ${status.name} column`}
          onChange={(event) => update({ name: event.target.value })}
        />

        <select
          className="kb-select"
          style={{ flex: '0 0 auto' }}
          value={status.category}
          aria-label={`Category of ${status.name}`}
          onChange={(event) => update({ category: event.target.value as StatusCategory })}
        >
          {CATEGORIES.map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>

        <input
          className="kb-input data"
          type="number"
          min={0}
          style={{ width: '4.5rem', flex: '0 0 auto' }}
          value={status.wipLimit ?? ''}
          placeholder="WIP"
          aria-label={`WIP limit for ${status.name}`}
          onChange={(event) =>
            update({ wipLimit: event.target.value === '' ? null : Number(event.target.value) })
          }
        />

        <Button
          variant="quiet"
          icon="trash"
          aria-label={`Delete the ${status.name} column`}
          disabled={!deletable}
          onClick={() => onDeleting(true)}
        />
      </div>

      {deleting && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 'var(--space-2)',
            flexWrap: 'wrap',
          }}
        >
          {/* Cards are never destroyed with their column, so the destination is
              asked for rather than assumed. The reducer refuses a move to a
              status that does not exist, which is the same rule stated twice. */}
          <span className="kb-muted">
            {count === 0
              ? 'This column is empty.'
              : `Move ${count} ${count === 1 ? 'card' : 'cards'} to`}
          </span>
          {count > 0 && (
            <select
              className="kb-select"
              value={moveTo}
              aria-label="Destination column"
              onChange={(event) => setMoveTo(event.target.value)}
            >
              {destinations.map((destination) => (
                <option key={destination.id} value={destination.id}>
                  {destination.name}
                </option>
              ))}
            </select>
          )}
          <Button
            variant="danger"
            onClick={() => {
              const target = count > 0 ? moveTo : (destinations[0]?.id ?? '')
              if (!target) return
              onDeleting(false)
              void dispatch({ kind: 'status.delete', statusId: status.id, moveToId: target })
            }}
          >
            Delete column
          </Button>
          <Button variant="quiet" onClick={() => onDeleting(false)}>
            Cancel
          </Button>
        </div>
      )}
    </div>
  )
}
