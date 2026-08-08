import {
  type ItemPatch,
  type ItemType,
  type Label,
  type Member,
  type OperationBody,
  type Priority,
  type Project,
  descendantsOf,
  wouldNestCycle,
} from '@kanbo/core'

import { KanboError, resolveItem, resolveMilestone, resolveSprint } from './resolve.ts'
import type { Workspace } from './session.ts'

/**
 * What somebody typed, turned into a patch the domain will accept.
 *
 * A flag on a command line and a field in a JSON tool call arrive as different
 * shapes but mean the same thing, and both have to answer the same questions:
 * is `p9` a priority, does this sprint exist, is that parent one of this item's
 * own children. Answering them twice would be two chances to disagree about
 * what a project allows.
 *
 * Some of these do not resolve to an id but to a *new entity* — assigning to
 * someone this project has never seen invents them, exactly as the board does
 * from an item. So the result carries the operations that must be committed
 * alongside the patch, rather than committing them itself.
 */
export type PatchSpec = {
  readonly title?: string
  readonly description?: string
  readonly type?: string
  readonly priority?: string
  /** A number, or `none` to unestimate. */
  readonly points?: string | number | null
  /** An ISO date, or `none`. */
  readonly due?: string | null
  /** A sprint name, `current`, or `none`. */
  readonly sprint?: string | null
  /** A release name, or `none`. */
  readonly release?: string | null
  /** A reference, or `none`. */
  readonly parent?: string | null
  /** Names. Invented if this project has never seen them. */
  readonly labels?: readonly string[]
  readonly assignees?: readonly string[]
  readonly archived?: boolean
}

export type ParsedPatch = {
  readonly patch: ItemPatch
  /** Entities invented on the way, to commit with the patch. */
  readonly invented: readonly OperationBody[]
}

const TYPES: readonly ItemType[] = ['epic', 'story', 'task', 'bug', 'spike', 'chore']
const PRIORITIES: readonly Priority[] = ['p0', 'p1', 'p2', 'p3', 'p4']

/** `none` is how every optional field is cleared, in one spelling. */
function cleared(value: string | null | undefined): boolean {
  return value === null || value?.trim().toLowerCase() === 'none'
}

export function parseType(value: string): ItemType {
  const found = TYPES.find((type) => type === value.trim().toLowerCase())
  if (!found) throw new KanboError(`"${value}" is not a type.`, [...TYPES])
  return found
}

export function parsePriority(value: string): Priority {
  const found = PRIORITIES.find((priority) => priority === value.trim().toLowerCase())
  if (!found) throw new KanboError(`"${value}" is not a priority.`, [...PRIORITIES])
  return found
}

export function parsePoints(value: string | number): number {
  const points = typeof value === 'number' ? value : Number(value.trim())
  if (!Number.isFinite(points) || points < 0) {
    throw new KanboError(`"${value}" is not a number of points.`)
  }
  return points
}

/**
 * A date, checked rather than trusted.
 *
 * `Date.parse` accepts a great deal that nobody meant, and a due date that
 * silently became 2001 is worse than one that was refused.
 */
export function parseDate(value: string): string {
  const text = value.trim()
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text) || Number.isNaN(Date.parse(`${text}T00:00:00Z`))) {
    throw new KanboError(`"${value}" is not a date. Write it as 2026-09-01.`)
  }
  return text
}

function invent<T extends Label | Member>(
  existing: readonly T[],
  names: readonly string[],
  make: (name: string) => T,
  kind: 'label.upsert' | 'member.upsert',
): { ids: readonly string[]; invented: readonly OperationBody[] } {
  const ids: string[] = []
  const invented: OperationBody[] = []

  for (const name of names) {
    const wanted = name.trim()
    if (wanted === '') continue

    const found = existing.find((entry) => entry.name.toLowerCase() === wanted.toLowerCase())
    if (found) {
      ids.push(found.id)
      continue
    }
    const made = make(wanted)
    ids.push(made.id)
    invented.push(
      kind === 'label.upsert'
        ? { kind: 'label.upsert', label: made as Label }
        : { kind: 'member.upsert', member: made as Member },
    )
  }

  return { ids: [...new Set(ids)], invented }
}

/** The colour a new label gets, spread around the wheel so two are never alike. */
function labelColour(index: number): string {
  const hues = ['#2563eb', '#16a34a', '#dc2626', '#7c3aed', '#ea580c', '#0891b2', '#ca8a04']
  return hues[index % hues.length]!
}

export function parsePatch(
  workspace: Workspace,
  spec: PatchSpec,
  now: number,
  /** The item being changed, when there is one — needed to refuse a parent cycle. */
  itemId: string | null = null,
): ParsedPatch {
  const project: Project = workspace.project
  const patch: Record<string, unknown> = {}
  const invented: OperationBody[] = []

  if (spec.title !== undefined) {
    if (spec.title.trim() === '') throw new KanboError('An item needs a title.')
    patch['title'] = spec.title.trim()
  }
  if (spec.description !== undefined) patch['description'] = spec.description
  if (spec.type !== undefined) patch['type'] = parseType(spec.type)
  if (spec.priority !== undefined) patch['priority'] = parsePriority(spec.priority)
  if (spec.archived !== undefined) patch['archived'] = spec.archived

  if (spec.points !== undefined) {
    patch['estimate'] =
      spec.points === null || (typeof spec.points === 'string' && cleared(spec.points))
        ? null
        : parsePoints(spec.points)
  }

  if (spec.due !== undefined) {
    patch['dueOn'] = cleared(spec.due) ? null : parseDate(spec.due!)
  }

  if (spec.sprint !== undefined) {
    patch['iterationId'] = cleared(spec.sprint)
      ? null
      : resolveSprint(project, spec.sprint!, now).id
  }

  if (spec.release !== undefined) {
    patch['milestoneId'] = cleared(spec.release)
      ? null
      : resolveMilestone(project, spec.release!).id
  }

  if (spec.parent !== undefined) {
    if (cleared(spec.parent)) {
      patch['parentId'] = null
    } else {
      const parent = resolveItem(project, spec.parent!)
      if (itemId !== null) {
        if (parent.id === itemId) throw new KanboError('An item cannot be its own parent.')
        if (wouldNestCycle(project, itemId, parent.id)) {
          throw new KanboError(
            `${parent.ref} is already under this item, so it cannot also be above it.`,
            descendantsOf(project, itemId).map((child) => `${child.ref}  ${child.title}`),
          )
        }
      }
      patch['parentId'] = parent.id
    }
  }

  if (spec.labels !== undefined) {
    const made = invent(
      project.labels,
      spec.labels,
      (name) => ({
        id: workspace.ports.random.id(),
        name,
        color: labelColour(project.labels.length + invented.length),
      }),
      'label.upsert',
    )
    patch['labels'] = made.ids
    invented.push(...made.invented)
  }

  if (spec.assignees !== undefined) {
    const made = invent(
      project.members,
      spec.assignees,
      (name) => ({ id: workspace.ports.random.id(), name, handle: null }),
      'member.upsert',
    )
    patch['assignees'] = made.ids
    invented.push(...made.invented)
  }

  return { patch: patch as ItemPatch, invented }
}
