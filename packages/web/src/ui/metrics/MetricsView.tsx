import {
  DAY,
  type Project,
  ageInProgress,
  cumulativeFlow,
  cycleSummary,
  isoDay,
  throughput,
} from '@kanbo/core'
import { useMemo } from 'react'

import { useLog } from '../../state/useStore'
import { BarChart, Legend, type Series, StackedAreaChart } from '../charts/Charts'
import { Icon } from '../design/Icon'

function days(count: number, now: number): { from: string; to: string } {
  return { from: isoDay(now - count * DAY), to: isoDay(now) }
}

function duration(ms: number | null): string {
  if (ms === null) return '—'
  const inDays = ms / DAY
  if (inDays < 1) return `${Math.max(1, Math.round(ms / 3_600_000))}h`
  return `${inDays.toFixed(1)}d`
}

export function MetricsView({ project }: { readonly project: Project }) {
  const log = useLog()
  const now = Date.now()
  const window = days(29, now)

  const flow = useMemo(
    () => cumulativeFlow(project, log, window.from, window.to),
    [project, log, window.from, window.to],
  )

  const done = project.items.filter((item) => item.completedAt !== null)
  const cycle = cycleSummary(done)
  const rate = throughput(project.items, window.from, window.to)

  const aging = project.items
    .map((item) => ({ item, age: ageInProgress(item, now) }))
    .filter(
      (entry): entry is { item: (typeof project.items)[number]; age: number } => entry.age !== null,
    )
    .toSorted((a, b) => b.age - a.age)

  const flowSeries: readonly Series[] = [
    { label: 'Done', colour: 'var(--signal-departed)', values: flow.map((day) => day.done) },
    {
      label: 'In progress',
      colour: 'var(--signal-boarding)',
      values: flow.map((day) => day.inProgress),
    },
    { label: 'To do', colour: 'var(--signal-scheduled)', values: flow.map((day) => day.todo) },
  ]

  if (project.items.length === 0) {
    return (
      <div className="kb-empty">
        <Icon name="metrics" size={28} />
        <p className="kb-empty__title">Nothing measured yet</p>
        <p className="kb-empty__body">
          These charts are computed from the history the board already keeps. Move a few cards and
          they fill in on their own — nothing needs to be recorded by hand.
        </p>
      </div>
    )
  }

  return (
    <div style={{ overflowY: 'auto', padding: 'var(--space-5)' }}>
      <div
        style={{
          display: 'grid',
          gap: 'var(--space-5)',
          gridTemplateColumns: 'repeat(auto-fit, minmax(20rem, 1fr))',
          maxWidth: '84rem',
        }}
      >
        <Panel title="Cycle time" note={`${cycle.count} completed`}>
          <div className="kb-row" style={{ gap: 'var(--space-5)' }}>
            <Figure label="50th" value={duration(cycle.p50)} />
            <Figure label="85th" value={duration(cycle.p85)} />
            <Figure label="95th" value={duration(cycle.p95)} />
          </div>
          <p
            className="kb-muted"
            style={{ margin: 0, fontSize: 'var(--step--1)', lineHeight: 1.6 }}
          >
            Percentiles rather than an average: cycle times have a long tail, and a team that
            forecasts from the mean is late more often than not. Eighty-five per cent of items
            finished within the middle figure.
          </p>
        </Panel>

        <Panel title="Aging work in progress" note={`${aging.length} in flight`}>
          {aging.length === 0 ? (
            <p className="kb-muted" style={{ margin: 0 }}>
              Nothing is in progress.
            </p>
          ) : (
            <ul style={{ margin: 0, padding: 0, listStyle: 'none' }}>
              {aging.slice(0, 6).map(({ item, age }) => {
                const past85 = cycle.p85 !== null && age > cycle.p85
                return (
                  <li
                    key={item.id}
                    className="kb-row"
                    style={{ padding: 'var(--space-1) 0', gap: 'var(--space-3)' }}
                  >
                    <span className="data kb-muted" style={{ fontSize: 'var(--step--1)' }}>
                      {item.ref}
                    </span>
                    <span
                      style={{
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {item.title}
                    </span>
                    <span className="kb-spacer" />
                    <span
                      className="data"
                      style={{ color: past85 ? 'var(--signal-delayed)' : 'var(--ink-muted)' }}
                    >
                      {duration(age)}
                    </span>
                  </li>
                )
              })}
            </ul>
          )}
          <p
            className="kb-muted"
            style={{ margin: 0, fontSize: 'var(--step--1)', lineHeight: 1.6 }}
          >
            Anything past the 85th percentile is worth a conversation. This is the card an average
            hides.
          </p>
        </Panel>

        <Panel title="Cumulative flow" note="last 30 days" wide>
          <StackedAreaChart
            days={flow.map((day) => day.day)}
            series={flowSeries}
            label="Cumulative flow over the last thirty days"
          />
          <Legend series={flowSeries} />
          <p
            className="kb-muted"
            style={{ margin: 0, fontSize: 'var(--step--1)', lineHeight: 1.6 }}
          >
            A widening blue band means work is being started faster than it is finished.
          </p>
        </Panel>

        <Panel title="Throughput" note="items completed per day" wide>
          <BarChart
            groups={rate.map((day) => ({
              label: day.day.slice(5),
              bars: [{ value: day.count, colour: 'var(--signal-departed)' }],
            }))}
            label="Items completed per day over the last thirty days"
          />
        </Panel>
      </div>
    </div>
  )
}

function Panel({
  title,
  note,
  wide,
  children,
}: {
  readonly title: string
  readonly note?: string
  readonly wide?: boolean
  readonly children: React.ReactNode
}) {
  return (
    <section
      style={{
        gridColumn: wide ? '1 / -1' : undefined,
        border: '1px solid var(--rule)',
        borderRadius: 'var(--radius-lg)',
        background: 'var(--surface)',
        padding: 'var(--space-4)',
        display: 'flex',
        flexDirection: 'column',
        gap: 'var(--space-3)',
      }}
    >
      <div className="kb-row">
        <h2 style={{ fontSize: 'var(--step-1)' }}>{title}</h2>
        {note && (
          <span className="kb-muted data" style={{ fontSize: 'var(--step--1)' }}>
            {note}
          </span>
        )}
      </div>
      {children}
    </section>
  )
}

function Figure({ label, value }: { readonly label: string; readonly value: string }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      <span className="data" style={{ fontSize: 'var(--step-3)', letterSpacing: '-0.03em' }}>
        {value}
      </span>
      <span className="kb-field__label">{label}</span>
    </div>
  )
}
