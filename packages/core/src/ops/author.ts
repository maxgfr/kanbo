/**
 * Writing operations, as opposed to reading them.
 *
 * Every operation needs an id, a device, a Lamport counter and a timestamp, and
 * getting any of the four wrong breaks the merge in a way that only shows up
 * once two devices disagree. So nothing constructs an operation by hand: the
 * builder below is the only way to make one, and it takes its id and clock from
 * the injected ports so tests stay deterministic.
 */
import { itemById } from '../model/project.ts'
import type { Item, Project } from '../model/types.ts'
import { FIRST_KEY, byOrder, keyBetween } from '../order/fractional.ts'
import type { Ports } from '../ports/index.ts'
import { nextLamport } from './log.ts'
import type { Operation, OperationBody } from './types.ts'

export type Author = {
  readonly deviceId: string
  readonly authorId: string | null
}

export type Emit = (body: OperationBody) => Operation

/**
 * A builder seeded from the log the device has already seen.
 *
 * The counter advances locally for each operation in a batch, so dragging a
 * card and renaming it in one gesture produces two operations that order
 * against each other correctly rather than tying.
 */
export function operationBuilder(ports: Ports, author: Author, log: readonly Operation[]): Emit {
  let lamport = nextLamport(log)
  return (body) => ({
    id: ports.random.id(),
    deviceId: author.deviceId,
    lamport: lamport++,
    at: ports.clock.now(),
    authorId: author.authorId,
    ...body,
  })
}

/**
 * A new item, placed at the top of its column.
 *
 * The reference (`KAN-42`) is allocated from the project's counter. Two devices
 * offline at once can allocate the same number — the id stays unique, so
 * nothing breaks, and the merge keeps both items. A duplicated reference is a
 * cosmetic problem; a lost item would not be.
 */
export function newItem(
  project: Project,
  ports: Ports,
  patch: Partial<Item> & { readonly title: string },
): Item {
  const statusId = patch.statusId ?? project.statuses.toSorted(byOrder)[0]?.id ?? ''
  const first = project.items
    .filter((item) => item.statusId === statusId)
    .toSorted(byOrder)[0]?.order

  const now = ports.clock.now()
  return {
    id: ports.random.id(),
    ref: `${project.key}-${project.nextRef}`,
    description: '',
    type: 'task',
    statusId,
    priority: 'p2',
    estimate: null,
    assignees: [],
    labels: [],
    milestoneId: null,
    iterationId: null,
    parentId: null,
    links: [],
    order: first ? keyBetween(null, first) : FIRST_KEY,
    fields: {},
    dueOn: null,
    createdAt: now,
    updatedAt: now,
    startedAt: null,
    completedAt: null,
    archived: false,
    ...patch,
  }
}

/**
 * Where a card lands when dropped into `statusId` at position `index`.
 *
 * The dragged card is removed from the column before the neighbours are read,
 * because otherwise dropping a card one place down would compute its new key
 * from itself and produce no movement at all.
 */
export function orderForDrop(
  project: Project,
  itemId: string,
  statusId: string,
  index: number,
): string {
  const column = project.items
    .filter((item) => item.statusId === statusId && item.id !== itemId && !item.archived)
    .toSorted(byOrder)

  const clamped = Math.max(0, Math.min(index, column.length))
  const before = clamped > 0 ? (column[clamped - 1]?.order ?? null) : null
  const after = column[clamped]?.order ?? null

  return keyBetween(before, after)
}

/**
 * Where a column lands when dragged to position `index`.
 *
 * The same removal trick as `orderForDrop`, for the same reason: a column read
 * against a list that still contains it computes its new key from itself and
 * does not move.
 */
export function orderForStatusReorder(project: Project, statusId: string, index: number): string {
  const others = project.statuses.filter((status) => status.id !== statusId).toSorted(byOrder)

  const clamped = Math.max(0, Math.min(index, others.length))
  const before = clamped > 0 ? (others[clamped - 1]?.order ?? null) : null
  const after = others[clamped]?.order ?? null

  return keyBetween(before, after)
}

/**
 * Would linking `fromId` → `toId` create a cycle?
 *
 * Checked before the operation is emitted, not after: a blocking cycle makes
 * the roadmap's critical path non-terminating, and once the operation is in the
 * log every device inherits the problem.
 */
export function wouldCycle(project: Project, fromId: string, toId: string): boolean {
  if (fromId === toId) return true

  const seen = new Set<string>()
  const stack = [toId]

  while (stack.length > 0) {
    const current = stack.pop()!
    if (current === fromId) return true
    if (seen.has(current)) continue
    seen.add(current)

    const item = itemById(project, current)
    if (!item) continue
    for (const link of item.links) {
      if (link.type === 'blocks') stack.push(link.itemId)
    }
  }
  return false
}
