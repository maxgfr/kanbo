/**
 * A project's starting shape, and the small lookups everything else needs.
 */
import { FIRST_KEY, keysBetween } from '../order/fractional.ts'
import { SCHEMA_VERSION } from './types.ts'
import type { Item, Member, Project, Status, StatusCategory } from './types.ts'

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
  comments: [],
  nextRef: 1,
}

/**
 * The columns a software team starts with.
 *
 * Four of the six are `in-progress`, which is the point: "In Review" and
 * "Blocked" are work that has started and has not finished, and the category is
 * what tells the metrics so. Parking a card in Blocked keeps its clock running,
 * which is correct — waiting is part of cycle time, and a board that stopped
 * counting it would be the one measurement a team most wants to hide from
 * itself.
 *
 * This is a starting point, not a schema: every one of these can be renamed,
 * recoloured, reordered or deleted from the settings panel, and the metrics
 * follow because they read the category rather than the name.
 *
 * The caller supplies the id factory rather than an array of ids, so the set can
 * grow or shrink here without every call site having to count along with it.
 */
export function defaultStatuses(newId: () => string): readonly Status[] {
  const spec: readonly (readonly [string, StatusCategory, string])[] = [
    ['Backlog', 'todo', '#6b7280'],
    ['Ready', 'todo', '#0891b2'],
    ['In Progress', 'in-progress', '#2563eb'],
    ['In Review', 'in-progress', '#7c3aed'],
    ['Blocked', 'in-progress', '#dc2626'],
    ['Done', 'done', '#16a34a'],
  ]
  const orders = keysBetween(null, null, spec.length)
  return spec.map(([name, category, color], index) => ({
    id: newId(),
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

/**
 * The person an id names, or nobody.
 *
 * Used to resolve "who is at this machine" against a project that may have
 * moved on: an id whose member was removed, or a project replaced by an import
 * from elsewhere, names nobody rather than naming a ghost. `assignee:@me` then
 * matches nothing, which is the same answer as never having claimed a seat.
 */
export function memberById(project: Project, memberId: string | null): Member | null {
  if (!memberId) return null
  return project.members.find((member) => member.id === memberId) ?? null
}

export function categoryOf(project: Project, statusId: string): StatusCategory | null {
  return statusById(project, statusId)?.category ?? null
}

/**
 * What is holding this item up, if anything.
 *
 * A blocker that is finished is not a blocker: the link stays in the log
 * because it is what happened, but work waiting on something already delivered
 * is work that can start. Three places asked this question and two of them had
 * their own copy of the answer, which is one rewrite away from a board and a
 * query disagreeing about the word "blocked".
 */
export function blockedBy(project: Project, item: Item): readonly Item[] {
  return item.links
    .filter((link) => link.type === 'blocked-by')
    .map((link) => itemById(project, link.itemId))
    .filter((blocker): blocker is Item => blocker !== null && blocker.completedAt === null)
}

export function isBlocked(project: Project, item: Item): boolean {
  return blockedBy(project, item).length > 0
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
