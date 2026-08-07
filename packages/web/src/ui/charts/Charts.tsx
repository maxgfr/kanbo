/**
 * Charts drawn as geometry, in the board's own palette.
 *
 * No charting library: one would be a network dependency this app cannot take,
 * and every mark here is a handful of path commands. The rules that keep them
 * part of the same design — hairline axes, tabular figures, colour that only
 * ever means a status — are the same rules the board follows.
 *
 * Each chart states its own empty case rather than rendering axes around
 * nothing, because an empty chart reads as a broken one.
 */
import type { ReactNode } from 'react'

const PADDING = { top: 12, right: 12, bottom: 26, left: 34 }

type FrameProps = {
  readonly width: number
  readonly height: number
  readonly label: string
  readonly children: ReactNode
}

function Frame({ width, height, label, children }: FrameProps) {
  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      width="100%"
      role="img"
      aria-label={label}
      // A fixed height fights the viewBox and letterboxes the chart inside its
      // own panel. Width drives it; the aspect ratio does the rest.
      style={{ display: 'block', height: 'auto', overflow: 'visible' }}
    >
      {children}
    </svg>
  )
}

function Empty({ message }: { readonly message: string }) {
  return (
    <p className="kb-muted" style={{ margin: 0, padding: 'var(--space-4) 0' }}>
      {message}
    </p>
  )
}

/**
 * Integer graduations.
 *
 * With four ticks over a range of one, every label rounds to 0 or 1 and the
 * axis reads `1 1 1 0 0` — which looks like a rendering bug because it is one.
 */
function tickCount(max: number): number {
  return Math.max(1, Math.min(4, Math.round(max)))
}

function niceMax(value: number): number {
  if (value <= 0) return 1
  const magnitude = 10 ** Math.floor(Math.log10(value))
  return Math.ceil(value / magnitude) * magnitude
}

type Axes = {
  readonly width: number
  readonly height: number
  readonly max: number
  readonly ticks: number
}

function Grid({ width, height, max, ticks }: Axes) {
  const inner = height - PADDING.top - PADDING.bottom
  return (
    <g>
      {Array.from({ length: ticks + 1 }, (_, index) => {
        const value = (max * index) / ticks
        const y = PADDING.top + inner - (inner * index) / ticks
        return (
          <g key={index}>
            <line
              x1={PADDING.left}
              x2={width - PADDING.right}
              y1={y}
              y2={y}
              stroke="var(--rule)"
              strokeWidth={1}
            />
            <text
              x={PADDING.left - 6}
              y={y + 3}
              textAnchor="end"
              fill="var(--ink-faint)"
              fontSize={10}
              fontFamily="var(--font-data)"
            >
              {Math.round(value)}
            </text>
          </g>
        )
      })}
    </g>
  )
}

function DayLabels({
  days,
  width,
  height,
}: {
  readonly days: readonly string[]
  readonly width: number
  readonly height: number
}) {
  const inner = width - PADDING.left - PADDING.right
  // Labels are thinned rather than rotated: a rotated axis is unreadable at the
  // sizes these charts actually appear in.
  const every = Math.max(1, Math.ceil(days.length / 8))
  return (
    <g>
      {days.map((day, index) =>
        index % every === 0 ? (
          <text
            key={day}
            x={PADDING.left + (inner * index) / Math.max(1, days.length - 1)}
            y={height - PADDING.bottom + 14}
            textAnchor="middle"
            fill="var(--ink-faint)"
            fontSize={10}
            fontFamily="var(--font-data)"
          >
            {day.slice(5)}
          </text>
        ) : null,
      )}
    </g>
  )
}

export type Series = {
  readonly label: string
  readonly colour: string
  readonly values: readonly number[]
  readonly dashed?: boolean
}

export type LineChartProps = {
  readonly days: readonly string[]
  readonly series: readonly Series[]
  readonly height?: number
  readonly label: string
}

export function LineChart({ days, series, height = 200, label }: LineChartProps) {
  if (days.length === 0) return <Empty message="No days to chart yet." />

  const width = 640
  const inner = {
    w: width - PADDING.left - PADDING.right,
    h: height - PADDING.top - PADDING.bottom,
  }
  const max = niceMax(
    Math.max(
      1,
      ...series.flatMap((entry) => entry.values.filter((value) => Number.isFinite(value))),
    ),
  )

  const x = (index: number) => PADDING.left + (inner.w * index) / Math.max(1, days.length - 1)
  const y = (value: number) => PADDING.top + inner.h - (inner.h * value) / max

  return (
    <Frame width={width} height={height} label={label}>
      <Grid width={width} height={height} max={max} ticks={tickCount(max)} />
      {series.map((entry) => {
        // NaN marks days that have not happened. The line stops there rather
        // than projecting a value nobody can know yet.
        const segments: string[] = []
        let open = false
        entry.values.forEach((value, index) => {
          if (!Number.isFinite(value)) {
            open = false
            return
          }
          segments.push(`${open ? 'L' : 'M'}${x(index)} ${y(value)}`)
          open = true
        })
        return (
          <path
            key={entry.label}
            d={segments.join(' ')}
            fill="none"
            stroke={entry.colour}
            strokeWidth={entry.dashed ? 1 : 2}
            strokeDasharray={entry.dashed ? '4 4' : undefined}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        )
      })}
      <DayLabels days={days} width={width} height={height} />
    </Frame>
  )
}

