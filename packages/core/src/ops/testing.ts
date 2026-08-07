/**
 * Fixtures for the log tests.
 *
 * Kept beside the code rather than in a test file because several suites build
 * the same two-device scenario, and a divergence between their fixtures would
 * quietly weaken every convergence claim they make.
 */
import type { Item, Status, StatusCategory } from '../model/types.ts'
import { FIRST_KEY, keysBetween } from '../order/fractional.ts'
import type { Operation, OperationBody } from './types.ts'

/**
 * The fixture's own four columns, spelled out here rather than borrowed from
 * `defaultStatuses`.
 *
 * What a new project starts with is a product decision that will keep moving;
 * these four ids are load-bearing for roughly forty assertions across the
 * suites, none of which are about the default set. Sharing one array between
 * them would mean adding a column to the product rewrites tests that have
 * nothing to say about columns.
 */
const FIXTURE: readonly (readonly [string, string, StatusCategory])[] = [
  ['todo', 'Backlog', 'todo'],
  ['doing', 'In Progress', 'in-progress'],
  ['review', 'In Review', 'in-progress'],
  ['done', 'Done', 'done'],
]

const FIXTURE_ORDERS = keysBetween(null, null, FIXTURE.length)

export const STATUSES: readonly Status[] = FIXTURE.map(([id, name, category], index) => ({
  id,
  name,
  category,
  order: FIXTURE_ORDERS[index] ?? FIRST_KEY,
  wipLimit: null,
  color: null,
}))

export function anItem(id: string, overrides: Partial<Item> = {}): Item {
  return {
    id,
    ref: `KAN-${id}`,
    title: `Item ${id}`,
    description: '',
    type: 'task',
    statusId: 'todo',
    priority: 'p2',
    estimate: null,
    assignees: [],
    labels: [],
    milestoneId: null,
    iterationId: null,
    parentId: null,
    links: [],
    order: FIRST_KEY,
    fields: {},
    dueOn: null,
    createdAt: 1000,
    updatedAt: 1000,
    startedAt: null,
    completedAt: null,
    archived: false,
    ...overrides,
  }
}

/**
 * Build an operation with an explicit Lamport counter.
 *
 * Tests state the counter directly instead of driving a clock: concurrency is
 * *defined* by which counters two operations carry, so writing them down is
 * clearer than arranging for a fake clock to produce them.
 */
export function op(
  deviceId: string,
  lamport: number,
  body: OperationBody,
  at = 1000 + lamport,
): Operation {
  return {
    id: `${deviceId}-${lamport}`,
    deviceId,
    lamport,
    at,
    authorId: null,
    ...body,
  }
}

/** The status operations every scenario needs before it can move anything. */
export function statusOperations(deviceId = 'seed'): readonly Operation[] {
  return STATUSES.map((status, index) => op(deviceId, index + 1, { kind: 'status.upsert', status }))
}
