import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  type DragEndEvent,
  type DragStartEvent,
  useDroppable,
  useSensor,
  useSensors,
} from '@dnd-kit/core'
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable'
import {
  type Item,
  type ItemDelivery,
  type Project,
  type Status,
  byOrder,
  exceedsWipLimit,
  isoDay,
  itemById,
  keyBetween,
  orderForDrop,
} from '@kanbo/core'
import { useMemo, useState } from 'react'

import { useDispatch } from '../../state/useStore.ts'
import { Button } from '../design/Button.tsx'
import { Icon } from '../design/Icon.tsx'
import { Card, CardFace } from './Card.tsx'
import { boardCollisionDetection } from './collision.ts'
import { boardKeyboardCoordinates } from './keyboard.ts'

function today(): string {
  return isoDay(Date.now())
}

/** Points done against points committed, for the sprint the board is showing. */
function SprintProgress({
  project,
  sprintId,
}: {
  readonly project: Project
  readonly sprintId: string
}) {
  const iteration = project.iterations.find((entry) => entry.id === sprintId)
  if (!iteration) return null

  const items = project.items.filter((item) => item.iterationId === sprintId && !item.archived)
  const committed = items.reduce((total, item) => total + (item.estimate ?? 0), 0)
  const done = items
    .filter((item) => item.completedAt !== null)
    .reduce((total, item) => total + (item.estimate ?? 0), 0)
  const over = iteration.capacity !== null && committed > iteration.capacity

  return (
    <div className="kb-toolbar__group">
      <span className="kb-toolbar__label">
        {iteration.startsAt.slice(5)} → {iteration.endsAt.slice(5)}
      </span>
      <span
        className="data"
        style={{ fontSize: 'var(--step--1)', color: over ? 'var(--signal-delayed)' : undefined }}
        title={
          iteration.capacity === null
            ? `${done} of ${committed} points done`
            : `${done} of ${committed} points done, capacity ${iteration.capacity}`
        }
      >
        {done}/{committed}
        {iteration.capacity === null ? '' : ` of ${iteration.capacity}`} pts
      </span>
    </div>
  )
}

type ColumnProps = {
  readonly project: Project
  readonly status: Status
  readonly items: readonly Item[]
  readonly day: string
  readonly deliveries: ReadonlyMap<string, ItemDelivery>
  readonly showIteration: boolean
  readonly onOpen: (itemId: string) => void
  readonly onAdd: (statusId: string) => void
}

function Column({
  project,
  status,
  items,
  day,
  deliveries,
  showIteration,
  onOpen,
  onAdd,
}: ColumnProps) {
  const { setNodeRef, isOver } = useDroppable({ id: `column:${status.id}` })
  const over = exceedsWipLimit(project, status.id)

  return (
    <section className="kb-column" aria-label={status.name}>
      <header className="kb-column__header">
        <span
          aria-hidden
          style={{
            width: 6,
            height: 6,
            borderRadius: 99,
            background: status.color ?? 'var(--ink-faint)',
          }}
        />
        <span className="kb-column__name">{status.name}</span>
        <span className="kb-column__count" data-over={over || undefined}>
          {items.length}
          {status.wipLimit !== null && ` / ${status.wipLimit}`}
        </span>
        <span className="kb-spacer" />
        <Button
          variant="quiet"
          icon="plus"
          aria-label={`Add an item to ${status.name}`}
          onClick={() => onAdd(status.id)}
          style={{ padding: '0.1875rem' }}
        />
      </header>

      <div ref={setNodeRef} className="kb-column__body" data-over={isOver || undefined}>
        <SortableContext
          items={items.map((item) => item.id)}
          strategy={verticalListSortingStrategy}
        >
          {items.map((item) => (
            <Card
              key={item.id}
              project={project}
              item={item}
              today={day}
              delivery={deliveries.get(item.id) ?? null}
              showIteration={showIteration}
              onOpen={onOpen}
            />
          ))}
        </SortableContext>

        {items.length === 0 && <p className="kb-column__empty">Nothing here yet</p>}
      </div>
    </section>
  )
}

export type BoardViewProps = {
  readonly project: Project
  readonly deliveries: ReadonlyMap<string, ItemDelivery>
  readonly onOpen: (itemId: string) => void
  readonly onAdd: (statusId: string) => void
}

/** `null` is every sprint; `''` is the ones in no sprint at all. */
type SprintFilter = string | null

