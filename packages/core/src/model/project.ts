/**
 * A project's starting shape, and the small lookups everything else needs.
 */
import { FIRST_KEY, keysBetween } from '../order/fractional'
import { SCHEMA_VERSION } from './types'
import type { Item, Project, Status, StatusCategory } from './types'

export const EMPTY_PROJECT: Project = {
  id: '',
  name: '',
  key: '',
  description: '',
  schemaVersion: SCHEMA_VERSION,
  statuses: [],
  fields: [],
  items: [],
  iterations: [],
  milestones: [],
  labels: [],
  members: [],
  views: [],
  comments: [],
  nextRef: 1,
}

/**
 * The four columns a software team starts with.
 *
 * Two of them are `in-progress`, which is the point: "In Review" is work that
 * has started and has not finished, and a category is what tells the metrics
 * so. A team that renames or adds columns keeps working metrics for free.
 */
export function defaultStatuses(ids: readonly string[]): readonly Status[] {
  const spec: readonly (readonly [string, StatusCategory, string])[] = [
    ['Backlog', 'todo', '#6b7280'],
    ['In Progress', 'in-progress', '#2563eb'],
    ['In Review', 'in-progress', '#7c3aed'],
    ['Done', 'done', '#16a34a'],
  ]
  const orders = keysBetween(null, null, spec.length)
  return spec.map(([name, category, color], index) => ({
    id: ids[index] ?? `status-${index}`,
    name,
    category,
    order: orders[index] ?? FIRST_KEY,
    wipLimit: null,
    color,
  }))
}

export function statusById(project: Project, statusId: string): Status | null {
  return project.statuses.find((status) => status.id === statusId) ?? null
}

export function itemById(project: Project, itemId: string): Item | null {
  return project.items.find((item) => item.id === itemId) ?? null
}

export function categoryOf(project: Project, statusId: string): StatusCategory | null {
  return statusById(project, statusId)?.category ?? null
}

/** Items in a status, ready to render as a column. */
export function itemsInStatus(project: Project, statusId: string): readonly Item[] {
  return project.items.filter((item) => item.statusId === statusId && !item.archived)
}

/**
 * Whether adding one more item to a status would breach its WIP limit.
 *
 * Reported rather than enforced: a limit that silently refuses a drop is
 * infuriating, and teams legitimately exceed limits while deciding what to
 * drop. The board shows the breach; it does not prevent it.
 */
export function exceedsWipLimit(project: Project, statusId: string): boolean {
  const status = statusById(project, statusId)
  if (!status || status.wipLimit === null) return false
  return itemsInStatus(project, statusId).length > status.wipLimit
}
