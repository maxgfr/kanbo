import { type Item, type Project, firstLine, itemById } from '@kanbo/core'
import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'

import { Icon } from '../design/Icon.tsx'

const TYPE_ICON = {
  epic: 'epic',
  story: 'story',
  task: 'task',
  bug: 'bug',
  spike: 'task',
  chore: 'task',
} as const

const PRIORITY_SIGNAL: Record<Item['priority'], string | null> = {
  p0: 'var(--signal-cancelled)',
  p1: 'var(--signal-delayed)',
  p2: null,
  p3: null,
  p4: null,
}

/** An item is blocked when something it depends on has not finished. */
export function blockedBy(project: Project, item: Item): readonly Item[] {
  return item.links
    .filter((link) => link.type === 'blocked-by')
    .map((link) => itemById(project, link.itemId))
    .filter((blocker): blocker is Item => blocker !== null && blocker.completedAt === null)
}

export function isOverdue(item: Item, today: string): boolean {
  return item.dueOn !== null && item.completedAt === null && item.dueOn < today
}

export type CardFaceProps = {
  readonly project: Project
  readonly item: Item
  readonly today: string
}

/** The card itself, with no drag wiring — shared by the column and the overlay. */
export function CardFace({ project, item, today }: CardFaceProps) {
  const blockers = blockedBy(project, item)
  const overdue = isOverdue(item, today)
  const priorityColor = PRIORITY_SIGNAL[item.priority]

  return (
    <>
      <div className="kb-card__top">
        <Icon name={TYPE_ICON[item.type]} size={13} title={item.type} />
        <span className="kb-card__ref">{item.ref}</span>
        {priorityColor && (
          <span
            className="kb-card__ref"
            style={{ color: priorityColor, fontWeight: 600 }}
            title={`Priority ${item.priority.toUpperCase()}`}
          >
            {item.priority.toUpperCase()}
          </span>
        )}
      </div>

      <span className="kb-card__title">{item.title}</span>

      {item.description !== '' && (
        <span className="kb-muted" style={{ fontSize: 'var(--step--1)' }}>
          {firstLine(item.description, 70)}
        </span>
      )}

      {(item.estimate !== null || blockers.length > 0 || overdue || item.assignees.length > 0) && (
        <div className="kb-card__meta">
          {item.estimate !== null && <span className="kb-card__points">{item.estimate}</span>}

          {blockers.length > 0 && (
            <span
              className="kb-card__flag kb-card__flag--blocked"
              title={`Blocked by ${blockers.map((blocker) => blocker.ref).join(', ')}`}
            >
              <Icon name="blocked" size={12} />
              {blockers.length > 1 ? blockers.length : null}
            </span>
          )}

          {overdue && (
            <span className="kb-card__flag kb-card__flag--overdue" title={`Due ${item.dueOn}`}>
              <Icon name="warning" size={12} />
            </span>
          )}

          {item.assignees.length > 0 && (
            <span className="kb-card__flag kb-muted">
              <Icon name="person" size={12} />
              {item.assignees.length > 1 ? item.assignees.length : null}
            </span>
          )}
        </div>
      )}
    </>
  )
}

export type CardProps = CardFaceProps & {
  readonly onOpen: (itemId: string) => void
}

export function Card({ project, item, today, onOpen }: CardProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: item.id,
    data: { statusId: item.statusId },
  })

  const blocked = blockedBy(project, item).length > 0

  return (
    <div
      ref={setNodeRef}
      className="kb-card"
      data-dragging={isDragging || undefined}
      data-blocked={blocked || undefined}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      // Enter and Space are claimed by dnd-kit's keyboard sensor to pick a card
      // up, so opening it needs its own key. Double-click and the panel's own
      // affordance cover the pointer case.
      onDoubleClick={() => onOpen(item.id)}
      onKeyDown={(event) => {
        if (event.key === 'o' || event.key === 'O') {
          event.preventDefault()
          onOpen(item.id)
        }
      }}
      {...attributes}
      {...listeners}
      aria-roledescription="draggable card"
      aria-label={`${item.ref}. ${item.title}. Press space to pick up, O to open.`}
    >
      <CardFace project={project} item={item} today={today} />
    </div>
  )
}
