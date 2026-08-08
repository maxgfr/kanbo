import {
  DAY,
  type Item,
  type ItemDelivery,
  type Project,
  ageInProgress,
  blockedBy,
  firstLine,
  subtreeProgress,
} from '@kanbo/core'
import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import type { KeyboardEventHandler } from 'react'

import { Icon } from '../design/Icon.tsx'

const TYPE_ICON = {
  epic: 'epic',
  story: 'story',
  task: 'task',
  bug: 'bug',
  spike: 'task',
  chore: 'task',
} as const

/**
 * Only the two priorities that mean "act now" are marked.
 *
 * P2 is the default and P3–P4 are quieter than default; giving all five a
 * colour would spend the board's whole signal budget on a field that is mostly
 * noise, and leave nothing to notice when something is actually on fire.
 */
const PRIORITY_SIGNAL: Partial<Record<Item['priority'], string>> = {
  p0: 'var(--signal-cancelled)',
  p1: 'var(--signal-delayed)',
}

export function isOverdue(item: Item, today: string): boolean {
  return item.dueOn !== null && item.completedAt === null && item.dueOn < today
}

/** Initials, not a photograph: there is no network to fetch an avatar from. */
function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase()
  return `${parts[0]![0]!}${parts.at(-1)![0]!}`.toUpperCase()
}

export type CardFaceProps = {
  readonly project: Project
  readonly item: Item
  readonly today: string
  readonly delivery?: ItemDelivery | null | undefined
  /** Shown when the board is not already filtered to one sprint. */
  readonly showIteration?: boolean | undefined
}

/** The card itself, with no drag wiring — shared by the column and the overlay. */
export function CardFace({ project, item, today, delivery, showIteration }: CardFaceProps) {
  const blockers = blockedBy(project, item)
  const overdue = isOverdue(item, today)
  const priority = PRIORITY_SIGNAL[item.priority]
  const preview = firstLine(item.description, 80)

  const labels = item.labels
    .map((id) => project.labels.find((label) => label.id === id))
    .filter((label): label is NonNullable<typeof label> => label !== undefined)

  const people = item.assignees
    .map((id) => project.members.find((member) => member.id === id))
    .filter((member): member is NonNullable<typeof member> => member !== undefined)

  const iteration = showIteration
    ? project.iterations.find((entry) => entry.id === item.iterationId)
    : undefined

  const age = ageInProgress(item, Date.now())
  const days = age === null ? null : Math.floor(age / DAY)

  const progress = subtreeProgress(project, item.id)

  return (
    <>
      <div className="kb-card__top">
        {priority && (
          <span
            className="kb-card__priority"
            style={{ background: priority }}
            title={`Priority ${item.priority.toUpperCase()}`}
            aria-label={`Priority ${item.priority.toUpperCase()}`}
          />
        )}
        <Icon name={TYPE_ICON[item.type]} size={12} title={item.type} className="kb-card__type" />
        <span className="kb-card__ref">{item.ref}</span>

        <span className="kb-spacer" />

        {delivery && <Delivery delivery={delivery} />}
        {blockers.length > 0 && (
          <span
            className="kb-card__flag kb-card__flag--blocked"
            title={`Blocked by ${blockers.map((blocker) => blocker.ref).join(', ')}`}
          >
            <Icon name="blocked" size={12} />
            {blockers.length > 1 ? blockers.length : null}
          </span>
        )}
      </div>

      <span className="kb-card__title">{item.title}</span>

      {preview !== '' && <span className="kb-card__preview">{preview}</span>}

      {labels.length > 0 && (
        <div className="kb-card__labels">
          {labels.map((label) => (
            <span key={label.id} className="kb-card__label" title={label.name}>
              <span
                className="kb-card__label-dot"
                style={{ background: label.color }}
                aria-hidden
              />
              {label.name}
            </span>
          ))}
        </div>
      )}

      {(item.estimate !== null ||
        days !== null ||
        overdue ||
        people.length > 0 ||
        progress.total > 0 ||
        iteration !== undefined) && (
        <div className="kb-card__foot">
          {item.estimate !== null && (
            <span className="kb-card__points" title={`${item.estimate} points`}>
              {item.estimate}
            </span>
          )}

          {/* Only when there are children. A card that carried an empty "0/0"
              would spend the board's attention on the absence of a thing. */}
          {progress.total > 0 && (
            <span
              className="kb-card__flag kb-muted"
              title={`${progress.done} of ${progress.total} sub-issues done`}
            >
              <Icon name="epic" size={11} />
              <span className="data">
                {progress.done}/{progress.total}
              </span>
            </span>
          )}

          {iteration && (
            <span className="kb-card__sprint" title={`Sprint ${iteration.name}`}>
              {iteration.name}
            </span>
          )}

          {days !== null && days >= 1 && (
            <span className="kb-card__flag kb-muted" title={`In progress for ${days} days`}>
              <Icon name="clock" size={11} />
              <span className="data">{days}d</span>
            </span>
          )}

          {overdue && (
            <span className="kb-card__flag kb-card__flag--overdue" title={`Due ${item.dueOn}`}>
              <Icon name="warning" size={11} />
              <span className="data">{item.dueOn?.slice(5)}</span>
            </span>
          )}

          <span className="kb-spacer" />

          {people.length > 0 && (
            <span className="kb-card__people">
              {people.slice(0, 3).map((person) => (
                <span key={person.id} className="kb-avatar" title={person.name}>
                  {initials(person.name)}
                </span>
              ))}
              {people.length > 3 && (
                <span className="kb-avatar kb-avatar--more">+{people.length - 3}</span>
              )}
            </span>
          )}
        </div>
      )}
    </>
  )
}

