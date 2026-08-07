/**
 * Naming a sprint, dating it, closing it and deleting it.
 *
 * The dates were the gap that mattered. A sprint is a date range with a goal,
 * and everything the view draws — the burndown, the ideal line, whether a
 * sprint counts towards velocity — is computed from those two days. They were
 * invented at creation and then unreachable, so a fortnight starting today was
 * not a default: it was the only sprint anyone could have.
 *
 * Closing is separate from deleting on purpose. A sprint that ends leaves work
 * behind, and the only two honest answers are "carry it to the next one" and
 * "put it back in the backlog" — never "it disappears with the sprint".
 */
import { type Iteration, type Project, byOrder, isoDay, keyBetween } from '@kanbo/core'
import { type ReactNode, useState } from 'react'

import { createPorts } from '../../state/store.ts'
import { useDispatch } from '../../state/useStore.ts'
import { Button } from '../design/Button.tsx'
import { Icon } from '../design/Icon.tsx'

const DAY = 86_400_000

/** The fortnight after `from`, or the one starting today when there is none. */
export function fortnightAfter(from: string | null): { startsAt: string; endsAt: string } {
  const start = from === null ? Date.now() : Date.parse(`${from}T00:00:00Z`) + DAY
  return { startsAt: isoDay(start), endsAt: isoDay(start + 13 * DAY) }
}

export async function createIteration(
  project: Project,
  dispatch: (body: { kind: 'iteration.upsert'; iteration: Iteration }) => Promise<void>,
): Promise<Iteration> {
  const ports = createPorts()
  const iterations = project.iterations.toSorted(byOrder)
  const last = iterations.at(-1)

  const iteration: Iteration = {
    id: ports.random.id(),
    name: `Sprint ${iterations.length + 1}`,
    goal: '',
    // Picked up where the previous sprint left off rather than starting today,
    // so a team that plans three sprints ahead gets three consecutive ones
    // instead of three overlapping copies of this fortnight.
    ...fortnightAfter(last?.endsAt ?? null),
    capacity: null,
    order: keyBetween(last?.order ?? null, null),
  }

  await dispatch({ kind: 'iteration.upsert', iteration })
  return iteration
}

type SprintSetupProps = {
  readonly project: Project
  readonly selected: Iteration
  readonly onSelect: (iterationId: string | null) => void
}

