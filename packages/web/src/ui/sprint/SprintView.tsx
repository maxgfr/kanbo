import { type Project, averageVelocity, burndown, byOrder, isoDay, velocity } from '@kanbo/core'
import { useState } from 'react'

import { useDispatch } from '../../state/useStore.ts'
import { BarChart, Legend, LineChart, type Series } from '../charts/Charts.tsx'
import { Button } from '../design/Button.tsx'
import { Icon } from '../design/Icon.tsx'
import { SprintSetup, createIteration, fortnightAfter } from './SprintSetup.tsx'

export function SprintView({
  project,
  onOpen,
}: {
  readonly project: Project
  readonly onOpen: (itemId: string) => void
}) {
  const dispatch = useDispatch()
  const today = isoDay(Date.now())
  const iterations = project.iterations.toSorted(byOrder)

  const current =
    iterations.find((it) => it.startsAt <= today && it.endsAt >= today) ?? iterations.at(-1) ?? null

  const [selectedId, setSelectedId] = useState<string | null>(null)
  const selected = iterations.find((it) => it.id === selectedId) ?? current

  async function startSprint() {
    const made = await createIteration(project, dispatch)
    setSelectedId(made.id)
  }

  if (!selected) {
    const { startsAt, endsAt } = fortnightAfter(null)
    return (
      <div className="kb-empty">
        <Icon name="calendar" size={28} />
        <p className="kb-empty__title">No sprints yet</p>
        <p className="kb-empty__body">
          A sprint is a date range with a goal. This one will run{' '}
          <span className="data">
            {startsAt} → {endsAt}
          </span>{' '}
          and you can rename it or move either date afterwards. Its burndown and your velocity are
          then computed from the board's own history — nothing else to fill in.
        </p>
        <Button variant="primary" icon="plus" onClick={() => void startSprint()}>
          Start a sprint
        </Button>
      </div>
    )
  }

  const items = project.items.filter((item) => item.iterationId === selected.id && !item.archived)
  const committed = items.reduce((total, item) => total + (item.estimate ?? 0), 0)
  const completed = items
    .filter((item) => item.completedAt !== null)
    .reduce((total, item) => total + (item.estimate ?? 0), 0)
  const unestimated = items.filter((item) => item.estimate === null).length

  const chart = burndown(project, selected, Date.now())
  const history = velocity(project)
  const average = averageVelocity(project, Date.now())

  const burndownSeries: readonly Series[] = [
    { label: 'Remaining', colour: 'var(--signal-boarding)', values: chart.map((p) => p.remaining) },
    { label: 'Ideal', colour: 'var(--ink-faint)', values: chart.map((p) => p.ideal), dashed: true },
  ]

  const overCapacity = selected.capacity !== null && committed > selected.capacity

  return (
    <div style={{ overflowY: 'auto', padding: 'var(--space-5)' }}>
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 'var(--space-5)',
          maxWidth: '84rem',
        }}
      >
        <SprintSetup project={project} selected={selected} onSelect={setSelectedId} />

        <div className="kb-field">
          <label className="kb-field__label" htmlFor="kb-goal">
            Sprint goal
          </label>
          <input
            id="kb-goal"
            className="kb-input"
            value={selected.goal}
            placeholder="What this sprint is for, in one sentence."
            onChange={(event) =>
              void dispatch({
                kind: 'iteration.upsert',
                iteration: { ...selected, goal: event.target.value },
              })
            }
          />
        </div>

        <div className="kb-row" style={{ gap: 'var(--space-5)', flexWrap: 'wrap' }}>
          <Figure label="Committed" value={String(committed)} />
          <Figure label="Completed" value={String(completed)} colour="var(--signal-departed)" />
          <Figure
            label="Capacity"
            value={selected.capacity === null ? '—' : String(selected.capacity)}
            colour={overCapacity ? 'var(--signal-delayed)' : undefined}
          />
          <Figure label="Avg velocity" value={average === null ? '—' : average.toFixed(1)} />
          <div className="kb-field" style={{ width: '8rem' }}>
            <label className="kb-field__label" htmlFor="kb-capacity">
              Set capacity
            </label>
            <input
              id="kb-capacity"
              className="kb-input data"
              type="number"
              min={0}
              value={selected.capacity ?? ''}
              placeholder="—"
              onChange={(event) =>
                void dispatch({
                  kind: 'iteration.upsert',
                  iteration: {
                    ...selected,
                    capacity: event.target.value === '' ? null : Number(event.target.value),
                  },
                })
              }
            />
          </div>
        </div>

        {overCapacity && (
          <p
            className="kb-row"
            style={{
              color: 'var(--signal-delayed)',
              background: 'var(--signal-delayed-dim)',
              border: '1px solid color-mix(in oklab, var(--signal-delayed) 30%, transparent)',
              borderRadius: 'var(--radius)',
              padding: 'var(--space-2) var(--space-3)',
              margin: 0,
            }}
          >
            <Icon name="warning" size={14} />
            {committed} points committed against a capacity of {selected.capacity}.
          </p>
        )}

        {unestimated > 0 && (
          <p className="kb-muted" style={{ margin: 0, fontSize: 'var(--step--1)' }}>
            {unestimated} item{unestimated === 1 ? '' : 's'} in this sprint have no estimate and
            count as zero. Inventing a value for them would make the burndown a guess wearing a
            number's clothes.
          </p>
        )}

        <section
          style={{
            border: '1px solid var(--rule)',
            borderRadius: 'var(--radius-lg)',
            background: 'var(--surface)',
            padding: 'var(--space-4)',
            display: 'flex',
            flexDirection: 'column',
            gap: 'var(--space-3)',
          }}
        >
          <h2 style={{ fontSize: 'var(--step-1)' }}>Burndown</h2>
          <LineChart
            days={chart.map((point) => point.day)}
            series={burndownSeries}
            label={`Burndown for ${selected.name}`}
          />
          <Legend series={burndownSeries} />
          {chart.some((point) => point.scopeChange !== 0) && (
            <p
              className="kb-muted"
              style={{ margin: 0, fontSize: 'var(--step--1)', lineHeight: 1.6 }}
            >
              Scope changed mid-sprint:{' '}
              {chart
                .filter((point) => point.scopeChange !== 0)
                .map(
                  (point) =>
                    `${point.day.slice(5)} ${point.scopeChange > 0 ? '+' : ''}${point.scopeChange}`,
                )
                .join(', ')}
              . Without this, a sprint that grew looks like a team that stalled.
            </p>
          )}
        </section>

        <section
          style={{
            border: '1px solid var(--rule)',
            borderRadius: 'var(--radius-lg)',
            background: 'var(--surface)',
            padding: 'var(--space-4)',
            display: 'flex',
            flexDirection: 'column',
            gap: 'var(--space-3)',
          }}
        >
          <h2 style={{ fontSize: 'var(--step-1)' }}>Velocity</h2>
          <BarChart
            groups={history.map((entry) => ({
              label: entry.name,
              bars: [
                { value: entry.committed, colour: 'var(--signal-scheduled)' },
                { value: entry.completed, colour: 'var(--signal-departed)' },
              ],
            }))}
            label="Committed against completed points per sprint"
          />
          <Legend
            series={[
              { label: 'Committed', colour: 'var(--signal-scheduled)', values: [] },
              { label: 'Completed', colour: 'var(--signal-departed)', values: [] },
            ]}
          />
        </section>

        <section style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
          <h2 style={{ fontSize: 'var(--step-1)' }}>In this sprint</h2>
          {items.length === 0 ? (
            <p className="kb-muted" style={{ margin: 0 }}>
              Nothing planned yet. Assign items to this sprint from the backlog.
            </p>
          ) : (
            items.toSorted(byOrder).map((item) => (
              <button
                key={item.id}
                type="button"
                className="kb-card"
                style={{ flexDirection: 'row', alignItems: 'center', gap: 'var(--space-3)' }}
                onClick={() => onOpen(item.id)}
              >
                <span className="kb-card__ref">{item.ref}</span>
                <span>{item.title}</span>
                <span className="kb-spacer" />
                {item.estimate !== null && <span className="kb-card__points">{item.estimate}</span>}
                {item.completedAt !== null && <Icon name="check" size={14} title="Completed" />}
              </button>
            ))
          )}
        </section>
      </div>
    </div>
  )
}

function Figure({
  label,
  value,
  colour,
}: {
  readonly label: string
  readonly value: string
  readonly colour?: string | undefined
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      <span
        className="data"
        style={{ fontSize: 'var(--step-3)', letterSpacing: '-0.03em', color: colour }}
      >
        {value}
      </span>
      <span className="kb-field__label">{label}</span>
    </div>
  )
}