/**
 * What the pull requests say, in one mark.
 *
 * Unknown check status is drawn as nothing rather than as a neutral tick: a
 * board that cannot tell "passing" from "nobody has looked" is a board that
 * will eventually be believed about the wrong one.
 */
function Delivery({ delivery }: { readonly delivery: ItemDelivery }) {
  if (delivery.merged) {
    return (
      <span className="kb-card__flag" style={{ color: 'var(--signal-departed)' }} title="Merged">
        <Icon name="link" size={12} />
      </span>
    )
  }
  if (delivery.open === 0) return null

  const colour =
    delivery.checks === 'failing'
      ? 'var(--signal-cancelled)'
      : delivery.checks === 'passing'
        ? 'var(--signal-departed)'
        : delivery.checks === 'pending'
          ? 'var(--signal-delayed)'
          : 'var(--ink-faint)'

  const title =
    `${delivery.open} open pull request${delivery.open === 1 ? '' : 's'}` +
    (delivery.draftOnly ? ' (draft)' : '') +
    (delivery.checks === null ? ', checks unknown' : `, checks ${delivery.checks}`)

  return (
    <span
      className="kb-card__flag"
      style={{ color: colour, opacity: delivery.draftOnly ? 0.65 : 1 }}
      title={title}
    >
      <Icon name="link" size={12} />
      {delivery.open > 1 ? delivery.open : null}
    </span>
  )
}

export type CardProps = CardFaceProps & {
  readonly onOpen: (itemId: string) => void
}

export function Card({ project, item, today, delivery, showIteration, onOpen }: CardProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: item.id,
    data: { statusId: item.statusId },
  })

  // dnd-kit hands its synthetic listeners over as a bag of bare `Function`s;
  // this is the one we compose with rather than replace.
  const onKeyDownDrag = listeners?.['onKeyDown'] as KeyboardEventHandler<HTMLDivElement> | undefined

  const blocked = blockedBy(project, item).length > 0

  return (
    <div
      ref={setNodeRef}
      className="kb-card kb-card--draggable"
      data-dragging={isDragging || undefined}
      data-blocked={blocked || undefined}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      // A click opens the card, the same gesture every other view uses. The
      // pointer sensor's activation distance is what makes this safe: dnd-kit
      // only swallows the trailing click once a drag has actually started, so a
      // real drag ends without opening anything.
      onClick={() => onOpen(item.id)}
      {...attributes}
      {...listeners}
      // After the listeners, deliberately. dnd-kit's keyboard sensor supplies an
      // onKeyDown of its own, and a handler declared before the spread would be
      // overwritten by it rather than merged — which is how the O shortcut
      // promised in the label below came to do nothing at all.
      onKeyDown={(event) => {
        onKeyDownDrag?.(event)
        if (event.defaultPrevented) return
        if (event.key === 'o' || event.key === 'O') {
          event.preventDefault()
          onOpen(item.id)
        }
      }}
      aria-roledescription="draggable card"
      aria-label={`${item.ref}. ${item.title}. Press space to pick up, O to open.`}
    >
      <CardFace
        project={project}
        item={item}
        today={today}
        delivery={delivery}
        showIteration={showIteration}
      />
    </div>
  )
}