export function SprintSetup({ project, selected, onSelect }: SprintSetupProps) {
  const dispatch = useDispatch()
  const [closing, setClosing] = useState(false)
  const [deleting, setDeleting] = useState(false)

  const iterations = project.iterations.toSorted(byOrder)
  const items = project.items.filter((item) => item.iterationId === selected.id && !item.archived)
  const unfinished = items.filter((item) => item.completedAt === null)
  const others = iterations.filter((iteration) => iteration.id !== selected.id)

  const [carryTo, setCarryTo] = useState('')

  function update(patch: Partial<Iteration>) {
    void dispatch({ kind: 'iteration.upsert', iteration: { ...selected, ...patch } })
  }

  const days =
    Math.round(
      (Date.parse(`${selected.endsAt}T00:00:00Z`) - Date.parse(`${selected.startsAt}T00:00:00Z`)) /
        DAY,
    ) + 1
  const backwards = selected.endsAt < selected.startsAt

  return (
    <header style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
      <div className="kb-row" style={{ gap: 'var(--space-3)', flexWrap: 'wrap' }}>
        <select
          className="kb-select"
          style={{ width: 'auto' }}
          value={selected.id}
          aria-label="Sprint"
          onChange={(event) => onSelect(event.target.value)}
        >
          {iterations.map((iteration) => (
            <option key={iteration.id} value={iteration.id}>
              {iteration.name}
            </option>
          ))}
        </select>

        <Button
          icon="plus"
          onClick={() => void createIteration(project, dispatch).then((made) => onSelect(made.id))}
        >
          New sprint
        </Button>

        <span className="kb-spacer" />

        <Button
          icon="check"
          disabled={unfinished.length === 0}
          onClick={() => {
            setCarryTo(others[0]?.id ?? '')
            setClosing(true)
            setDeleting(false)
          }}
        >
          Close sprint
        </Button>
        <Button
          variant="quiet"
          icon="trash"
          aria-label={`Delete ${selected.name}`}
          onClick={() => {
            setDeleting(true)
            setClosing(false)
          }}
        />
      </div>

      <div className="kb-row" style={{ gap: 'var(--space-3)', flexWrap: 'wrap' }}>
        <div className="kb-field" style={{ flex: '1 1 14rem' }}>
          <label className="kb-field__label" htmlFor="kb-sprint-name">
            Name
          </label>
          <input
            id="kb-sprint-name"
            className="kb-input"
            value={selected.name}
            onChange={(event) => update({ name: event.target.value })}
          />
        </div>

        <div className="kb-field">
          <label className="kb-field__label" htmlFor="kb-sprint-start">
            Starts
          </label>
          <input
            id="kb-sprint-start"
            className="kb-input data"
            type="date"
            value={selected.startsAt}
            onChange={(event) => update({ startsAt: event.target.value })}
          />
        </div>

        <div className="kb-field">
          <label className="kb-field__label" htmlFor="kb-sprint-end">
            Ends
          </label>
          <input
            id="kb-sprint-end"
            className="kb-input data"
            type="date"
            value={selected.endsAt}
            onChange={(event) => update({ endsAt: event.target.value })}
          />
        </div>

        <div className="kb-field">
          <span className="kb-field__label">Length</span>
          <span
            className="data"
            style={{
              lineHeight: '2rem',
              color: backwards ? 'var(--signal-cancelled)' : 'var(--ink-muted)',
            }}
          >
            {/* Said rather than corrected: silently swapping the dates would
                hide a typo the burndown is about to be drawn from. */}
            {backwards ? 'Ends before it starts' : `${days} days`}
          </span>
        </div>
      </div>

      {closing && (
        <Banner>
          <span>
            {unfinished.length} unfinished {unfinished.length === 1 ? 'item' : 'items'} — move
          </span>
          <select
            className="kb-select"
            style={{ width: 'auto' }}
            value={carryTo}
            aria-label="Where unfinished work goes"
            onChange={(event) => setCarryTo(event.target.value)}
          >
            <option value="">to the backlog</option>
            {others.map((iteration) => (
              <option key={iteration.id} value={iteration.id}>
                to {iteration.name}
              </option>
            ))}
          </select>
          <Button
            variant="primary"
            onClick={() => {
              setClosing(false)
              void dispatch(
                ...unfinished.map((item) => ({
                  kind: 'item.set' as const,
                  itemId: item.id,
                  patch: { iterationId: carryTo || null },
                })),
              )
            }}
          >
            Close it
          </Button>
          <Button variant="quiet" onClick={() => setClosing(false)}>
            Cancel
          </Button>
        </Banner>
      )}

      {deleting && (
        <Banner signal="cancelled">
          <span>
            {items.length === 0
              ? `Delete ${selected.name}?`
              : `Delete ${selected.name}? Its ${items.length} ${
                  items.length === 1 ? 'item returns' : 'items return'
                } to the backlog — none of them are deleted.`}
          </span>
          <Button
            variant="danger"
            onClick={() => {
              setDeleting(false)
              onSelect(null)
              void dispatch({ kind: 'iteration.delete', iterationId: selected.id })
            }}
          >
            Delete sprint
          </Button>
          <Button variant="quiet" onClick={() => setDeleting(false)}>
            Cancel
          </Button>
        </Banner>
      )}
    </header>
  )
}

function Banner({
  children,
  signal = 'delayed',
}: {
  readonly children: ReactNode
  readonly signal?: 'delayed' | 'cancelled'
}) {
  return (
    <div
      className="kb-row"
      style={{
        gap: 'var(--space-2)',
        flexWrap: 'wrap',
        background: `var(--signal-${signal}-dim)`,
        border: `1px solid color-mix(in oklab, var(--signal-${signal}) 30%, transparent)`,
        borderRadius: 'var(--radius)',
        padding: 'var(--space-2) var(--space-3)',
      }}
    >
      <Icon name="warning" size={14} />
      {children}
    </div>
  )
}
