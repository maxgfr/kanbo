import {
  type BurndownPoint,
  type Comment,
  type CycleSummary,
  type FlowDay,
  type HistoryEntry,
  type Item,
  type Iteration,
  type Label,
  type Milestone,
  type Project,
  type Status,
  type Velocity,
  type Workload,
  DAY,
  ageInProgress,
  averageVelocity,
  blockedBy,
  burndown,
  byOrder,
  categoryOf,
  changelogMarkdown,
  childrenOf,
  cumulativeFlow,
  cycleSummary,
  cycleTime,
  historyOf,
  isoDay,
  itemById,
  leadTime,
  memberById,
  milestoneProgress,
  statusById,
  subtreeProgress,
  suggestedTitle,
  throughput,
  velocity,
  workloads,
} from '@kanbo/core'

import { resolveItem, resolveMilestone, resolveSprint } from './resolve.ts'
import type { Workspace } from './session.ts'

/**
 * Everything the browser can show, as values a terminal can print.
 *
 * A chart does not survive the trip, but the numbers that produce it do, and
 * they are the same numbers: every function called here is the one the web view
 * calls. A burndown that disagreed between the two would mean one of them was
 * computing it, and neither is.
 */

// ----------------------------------------------------------------- item

export type ItemDetail = {
  readonly item: Item
  readonly status: Status | null
  readonly assignees: readonly string[]
  readonly labels: readonly string[]
  readonly sprint: Iteration | null
  readonly release: Milestone | null
  readonly parent: Item | null
  readonly children: readonly Item[]
  readonly progress: { readonly total: number; readonly done: number }
  readonly blockedBy: readonly Item[]
  readonly links: readonly { readonly type: string; readonly item: Item }[]
  readonly comments: readonly (Comment & { readonly author: string | null })[]
  readonly fields: readonly { readonly name: string; readonly value: unknown }[]
  readonly cycleTimeDays: number | null
  readonly leadTimeDays: number | null
  readonly ageDays: number | null
}

export function itemDetail(workspace: Workspace, ref: string, now: number): ItemDetail {
  const { project } = workspace
  const item = resolveItem(project, ref)

  const days = (ms: number | null) => (ms === null ? null : Math.round((ms / DAY) * 10) / 10)

  return {
    item,
    status: statusById(project, item.statusId) ?? null,
    assignees: item.assignees.map((id) => memberById(project, id)?.name ?? id),
    labels: item.labels.map(
      (id) => project.labels.find((label: Label) => label.id === id)?.name ?? id,
    ),
    sprint: project.iterations.find((it) => it.id === item.iterationId) ?? null,
    release: project.milestones.find((m) => m.id === item.milestoneId) ?? null,
    parent: item.parentId ? (itemById(project, item.parentId) ?? null) : null,
    children: childrenOf(project, item.id),
    progress: subtreeProgress(project, item.id),
    blockedBy: blockedBy(project, item),
    links: item.links.flatMap((link) => {
      const other = itemById(project, link.itemId)
      return other ? [{ type: link.type, item: other }] : []
    }),
    comments: project.comments
      .filter((comment) => comment.itemId === item.id)
      .toSorted((a, b) => a.createdAt - b.createdAt)
      .map((comment) => ({
        ...comment,
        author: comment.authorId ? (memberById(project, comment.authorId)?.name ?? null) : null,
      })),
    fields: project.fields
      .toSorted(byOrder)
      .filter((field) => item.fields[field.id] !== undefined && item.fields[field.id] !== null)
      .map((field) => ({ name: field.name, value: item.fields[field.id] })),
    cycleTimeDays: days(cycleTime(item)),
    leadTimeDays: days(leadTime(item)),
    ageDays: days(ageInProgress(item, now)),
  }
}

// -------------------------------------------------------------- history

export type HistoryLine = {
  readonly entry: HistoryEntry
  /** Names resolved, so a front-end never has to look anything up to print it. */
  readonly from: string | null
  readonly to: string | null
  readonly target: string | null
  readonly author: string | null
  /**
   * A field change with its ids turned back into names.
   *
   * `iterationId: nothing → 1n0j6s584h…` is technically what happened and tells
   * a reader nothing. Null for fields that were never ids in the first place.
   */
  readonly fromNames: readonly string[] | null
  readonly toNames: readonly string[] | null
}

/** The entity a field's value refers to, when the value is an id. */
function namesFor(project: Project, field: string, value: unknown): readonly string[] | null {
  const lookup = (id: string): string => {
    switch (field) {
      case 'iterationId':
        return project.iterations.find((it) => it.id === id)?.name ?? id
      case 'milestoneId':
        return project.milestones.find((m) => m.id === id)?.name ?? id
      case 'parentId':
        return itemById(project, id)?.ref ?? id
      case 'assignees':
        return memberById(project, id)?.name ?? id
      case 'labels':
        return project.labels.find((label) => label.id === id)?.name ?? id
      default:
        return id
    }
  }

  const fields = ['iterationId', 'milestoneId', 'parentId', 'assignees', 'labels']
  if (!fields.includes(field)) return null

  if (value === null || value === undefined) return []
  if (Array.isArray(value)) return value.map((entry) => lookup(String(entry)))
  return [lookup(String(value))]
}

/**
 * What happened, with the ids turned back into names.
 *
 * Deliberately not a sentence: the browser builds its own English from these
 * same values, and an MCP client is better served by the structure than by
 * prose it would have to parse back.
 */
