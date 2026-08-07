import { DAY, type Item, type Project, isoDay, statusById } from '@kanbo/core'
import { useMemo } from 'react'

import { Icon } from '../design/Icon.tsx'
import { signalForCategory } from '../design/StatusChip.tsx'

/**
 * The roadmap, in the grammar of a technical drawing.
 *
 * Bars are the work; the thin leaders between them are dependencies, drawn the
 * way a drafting sheet draws a relation rather than as decorative arrows. An
 * item with no dates has no bar — a roadmap that invents a schedule for
 * unplanned work is the most confident kind of wrong.
 */
const ROW = 34
const BAR = 18
const LABEL_WIDTH = 220

/**
 * How far ahead a roadmap will draw.
 *
 * `<input type="date">` accepts the year 275760, so one mistyped due date used
 * to ask this view for four hundred thousand gridlines and as many SVG nodes —
 * a tab that hangs, on every device the board syncs to, with no way back except
 * finding the item in another view. Five years is well past any roadmap anyone
 * is reading, and what falls outside is said rather than silently dropped.
 */
const HORIZON = 5 * 365 * DAY

type Placed = {
  readonly item: Item
  readonly row: number
  readonly from: number
  readonly to: number
}

function dateOf(value: string | null): number | null {
  if (!value) return null
  const parsed = Date.parse(`${value}T00:00:00Z`)
  return Number.isFinite(parsed) ? parsed : null
}