export function BoardView({ project, deliveries, onOpen, onAdd }: BoardViewProps) {
  const dispatch = useDispatch()
  const [dragging, setDragging] = useState<string | null>(null)
  const day = today()

  const iterations = project.iterations.toSorted(byOrder)
  const current = iterations.find((entry) => entry.startsAt <= day && entry.endsAt >= day)

  // Everything, always, until someone narrows it. Opening on the current
  // sprint reads well for a Scrum team and empties the board for a Kanban one,
  // whose items belong to no sprint at all — and a board that hides work by
  // default is a board that loses it. The current sprint is one click away.
  const [sprint, setSprint] = useState<SprintFilter>(null)

  // The pointer sensor needs a small activation distance or a click to open a
  // card registers as a one-pixel drag. The keyboard sensor is not an
  // accessibility afterthought: a board only reachable by mouse is unusable for
  // part of every team.
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: boardKeyboardCoordinates }),
  )

  const columns = useMemo(() => {
    const statuses = project.statuses.toSorted(byOrder)
    const visible = project.items.filter((item) => {
      if (item.archived) return false
      if (sprint === null) return true
      return (item.iterationId ?? '') === sprint
    })
    return statuses.map((status) => ({
      status,
      items: visible.filter((item) => item.statusId === status.id).toSorted(byOrder),
    }))
  }, [project, sprint])

  const shown = columns.reduce((total, column) => total + column.items.length, 0)
  const hidden = project.items.filter((item) => !item.archived).length - shown

  const draggedItem = dragging ? itemById(project, dragging) : null

  function onDragStart(event: DragStartEvent) {
    setDragging(String(event.active.id))
  }

  async function onDragEnd(event: DragEndEvent) {
    setDragging(null)
    const { active, over } = event
    if (!over) return

    const item = itemById(project, String(active.id))
    if (!item) return

    const overId = String(over.id)

    // Dropped on a column's empty area rather than on a card.
    if (overId.startsWith('column:')) {
      const statusId = overId.slice('column:'.length)
      const column = project.items
        .filter((candidate) => candidate.statusId === statusId && candidate.id !== item.id)
        .toSorted(byOrder)
      const last = column.at(-1)?.order ?? null
      if (statusId === item.statusId && column.length === 0) return
      await dispatch({
        kind: 'item.move',
        itemId: item.id,
        statusId,
        order: keyBetween(last, null),
      })
      return
    }

    const target = itemById(project, overId)
    if (!target || target.id === item.id) return

    const statusId = target.statusId
    const column = project.items
      .filter((candidate) => candidate.statusId === statusId && !candidate.archived)
      .toSorted(byOrder)
    const index = column.findIndex((candidate) => candidate.id === target.id)
    if (index === -1) return

    // `index` is the target's position in the column *including* the dragged
    // card, while orderForDrop measures against the column without it. The two
    // cancel out: moving down, removing the card shifts the target up one and
    // landing after it adds one back; moving up or across columns, nothing
    // shifts at all. So the raw index is right in every direction, and the
    // correction this looks like it needs would introduce an off-by-one.
    await dispatch({
      kind: 'item.move',
      itemId: item.id,
      statusId,
      order: orderForDrop(project, item.id, statusId, index),
    })
  }

  if (project.statuses.length === 0) {
    return (
      <div className="kb-empty">
        <p className="kb-empty__title">This board has no columns</p>
        <p className="kb-empty__body">Add a status in settings to start moving work across it.</p>
      </div>
    )
  }

  const toolbar = (
    <div className="kb-toolbar">
      <div className="kb-toolbar__group">
        <span className="kb-toolbar__label">Sprint</span>
        <select
          className="kb-select"
          aria-label="Filter by sprint"
          value={sprint ?? '__all'}
          onChange={(event) =>
            setSprint(event.target.value === '__all' ? null : event.target.value)
          }
        >
          <option value="__all">All</option>
          {current && <option value={current.id}>Current sprint</option>}
          {iterations.map((iteration) => (
            <option key={iteration.id} value={iteration.id}>
              {iteration.name}
            </option>
          ))}
          <option value="">No sprint</option>
        </select>
      </div>

      {sprint !== null && sprint !== '' && <SprintProgress project={project} sprintId={sprint} />}

      <span className="kb-spacer" />

      {hidden > 0 && (
        <span className="kb-toolbar__label">
          {hidden} item{hidden === 1 ? '' : 's'} outside this sprint
        </span>
      )}
    </div>
  )

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={boardCollisionDetection}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onDragCancel={() => setDragging(null)}
      accessibility={{
        announcements: {
          onDragStart: ({ active }) => `Picked up ${labelOf(project, String(active.id))}.`,
          onDragOver: ({ active, over }) =>
            over
              ? `${labelOf(project, String(active.id))} is over ${overLabel(project, String(over.id))}.`
              : `${labelOf(project, String(active.id))} is no longer over a drop target.`,
          onDragEnd: ({ active, over }) =>
            over
              ? `Dropped ${labelOf(project, String(active.id))} on ${overLabel(project, String(over.id))}.`
              : `Dropped ${labelOf(project, String(active.id))} back where it started.`,
          onDragCancel: ({ active }) =>
            `Cancelled. ${labelOf(project, String(active.id))} returned to its place.`,
        },
      }}
    >
      {toolbar}

      <div className="kb-board">
        {columns.map(({ status, items }) => (
          <Column
            key={status.id}
            project={project}
            status={status}
            items={items}
            day={day}
            deliveries={deliveries}
            // Redundant when the board is already filtered to one sprint.
            showIteration={sprint === null}
            onOpen={onOpen}
            onAdd={onAdd}
          />
        ))}
      </div>

      {/*
        The overlay follows the cursor at full opacity while the original stays
        in place at reduced opacity, so the column never reflows mid-drag and
        the reading order stays stable underneath.
      */}
      <DragOverlay dropAnimation={null}>
        {draggedItem && (
          <div className="kb-card kb-card__overlay">
            <CardFace
              project={project}
              item={draggedItem}
              today={day}
              delivery={deliveries.get(draggedItem.id) ?? null}
            />
          </div>
        )}
      </DragOverlay>
    </DndContext>
  )
}

function labelOf(project: Project, id: string): string {
  const item = itemById(project, id)
  return item ? `${item.ref}, ${item.title}` : 'card'
}

function overLabel(project: Project, id: string): string {
  if (id.startsWith('column:')) {
    const status = project.statuses.find((candidate) => candidate.id === id.slice(7))
    return status ? `the ${status.name} column` : 'a column'
  }
  return labelOf(project, id)
}

export function BoardEmpty({ onAdd }: { readonly onAdd: () => void }) {
  return (
    <div className="kb-empty">
      <Icon name="board" size={28} />
      <p className="kb-empty__title">Nothing is in flight</p>
      <p className="kb-empty__body">
        Add the first item and it appears in the leftmost column. Drag it across with the mouse, or
        focus it and press space.
      </p>
      <Button variant="primary" icon="plus" onClick={onAdd}>
        Add an item
      </Button>
    </div>
  )
}