export function history(workspace: Workspace, ref: string): readonly HistoryLine[] {
  const { project } = workspace
  const item = resolveItem(project, ref)

  return historyOf(workspace.log, item.id).map((entry) => {
    const change = entry.change
    return {
      entry,
      from:
        change.kind === 'moved' && change.fromStatusId
          ? (statusById(project, change.fromStatusId)?.name ?? null)
          : null,
      to: change.kind === 'moved' ? (statusById(project, change.toStatusId)?.name ?? null) : null,
      target:
        change.kind === 'linked' || change.kind === 'unlinked'
          ? (itemById(project, change.targetId)?.ref ?? null)
          : null,
      author: entry.authorId ? (memberById(project, entry.authorId)?.name ?? null) : null,
      fromNames: change.kind === 'field' ? namesFor(project, change.field, change.from) : null,
      toNames: change.kind === 'field' ? namesFor(project, change.field, change.to) : null,
    }
  })
}

// --------------------------------------------------------------- people

export function people(workspace: Workspace, now: number): readonly Workload[] {
  return workloads(workspace.project, now)
}

// -------------------------------------------------------------- sprints

export type SprintReport = {
  readonly sprint: Iteration
  readonly items: readonly Item[]
  readonly committed: number
  readonly done: number
  readonly unestimated: number
  readonly burndown: readonly BurndownPoint[]
}

export function sprintReport(workspace: Workspace, name: string, now: number): SprintReport {
  const { project } = workspace
  const sprint = resolveSprint(project, name, now)

  const items = project.items.filter((item) => item.iterationId === sprint.id && !item.archived)
  const finished = items.filter((item) => item.completedAt !== null)

  return {
    sprint,
    items,
    committed: items.reduce((total, item) => total + (item.estimate ?? 0), 0),
    done: finished.reduce((total, item) => total + (item.estimate ?? 0), 0),
    unestimated: items.filter((item) => item.estimate === null).length,
    burndown: burndown(project, sprint, now),
  }
}

export function velocities(workspace: Workspace, now: number) {
  return {
    sprints: velocity(workspace.project) as readonly Velocity[],
    average: averageVelocity(workspace.project, now, 3),
  }
}

// ----------------------------------------------------------- milestones

export type ReleaseRow = {
  readonly milestone: Milestone
  readonly total: number
  readonly done: number
  readonly points: number
  readonly donePoints: number
}

export function releases(workspace: Workspace): readonly ReleaseRow[] {
  return workspace.project.milestones
    .toSorted(byOrder)
    .map((milestone) => ({ milestone, ...milestoneProgress(workspace.project, milestone) }))
}

/** Release notes generated from what actually shipped. */
export function releaseNotes(
  workspace: Workspace,
  options: { release?: string; days?: number; sprint?: string },
  now: number,
): string {
  const { project } = workspace

  if (options.release !== undefined) {
    const milestone = resolveMilestone(project, options.release)
    return changelogMarkdown(project, milestone.name, { milestoneId: milestone.id })
  }
  if (options.sprint !== undefined) {
    const sprint = resolveSprint(project, options.sprint, now)
    return changelogMarkdown(project, sprint.name, { iterationId: sprint.id })
  }

  const days = options.days ?? 14
  return changelogMarkdown(project, suggestedTitle(now), { from: now - days * DAY, to: now })
}

// -------------------------------------------------------------- roadmap

export type RoadmapBar = {
  readonly item: Item
  readonly startsOn: string | null
  readonly endsOn: string
  readonly overdue: boolean
  readonly blockedBy: readonly string[]
}

/**
 * The roadmap, as the rows the drawing is made of.
 *
 * An item with no dates gets no bar, here as on the web: a roadmap that invents
 * a schedule is the most confident kind of wrong.
 */
export function roadmap(workspace: Workspace, now: number): readonly RoadmapBar[] {
  const { project } = workspace
  const today = isoDay(now)

  return project.items
    .filter((item) => !item.archived && item.dueOn !== null)
    .toSorted((a, b) => (a.dueOn ?? '').localeCompare(b.dueOn ?? ''))
    .map((item) => ({
      item,
      startsOn: item.startedAt === null ? null : isoDay(item.startedAt),
      endsOn: item.dueOn!,
      overdue: item.completedAt === null && item.dueOn! < today,
      blockedBy: blockedBy(project, item).map((blocker) => blocker.ref),
    }))
}

// -------------------------------------------------------------- metrics

export type Metrics = {
  readonly cycle: CycleSummary
  readonly aging: readonly { readonly item: Item; readonly days: number }[]
  readonly throughput: readonly { readonly day: string; readonly count: number }[]
  readonly flow: readonly FlowDay[]
}

export function metrics(workspace: Workspace, now: number, days = 30): Metrics {
  const { project } = workspace
  const from = isoDay(now - days * DAY)
  const to = isoDay(now)

  const finished = project.items.filter((item) => item.completedAt !== null && !item.archived)

  const aging = project.items
    .filter((item) => categoryOf(project, item.statusId) === 'in-progress' && !item.archived)
    .map((item) => ({ item, days: Math.round(((ageInProgress(item, now) ?? 0) / DAY) * 10) / 10 }))
    .toSorted((a, b) => b.days - a.days)

  return {
    cycle: cycleSummary(finished),
    aging,
    throughput: throughput(project.items, from, to).map((entry) => ({ ...entry })),
    flow: cumulativeFlow(project, workspace.log, from, to),
  }
}
