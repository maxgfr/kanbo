/**
 * What the board did, measured.
 *
 * Every figure here is derived from the operation log rather than recorded
 * alongside it. That is the payoff of storing changes instead of state: a
 * status transition already carries who moved what and when, so cycle time,
 * cumulative flow, throughput and burndown need no extra bookkeeping and
 * cannot drift out of step with the board.
 *
 * Statuses are read through their *category*, never their name. A team that
 * renames "In Progress" to "Doing", or runs four in-progress columns, keeps
 * working metrics — which is the whole reason a category exists.
 */
import type { Item, Iteration, Project, StatusCategory } from '../model/types.ts'
import type { Operation } from '../ops/types.ts'
import { sortOperations } from '../ops/log.ts'

export const DAY = 86_400_000

/** A day boundary in UTC, so a chart does not shift under a timezone change. */
export function startOfDay(at: number): number {
  return Math.floor(at / DAY) * DAY
}

export function isoDay(at: number): string {
  return new Date(startOfDay(at)).toISOString().slice(0, 10)
}

export function daysBetween(from: string, to: string): readonly string[] {
  const start = Date.parse(`${from}T00:00:00Z`)
  const end = Date.parse(`${to}T00:00:00Z`)
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return []
  const days: string[] = []
  for (let at = start; at <= end; at += DAY) days.push(isoDay(at))
  return days
}

export type Transition = {
  readonly itemId: string
  readonly at: number
  readonly category: StatusCategory
}

/**
 * Every status change in the log, in order, resolved to a category.
 *
 * A move into a status the project no longer has is skipped rather than
 * guessed at: a deleted column should not silently be counted as work in
 * progress.
 */
export function transitions(project: Project, log: readonly Operation[]): readonly Transition[] {
  const categories = new Map(project.statuses.map((status) => [status.id, status.category]))
  const found: Transition[] = []

  for (const operation of sortOperations(log)) {
    if (operation.kind === 'item.create') {
      const category = categories.get(operation.item.statusId)
      if (category) found.push({ itemId: operation.item.id, at: operation.at, category })
    } else if (operation.kind === 'item.move') {
      const category = categories.get(operation.statusId)
      if (category) found.push({ itemId: operation.itemId, at: operation.at, category })
    }
  }

  return found
}

/**
 * How long a finished item took, from first starting work to completion.
 *
 * Only completed items have a cycle time; asking for one on unfinished work
 * would report a number that shrinks the moment it is written down.
 */
export function cycleTime(item: Item): number | null {
  if (item.completedAt === null || item.startedAt === null) return null
  return Math.max(0, item.completedAt - item.startedAt)
}

/** From creation to completion — what a requester actually waits. */
export function leadTime(item: Item): number | null {
  if (item.completedAt === null) return null
  return Math.max(0, item.completedAt - item.createdAt)
}

/**
 * How long an unfinished item has been in progress.
 *
 * The number teams act on: a card aging past the 85th percentile is the one to
 * talk about at standup, and it is invisible in any average.
 */
export function ageInProgress(item: Item, now: number): number | null {
  if (item.startedAt === null || item.completedAt !== null) return null
  return Math.max(0, now - item.startedAt)
}

/**
 * Percentiles over a set of durations.
 *
 * Reported instead of a mean because cycle-time distributions have a long
 * right tail: the average is shorter than most items take, and a team that
 * forecasts from it is late more often than not.
 */
export function percentile(values: readonly number[], fraction: number): number | null {
  if (values.length === 0) return null
  const sorted = [...values].toSorted((a, b) => a - b)
  const at = Math.min(sorted.length - 1, Math.max(0, Math.ceil(fraction * sorted.length) - 1))
  return sorted[at] ?? null
}

export type CycleSummary = {
  readonly count: number
  readonly p50: number | null
  readonly p85: number | null
  readonly p95: number | null
}

export function cycleSummary(items: readonly Item[]): CycleSummary {
  const values = items
    .map((item) => cycleTime(item))
    .filter((value): value is number => value !== null)

  return {
    count: values.length,
    p50: percentile(values, 0.5),
    p85: percentile(values, 0.85),
    p95: percentile(values, 0.95),
  }
}

export type FlowDay = {
  readonly day: string
  readonly todo: number
  readonly inProgress: number
  readonly done: number
}

/**
 * A cumulative flow diagram: how many items sat in each category, per day.
 *
 * Reconstructed by replaying transitions rather than sampling the board, so it
 * is correct for days nobody had the app open — which is most of them.
 */