export function StackedAreaChart({ days, series, height = 220, label }: LineChartProps) {
  if (days.length === 0) return <Empty message="No days to chart yet." />

  const width = 640
  const inner = {
    w: width - PADDING.left - PADDING.right,
    h: height - PADDING.top - PADDING.bottom,
  }

  const totals = days.map((_, index) =>
    series.reduce((sum, entry) => sum + (entry.values[index] ?? 0), 0),
  )
  const max = niceMax(Math.max(1, ...totals))

  const x = (index: number) => PADDING.left + (inner.w * index) / Math.max(1, days.length - 1)
  const y = (value: number) => PADDING.top + inner.h - (inner.h * value) / max

  const running = days.map(() => 0)

  return (
    <Frame width={width} height={height} label={label}>
      <Grid width={width} height={height} max={max} ticks={tickCount(max)} />
      {series.map((entry) => {
        const lower = [...running]
        entry.values.forEach((value, index) => {
          running[index] = (running[index] ?? 0) + value
        })
        const top = running.map((value, index) => `${x(index)} ${y(value)}`).join(' L')
        const bottom = lower
          .map((value, index) => `${x(index)} ${y(value)}`)
          .toReversed()
          .join(' L')
        return (
          <path
            key={entry.label}
            d={`M${top} L${bottom} Z`}
            fill={entry.colour}
            fillOpacity={0.85}
            stroke="none"
          />
        )
      })}
      <DayLabels days={days} width={width} height={height} />
    </Frame>
  )
}

export type BarGroup = {
  readonly label: string
  readonly bars: readonly { readonly value: number; readonly colour: string }[]
}

export function BarChart({
  groups,
  height = 200,
  label,
}: {
  readonly groups: readonly BarGroup[]
  readonly height?: number
  readonly label: string
}) {
  if (groups.length === 0) return <Empty message="Nothing to compare yet." />

  const width = 640
  const inner = {
    w: width - PADDING.left - PADDING.right,
    h: height - PADDING.top - PADDING.bottom,
  }
  const max = niceMax(Math.max(1, ...groups.flatMap((group) => group.bars.map((bar) => bar.value))))

  const slot = inner.w / groups.length
  const barWidth = Math.max(4, Math.min(18, (slot * 0.7) / Math.max(1, groups[0]!.bars.length)))

  return (
    <Frame width={width} height={height} label={label}>
      <Grid width={width} height={height} max={max} ticks={tickCount(max)} />
      {groups.map((group, groupIndex) => {
        const centre = PADDING.left + slot * (groupIndex + 0.5)
        const span = barWidth * group.bars.length
        return (
          <g key={group.label}>
            {group.bars.map((bar, barIndex) => {
              const barHeight = (inner.h * bar.value) / max
              return (
                <rect
                  key={barIndex}
                  x={centre - span / 2 + barIndex * barWidth}
                  y={PADDING.top + inner.h - barHeight}
                  width={barWidth - 2}
                  height={Math.max(0, barHeight)}
                  fill={bar.colour}
                  rx={2}
                />
              )
            })}
            <text
              x={centre}
              y={height - PADDING.bottom + 14}
              textAnchor="middle"
              fill="var(--ink-faint)"
              fontSize={10}
              fontFamily="var(--font-data)"
            >
              {group.label}
            </text>
          </g>
        )
      })}
    </Frame>
  )
}

export function Legend({ series }: { readonly series: readonly Series[] }) {
  return (
    <div className="kb-row" style={{ gap: 'var(--space-4)', flexWrap: 'wrap' }}>
      {series.map((entry) => (
        <span key={entry.label} className="kb-row" style={{ gap: 'var(--space-2)' }}>
          <span
            aria-hidden
            style={{
              width: 10,
              height: 2,
              background: entry.colour,
              borderRadius: 2,
              display: 'inline-block',
            }}
          />
          <span className="kb-muted" style={{ fontSize: 'var(--step--1)' }}>
            {entry.label}
          </span>
        </span>
      ))}
    </div>
  )
}
