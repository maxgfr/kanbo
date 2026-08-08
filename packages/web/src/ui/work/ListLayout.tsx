import { type Group, type Item, type Project, blockedBy, byOrder, itemById } from '@kanbo/core'
import { useState } from 'react'

import { useDispatch } from '../../state/useStore.ts'
import { isOverdue } from '../board/Card.tsx'
import { Icon } from '../design/Icon.tsx'
import { StatusChip, signalForCategory } from '../design/StatusChip.tsx'

/**
 * The same work as a list, grouped.
 *
 * This absorbs what the table and the backlog each did half of. The table
 * could sort but not group and edited nothing; the backlog could reorder and
 * edit points and sprint but showed one flat pile. Rows here are editable where
 * it costs nothing to be — points and sprint, the two fields planning actually
 * moves — and grouped by whatever the toolbar says, which is how a list answers
 * "what is in this sprint" without becoming a different screen.
 *
 * Groups are collapsible and every one is kept, including the empty ones: a
 * status nothing is in is a real answer, and the board treats it as a place to
 * drop a card rather than a column that does not exist.
 */
export function ListLayout({
  project,
  groups,
  grouped,
  day,
  onOpen,
}: {
  readonly project: Project
  readonly groups: readonly Group[]
  readonly grouped: boolean
  readonly day: string
  readonly onOpen: (itemId: string) => void
}) {
  const [closed, setClosed] = useState<ReadonlySet<string>>(new Set())

  const toggle = (key: string) =>
    setClosed((current) => {
      const next = new Set(current)
      if (!next.delete(key)) next.add(key)
      return next
    })

  const total = groups.reduce((sum, group) => sum + group.items.length, 0)
  if (total === 0) {
    return (
      <div className="kb-empty">
        <Icon name="table" size={28} />
        <p className="kb-empty__title">Nothing matches</p>
        <p className="kb-empty__body">
          Every item is hidden by the filter, or there are none yet. Clearing the filter brings the
          rest back.
        </p>
      </div>
    )
  }

  return (
    <div className="kb-list">
      {groups.map((group) => {
        const key = group.key ?? '__none'
        const open = !closed.has(key)
        const points = group.items.reduce((sum, item) => sum + (item.estimate ?? 0), 0)

        return (
          <section key={key} className="kb-list__group">
            {grouped && (
              <h2 className="kb-list__head">
                <button
                  type="button"
                  className="kb-list__toggle"
                  aria-expanded={open}
                  onClick={() => toggle(key)}
                >
                  <Icon
                    name="chevronDown"
                    size={12}
                    className={open ? undefined : 'kb-rotate-minus-90'}
                  />
                  {group.label}
                </button>
                <span className="data kb-muted">
                  {group.items.length}
                  {points > 0 && ` · ${points} pts`}
                </span>
              </h2>
            )}

            {open &&
              (group.items.length === 0 ? (
                <p className="kb-list__empty kb-muted">Nothing here</p>
              ) : (
                group.items
                  .toSorted(byOrder)
                  .map((item) => (
                    <Row key={item.id} project={project} item={item} day={day} onOpen={onOpen} />
                  ))
              ))}
          </section>
        )
      })}
    </div>
  )
}

function Row({
  project,
  item,
  day,
  onOpen,
}: {
  readonly project: Project
  readonly item: Item
  readonly day: string
  readonly onOpen: (itemId: string) => void
}) {
  const dispatch = useDispatch()
  const status = project.statuses.find((candidate) => candidate.id === item.statusId)
  const parent = item.parentId === null ? null : itemById(project, item.parentId)
  const blocked = blockedBy(project, item).length > 0
  const people = item.assignees
    .map((id) => project.members.find((member) => member.id === id))
    .filter((member): member is NonNullable<typeof member> => member !== undefined)

  return (
    <div className="kb-list__row">
      <button
        type="button"
        className="kb-button kb-button--quiet kb-list__ref"
        onClick={() => onOpen(item.id)}
      >
        {item.ref}
      </button>

      {blocked && (
        <Icon name="blocked" size={13} title="Blocked" className="kb-card__flag--blocked" />
      )}

      <span className="kb-list__title" title={item.title}>
        {item.title}
      </span>

      {/* The parent is named rather than drawn as an indent: this list sorts and
          groups, and an indent that survived either would draw a hierarchy that
          is not the order on screen. */}
      {parent && (
        <span className="kb-token" title={`Part of ${parent.ref} — ${parent.title}`}>
          {parent.ref}
        </span>
      )}

      <span className="kb-spacer" />

      {people.length > 0 && (
        <span className="kb-muted" style={{ fontSize: 'var(--step--1)' }}>
          {people.map((person) => person.name).join(', ')}
        </span>
      )}

      {item.dueOn !== null && (
        <span
          className="data"
          style={{
            fontSize: 'var(--step--1)',
            color: isOverdue(item, day) ? 'var(--signal-delayed)' : 'var(--ink-faint)',
          }}
        >
          {item.dueOn.slice(5)}
        </span>
      )}

      {status && (
        <StatusChip
          label={status.name}
          signal={signalForCategory(status.category)}
          animate={false}
        />
      )}

      <input
        className="kb-input data kb-list__points"
        type="number"
        min={0}
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
        className="kb-select kb-list__sprint"
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
        <option value="">No sprint</option>
        {project.iterations.toSorted(byOrder).map((iteration) => (
          <option key={iteration.id} value={iteration.id}>
            {iteration.name}
          </option>
        ))}
      </select>
    </div>
  )
}
