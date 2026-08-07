/**
 * Turning a view definition into the rows it shows.
 *
 * One implementation serves every view: a board is these results grouped by
 * status, a backlog is them sorted by order, a calendar is them bucketed by
 * date. Keeping filtering and sorting in one place is what stops the board and
 * the table from disagreeing about what "my open bugs" means.
 */
import type { Filter, Item, Project, Sort, View } from '../model/types.ts'
import { byOrder } from '../order/fractional.ts'

/**
 * Built-in keys usable in filters and sorts alongside custom field ids.
 * A custom field named `status` must not shadow the real one, so built-ins win.
 */
const BUILT_IN = new Set([
  'status',
  'type',
  'priority',
  'estimate',
  'assignee',
  'label',
  'milestone',
  'iteration',
  'parent',
  'title',
  'dueOn',
  'createdAt',
  'updatedAt',
  'completedAt',
  'archived',
])

export type Comparable = string | number | boolean | readonly string[] | null

/** Read a key off an item, whether it is built in or a custom field. */
export function valueOf(item: Item, key: string): Comparable {
  if (!BUILT_IN.has(key)) return item.fields[key] ?? null

  switch (key) {
    case 'status':
      return item.statusId
    case 'type':
      return item.type
    case 'priority':
      return item.priority
    case 'estimate':
      return item.estimate
    case 'assignee':
      return item.assignees
    case 'label':
      return item.labels
    case 'milestone':
      return item.milestoneId
    case 'iteration':
      return item.iterationId
    case 'parent':
      return item.parentId
    case 'title':
      return item.title
    case 'dueOn':
      return item.dueOn
    case 'createdAt':
      return item.createdAt
    case 'updatedAt':
      return item.updatedAt
    case 'completedAt':
      return item.completedAt
    case 'archived':
      return item.archived
    default:
      return null
  }
}

function isEmpty(value: Comparable): boolean {
  if (value === null || value === '') return true
  return Array.isArray(value) && value.length === 0
}

/**
 * A single filter clause.
 *
 * `is` on a list means "contains this member" rather than "equals this list",
 * because `assignee is alice` is what people mean when they type it.
 */
export function matchesFilter(item: Item, filter: Filter): boolean {
  const value = valueOf(item, filter.key)
  const target = filter.value ?? null

  switch (filter.operator) {
    case 'isEmpty':
      return isEmpty(value)
    case 'isNotEmpty':
      return !isEmpty(value)
    case 'is':
      return Array.isArray(value) ? value.includes(target as string) : value === target
    case 'isNot':
      return Array.isArray(value) ? !value.includes(target as string) : value !== target
    case 'isAnyOf': {
      const options = Array.isArray(target) ? target : []
      return Array.isArray(value)
        ? value.some((entry) => options.includes(entry))
        : options.includes(value as string)
    }
    case 'contains':
      return typeof value === 'string' && typeof target === 'string'
        ? value.toLowerCase().includes(target.toLowerCase())
        : Array.isArray(value) && value.includes(target as string)
    case 'gt':
      return typeof value === 'number' && typeof target === 'number' ? value > target : false
    case 'lt':
      return typeof value === 'number' && typeof target === 'number' ? value < target : false
  }
}

/** Every clause must hold. Filters narrow; they never widen. */
export function matchesFilters(item: Item, filters: readonly Filter[]): boolean {
  return filters.every((filter) => matchesFilter(item, filter))
}

/** Compares two present values. Emptiness is handled by the caller. */
function compareValues(a: Comparable, b: Comparable): number {
  if (typeof a === 'number' && typeof b === 'number') return a - b
  if (typeof a === 'boolean' && typeof b === 'boolean') return Number(a) - Number(b)

  const left = Array.isArray(a) ? a.join(',') : String(a)
  const right = Array.isArray(b) ? b.join(',') : String(b)
  return left < right ? -1 : left > right ? 1 : 0
}