export function cumulativeFlow(
  project: Project,
  log: readonly Operation[],
  from: string,
  to: string,
): readonly FlowDay[] {
  const changes = transitions(project, log)
  const days = daysBetween(from, to)
  if (days.length === 0) return []

  const state = new Map<string, StatusCategory>()
  let at = 0

  return days.map((day) => {
    const endOfDay = Date.parse(`${day}T00:00:00Z`) + DAY
    while (at < changes.length && changes[at]!.at < endOfDay) {
      const change = changes[at]!
      state.set(change.itemId, change.category)
      at++
    }

    let todo = 0
    let inProgress = 0
    let done = 0
    for (const category of state.values()) {
      if (category === 'todo') todo++
      else if (category === 'in-progress') inProgress++
      else done++
    }
    return { day, todo, inProgress, done }
  })
}

/** Items completed per day — the throughput a forecast is built from. */
export function throughput(
  items: readonly Item[],
  from: string,
  to: string,
): readonly { readonly day: string; readonly count: number }[] {
  const completed = new Map<string, number>()
  for (const item of items) {
    if (item.completedAt === null) continue
    const day = isoDay(item.completedAt)
    completed.set(day, (completed.get(day) ?? 0) + 1)
  }
  return daysBetween(from, to).map((day) => ({ day, count: completed.get(day) ?? 0 }))
}

export type BurndownPoint = {
  readonly day: string
  /** Points still open at the end of that day. */
  readonly remaining: number
  /** The straight line from the starting commitment to zero. */
  readonly ideal: number
  /** Points added to or removed from the sprint that day. */
  readonly scopeChange: number
}

/**
 * A sprint burndown, in points, with scope changes shown rather than hidden.
 *
 * Most burndown charts draw only the remaining line, which makes a sprint that
 * grew look like a team that stalled. Carrying the scope change separately is
 * what turns the chart into something a retrospective can use.
 *
 * Items with no estimate count as zero: inventing a value for them would make
 * the total a guess wearing a number's clothes.
 */
export function burndown(
  project: Project,
  iteration: Iteration,
  now: number,
): readonly BurndownPoint[] {
  const days = daysBetween(iteration.startsAt, iteration.endsAt)
  if (days.length === 0) return []

  const items = project.items.filter((item) => item.iterationId === iteration.id && !item.archived)
  const committed = items.reduce((total, item) => total + (item.estimate ?? 0), 0)
  const today = isoDay(now)

  let previousTotal = committed
  return days.map((day, index) => {
    const endOfDay = Date.parse(`${day}T00:00:00Z`) + DAY

    // Only items that existed by that day are in scope for it.
    const inScope = items.filter((item) => item.createdAt < endOfDay)
    const total = inScope.reduce((sum, item) => sum + (item.estimate ?? 0), 0)
    const done = inScope
      .filter((item) => item.completedAt !== null && item.completedAt < endOfDay)
      .reduce((sum, item) => sum + (item.estimate ?? 0), 0)

    const scopeChange = total - previousTotal
    previousTotal = total

    return {
      day,
      // The future is not drawn: a burndown that projects the remaining line
      // forward is asserting something it cannot know.
      remaining: day <= today ? total - done : Number.NaN,
      ideal: committed - (committed * index) / Math.max(1, days.length - 1),
      scopeChange,
    }
  })
}

export type Velocity = {
  readonly iterationId: string
  readonly name: string
  readonly committed: number
  readonly completed: number
}

/** Points committed against points completed, per iteration. */
export function velocity(project: Project): readonly Velocity[] {
  return project.iterations
    .toSorted((a, b) => (a.startsAt < b.startsAt ? -1 : a.startsAt > b.startsAt ? 1 : 0))
    .map((iteration) => {
      const items = project.items.filter(
        (item) => item.iterationId === iteration.id && !item.archived,
      )
      return {
        iterationId: iteration.id,
        name: iteration.name,
        committed: items.reduce((total, item) => total + (item.estimate ?? 0), 0),
        completed: items
          .filter((item) => item.completedAt !== null)
          .reduce((total, item) => total + (item.estimate ?? 0), 0),
      }
    })
}

/**
 * The average of the last `window` completed iterations.
 *
 * Iterations still running are excluded: counting a sprint halfway through
 * drags the average down and makes every forecast pessimistic.
 */
export function averageVelocity(project: Project, now: number, window = 3): number | null {
  const today = isoDay(now)
  const finished = velocity(project).filter((entry) => {
    const iteration = project.iterations.find((it) => it.id === entry.iterationId)
    return iteration !== undefined && iteration.endsAt < today
  })
  const recent = finished.slice(-window)
  if (recent.length === 0) return null
  return recent.reduce((total, entry) => total + entry.completed, 0) / recent.length
}
