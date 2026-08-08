import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
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
import { AddColumn } from './AddColumn.tsx'
import { Card, CardFace } from './Card.tsx'
import { boardCollisionDetection } from './collision.ts'
import { boardKeyboardCoordinates } from './keyboard.ts'

function today(): string {
  return isoDay(Date.now())
}

/** Points done against points committed, for the sprint the board is showing. */
export function SprintProgress({
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
    <section id={`kb-column-${status.id}`} className="kb-column" aria-label={status.name}>
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
  /** Already filtered and, in a swimlane, already narrowed to this lane. */
  readonly items: readonly Item[]
  readonly deliveries: ReadonlyMap<string, ItemDelivery>
  readonly showIteration: boolean
  readonly onOpen: (itemId: string) => void
  readonly onAdd: (statusId: string) => void
}

/**
 * The columns, and the drag between them.
 *
 * It no longer decides what it shows. Which items reach it — and whether they
 * are all of them, one sprint's worth, or one lane of a grouping — is the
 * caller's business, because the same question is asked by the list layout and
 * answering it twice is how two layouts start disagreeing.
 */
export function BoardView({
  project,
  items: visible,
  deliveries,
  showIteration,
  onOpen,
  onAdd,
}: BoardViewProps) {
  const dispatch = useDispatch()
  const [dragging, setDragging] = useState<string | null>(null)
  const day = today()

  // Three sensors rather than one pointer sensor, because a mouse and a finger
  // disagree about what "I meant to drag that" looks like.
  //
  // A mouse says it with distance: a few pixels of travel are unambiguous, and
  // anything shorter is a click meant to open the card. A finger cannot say it
  // that way — every scroll of a column starts as a few pixels of travel over a
  // card — so touch says it with time instead: hold briefly to pick up, tap to
  // open, and swipe scrolls the board as it always did. The tolerance lets a
  // thumb wobble during the hold without cancelling the pick-up.
  //
  // The keyboard sensor is not an accessibility afterthought: a board only
  // reachable by mouse is unusable for part of every team.
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 4 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: boardKeyboardCoordinates }),
  )

  const columns = useMemo(
    () =>
      project.statuses.toSorted(byOrder).map((status) => ({
        status,
        items: visible.filter((item) => item.statusId === status.id).toSorted(byOrder),
      })),
    [project.statuses, visible],
  )

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
      // Archived cards are excluded here as they are in the card branch below
      // and in `orderForDrop`. Counted, a column whose only remaining cards are
      // archived looked occupied: the bail-out was skipped and the drop was
      // positioned against a neighbour that is not on screen.
      const column = project.items
        .filter(
          (candidate) =>
            candidate.statusId === statusId && candidate.id !== item.id && !candidate.archived,
        )
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
      <div className="kb-board">
        {columns.map(({ status, items }) => (
          <Column
            key={status.id}
            project={project}
            status={status}
            items={items}
            day={day}
            deliveries={deliveries}
            showIteration={showIteration}
            onOpen={onOpen}
            onAdd={onAdd}
          />
        ))}

        <AddColumn />
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

/**
 * The prompt for a board with nothing on it yet.
 *
 * Drawn above the columns rather than in place of them. Replacing the whole
 * board took the column editor and the sprint toolbar with it, so a new project
 * — the one case this screen exists for — could only get a column by going to
 * settings, which is the detour `AddColumn` was added to remove.
 */
export function BoardEmpty({
  onAdd,
  into,
}: {
  readonly onAdd: () => void
  /** The sprint a new card will land in, when the board is showing one. */
  readonly into?: string | undefined
}) {
  return (
    <div
      className="kb-row"
      style={{
        margin: 'var(--space-4) var(--space-4) 0',
        padding: 'var(--space-3) var(--space-4)',
        border: '1px dashed var(--rule)',
        borderRadius: 'var(--radius-lg)',
        background: 'var(--surface)',
      }}
    >
      <Icon name="board" size={16} />
      <span>
        Nothing is in flight. Add the first item and it appears in the leftmost column — drag it
        across with the mouse, or focus it and press space.
      </span>
      <span className="kb-spacer" />
      {/* Named, because the board is filtered and the card has to go somewhere:
          saying which sprint beats creating it silently and elsewhere. */}
      <Button variant="primary" icon="plus" onClick={onAdd}>
        {into ? `Add an item to ${into}` : 'Add an item'}
      </Button>
    </div>
  )
}
