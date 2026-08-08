/**
 * Who is carrying what.
 *
 * Every figure here is read off the board rather than recorded anywhere: there
 * is no per-person state to keep in step, and no way for this to disagree with
 * the columns it was computed from. That is the same bargain the rest of the
 * metrics make.
 *
 * Unassigned work is a lane, not an omission. A team looking at "who has what"
 * needs to see the pile nobody has picked up at least as much as it needs the
 * piles that are spoken for — and an item with two assignees counts for both,
 * because it is on both their plates.
 */
import { blockedBy, categoryOf } from '../model/project.ts'
import type { Item, Project } from '../model/types.ts'
import { ageInProgress } from './flow.ts'

export type Workload = {
  /** Null is the work nobody has taken. */
  readonly memberId: string | null
  readonly name: string
  /** Not archived and not in a done column. */
  readonly open: readonly Item[]
  /** The subset actually in an in-progress column. */
  readonly inFlight: readonly Item[]
  /** Points on open work; unestimated counts as zero rather than as a guess. */
  readonly points: number
  readonly blocked: readonly Item[]
  /** The oldest thing in flight, which is the one to talk about at standup. */
  readonly oldest: { readonly item: Item; readonly days: number } | null
}

const DAY = 24 * 60 * 60 * 1000

/**
 * One row per member, in the project's own order, then the unassigned pile.
 *
 * Members with nothing open are kept: "Grace has no work" is an answer, and a
 * table that hid her would make an empty plate look like an absent person.
 */
export function workloads(project: Project, now: number): readonly Workload[] {
  const open = project.items.filter(
    (item) => !item.archived && categoryOf(project, item.statusId) !== 'done',
  )

  const rows = project.members.map((member) =>
    rowFor(
      project,
      member.id,
      member.name,
      open.filter((item) => item.assignees.includes(member.id)),
      now,
    ),
  )

  const unassigned = open.filter((item) => item.assignees.length === 0)
  return [...rows, rowFor(project, null, 'Unassigned', unassigned, now)]
}

function rowFor(
  project: Project,
  memberId: string | null,
  name: string,
  open: readonly Item[],
  now: number,
): Workload {
  const inFlight = open.filter((item) => categoryOf(project, item.statusId) === 'in-progress')

  let oldest: Workload['oldest'] = null
  for (const item of inFlight) {
    const age = ageInProgress(item, now)
    if (age === null) continue
    const days = Math.floor(age / DAY)
    if (!oldest || days > oldest.days) oldest = { item, days }
  }

  return {
    memberId,
    name,
    open,
    inFlight,
    points: open.reduce((total, item) => total + (item.estimate ?? 0), 0),
    blocked: open.filter((item) => blockedBy(project, item).length > 0),
    oldest,
  }
}

/**
 * The busiest lane, used to scale the bars against each other.
 *
 * Scaling each bar to its own row would draw every person as full and say
 * nothing; scaling to a fixed number would say nothing about this team. One is
 * the floor so a board with no open work does not divide by zero.
 */
export function busiest(rows: readonly Workload[]): number {
  return Math.max(1, ...rows.map((row) => row.open.length))
}