/**
 * Sort by each clause in turn, falling back to the manual order.
 *
 * The fallback matters: with no sorts at all, a board must show the order
 * people dragged cards into, not an arbitrary one.
 */
export function sortItems(items: readonly Item[], sorts: readonly Sort[]): readonly Item[] {
  return items.toSorted((a, b) => {
    for (const sort of sorts) {
      const left = valueOf(a, sort.key)
      const right = valueOf(b, sort.key)

      // Empty sinks to the bottom in *both* directions. Folding this into the
      // comparison instead would let `desc` flip it, and an unestimated item
      // would head a list sorted by estimate — which is never what was meant.
      const leftEmpty = isEmpty(left)
      const rightEmpty = isEmpty(right)
      if (leftEmpty && rightEmpty) continue
      if (leftEmpty) return 1
      if (rightEmpty) return -1

      const compared = compareValues(left, right)
      if (compared !== 0) return sort.direction === 'desc' ? -compared : compared
    }
    return byOrder(a, b)
  })
}

export type Group = {
  /** The value shared by every item in the group; null is "no value". */
  readonly key: string | null
  readonly label: string
  readonly items: readonly Item[]
}

/**
 * Split items into groups.
 *
 * Every possible value gets a group even when nothing lands in it: an empty
 * column is a place to drop a card, so a board that hid it would be unusable.
 */
export function groupItems(
  project: Project,
  items: readonly Item[],
  groupBy: string | null,
): readonly Group[] {
  if (!groupBy) return [{ key: null, label: 'All', items }]

  const buckets = new Map<string | null, Item[]>()
  for (const key of possibleKeys(project, groupBy)) buckets.set(key, [])

  for (const item of items) {
    const value = valueOf(item, groupBy)
    // An item with several assignees appears under each of them, which is what
    // a swimlane by assignee has to do.
    const keys = Array.isArray(value) ? (value.length ? value : [null]) : [asKey(value)]
    for (const key of keys) {
      const bucket = buckets.get(key)
      if (bucket) bucket.push(item)
      else buckets.set(key, [item])
    }
  }

  return [...buckets].map(([key, bucket]) => ({
    key,
    label: labelFor(project, groupBy, key),
    items: bucket,
  }))
}

function asKey(value: Comparable): string | null {
  if (value === null || value === '') return null
  return String(value)
}

/** The columns a grouping should always show, in their configured order. */
function possibleKeys(project: Project, groupBy: string): readonly (string | null)[] {
  switch (groupBy) {
    case 'status':
      return project.statuses.toSorted(byOrder).map((status) => status.id)
    case 'assignee':
      return [...project.members.map((member) => member.id), null]
    case 'iteration':
      return [...project.iterations.toSorted(byOrder).map((it) => it.id), null]
    case 'milestone':
      return [...project.milestones.toSorted(byOrder).map((m) => m.id), null]
    case 'priority':
      return ['p0', 'p1', 'p2', 'p3', 'p4']
    case 'type':
      return ['epic', 'story', 'task', 'bug', 'spike', 'chore']
    default: {
      const field = project.fields.find((candidate) => candidate.id === groupBy)
      return field ? [...field.options, null] : []
    }
  }
}

function labelFor(project: Project, groupBy: string, key: string | null): string {
  if (key === null) return 'None'
  switch (groupBy) {
    case 'status':
      return project.statuses.find((status) => status.id === key)?.name ?? key
    case 'assignee':
      return project.members.find((member) => member.id === key)?.name ?? key
    case 'iteration':
      return project.iterations.find((iteration) => iteration.id === key)?.name ?? key
    case 'milestone':
      return project.milestones.find((milestone) => milestone.id === key)?.name ?? key
    default:
      return key
  }
}

/** Run a whole view: filter, sort, then group. */
export function runView(project: Project, view: View): readonly Group[] {
  const visible = project.items.filter(
    (item) => !item.archived && matchesFilters(item, view.filters),
  )
  return groupItems(project, sortItems(visible, view.sorts), view.groupBy)
}