export function RoadmapView({
  project,
  onOpen,
}: {
  readonly project: Project
  readonly onOpen: (itemId: string) => void
}) {
  const { placed, beyond } = useMemo<{ placed: readonly Placed[]; beyond: number }>(() => {
    const rows: Placed[] = []
    const horizon = Date.now() + HORIZON
    const scheduled = project.items.filter((item) => !item.archived && item.dueOn !== null)
    const within = scheduled.filter((item) => {
      const due = dateOf(item.dueOn)
      return due !== null && due <= horizon
    })

    within
      .toSorted((a, b) => (a.dueOn! < b.dueOn! ? -1 : a.dueOn! > b.dueOn! ? 1 : 0))
      .forEach((item, index) => {
        const due = dateOf(item.dueOn)!
        // Work that has started has a real beginning; work that has not gets a
        // nominal week so the bar is visible without claiming a start date.
        const start = item.startedAt ?? due - 7 * DAY
        rows.push({ item, row: index, from: Math.min(start, due), to: due })
      })

    return { placed: rows, beyond: scheduled.length - within.length }
  }, [project.items])

  const unscheduled = project.items.filter((item) => !item.archived && item.dueOn === null)

  if (placed.length === 0) {
    return (
      <div className="kb-empty">
        <Icon name="roadmap" size={28} />
        <p className="kb-empty__title">Nothing is scheduled</p>
        <p className="kb-empty__body">
          Give an item a due date and it appears here as a bar. Items without dates are left off
          deliberately — a roadmap that invents a schedule is the most confident kind of wrong.
        </p>
        {beyond > 0 && (
          <p className="kb-empty__body">
            {beyond} item{beyond === 1 ? ' has a date' : 's have dates'} more than five years out,
            so {beyond === 1 ? 'it is' : 'they are'} not drawn. That is usually a mistyped year.
          </p>
        )}
      </div>
    )
  }

  const from = Math.min(...placed.map((entry) => entry.from))
  const to = Math.max(...placed.map((entry) => entry.to))
  const span = Math.max(DAY, to - from)
  const width = 900
  const height = placed.length * ROW + 40
  const today = Date.now()

  const x = (at: number) => LABEL_WIDTH + ((width - LABEL_WIDTH - 20) * (at - from)) / span
  const rowOf = (id: string) => placed.find((entry) => entry.item.id === id)

  // Week gridlines, so a bar's length can be read rather than guessed.
  const weeks: number[] = []
  for (let at = Math.ceil(from / (7 * DAY)) * 7 * DAY; at <= to; at += 7 * DAY) weeks.push(at)

  return (
    <div style={{ overflow: 'auto', padding: 'var(--space-4)' }}>
      {/*
        A group rather than an image. `role="img"` collapses everything inside
        into one node, so a screen reader was told "Roadmap timeline with
        dependencies" and nothing else — none of the work it depicts, and no way
        to reach any of it.
      */}
      <svg
        viewBox={`0 0 ${width} ${height}`}
        width={width}
        height={height}
        role="group"
        aria-label="Roadmap timeline with dependencies"
      >
        {weeks.map((at) => (
          <g key={at}>
            <line
              x1={x(at)}
              x2={x(at)}
              y1={18}
              y2={height - 10}
              stroke="var(--rule)"
              strokeWidth={1}
            />
            <text
              x={x(at)}
              y={12}
              textAnchor="middle"
              fill="var(--ink-faint)"
              fontSize={10}
              fontFamily="var(--font-data)"
            >
              {isoDay(at).slice(5)}
            </text>
          </g>
        ))}

        {today >= from && today <= to && (
          <line
            x1={x(today)}
            x2={x(today)}
            y1={18}
            y2={height - 10}
            stroke="var(--signal-cancelled)"
            strokeWidth={1}
            strokeDasharray="3 3"
          />
        )}

        {/* Dependency leaders are drawn under the bars so they never obscure a
            label, and only when both ends are actually on the chart. */}
        {placed.map((entry) =>
          entry.item.links
            .filter((link) => link.type === 'blocked-by')
            .map((link) => {
              const blocker = rowOf(link.itemId)
              if (!blocker) return null
              const y1 = 30 + blocker.row * ROW + BAR / 2
              const y2 = 30 + entry.row * ROW + BAR / 2
              const x1 = x(blocker.to)
              const x2 = x(entry.from)
              const mid = Math.max(x1 + 8, x2 - 8)
              return (
                <path
                  key={`${entry.item.id}-${link.itemId}`}
                  d={`M${x1} ${y1} H${mid} V${y2} H${x2}`}
                  fill="none"
                  stroke="var(--signal-cancelled)"
                  strokeWidth={1}
                  strokeOpacity={0.7}
                  markerEnd="url(#kb-arrow)"
                />
              )
            }),
        )}

        <defs>
          <marker
            id="kb-arrow"
            viewBox="0 0 8 8"
            refX={7}
            refY={4}
            markerWidth={6}
            markerHeight={6}
            orient="auto"
          >
            <path d="M0 1 L7 4 L0 7 z" fill="var(--signal-cancelled)" />
          </marker>
        </defs>

        {placed.map((entry) => {
          const status = statusById(project, entry.item.statusId)
          const signal = status ? signalForCategory(status.category) : 'scheduled'
          const overdue =
            entry.item.completedAt === null && entry.item.dueOn !== null && entry.to < today
          const y = 30 + entry.row * ROW

          return (
            <g
              key={entry.item.id}
              // Reachable from the keyboard, like every other way into an item.
              // A bare `onClick` on a `<g>` is a control only a pointer can
              // find, and a roadmap only a mouse can read fails the same
              // promise the board keeps.
              role="button"
              tabIndex={0}
              aria-label={`${entry.item.ref}, ${entry.item.title}, due ${entry.item.dueOn}`}
              onClick={() => onOpen(entry.item.id)}
              onKeyDown={(event) => {
                if (event.key !== 'Enter' && event.key !== ' ') return
                event.preventDefault()
                onOpen(entry.item.id)
              }}
              style={{ cursor: 'pointer' }}
            >
              <text
                x={0}
                y={y + BAR / 2 + 4}
                fill="var(--ink)"
                fontSize={12}
                fontFamily="var(--font-ui)"
              >
                <tspan fill="var(--ink-faint)" fontFamily="var(--font-data)">
                  {entry.item.ref}
                </tspan>
                <tspan dx={8}>
                  {entry.item.title.length > 24
                    ? `${entry.item.title.slice(0, 24)}…`
                    : entry.item.title}
                </tspan>
              </text>
              <rect
                x={x(entry.from)}
                y={y}
                width={Math.max(4, x(entry.to) - x(entry.from))}
                height={BAR}
                rx={3}
                fill={`var(--signal-${signal}-dim)`}
                stroke={
                  overdue
                    ? 'var(--signal-cancelled)'
                    : `color-mix(in oklab, var(--signal-${signal}) 45%, transparent)`
                }
                strokeWidth={1}
              />
              {entry.item.estimate !== null && (
                <text
                  x={x(entry.to) - 6}
                  y={y + BAR / 2 + 4}
                  textAnchor="end"
                  fill={`var(--signal-${signal})`}
                  fontSize={10}
                  fontFamily="var(--font-data)"
                >
                  {entry.item.estimate}
                </text>
              )}
            </g>
          )
        })}
      </svg>

      {unscheduled.length > 0 && (
        <p className="kb-muted" style={{ marginTop: 'var(--space-4)', fontSize: 'var(--step--1)' }}>
          {unscheduled.length} item{unscheduled.length === 1 ? '' : 's'} have no due date and are
          not shown.
        </p>
      )}

      {beyond > 0 && (
        <p className="kb-muted" style={{ marginTop: 'var(--space-2)', fontSize: 'var(--step--1)' }}>
          {beyond} item{beyond === 1 ? ' is' : 's are'} due more than five years out and{' '}
          {beyond === 1 ? 'is' : 'are'} not drawn. Usually that is a mistyped year — stretching the
          chart to reach it would make everything else unreadable.
        </p>
      )}
    </div>
  )
}
