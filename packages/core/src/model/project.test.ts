import { describe, expect, it } from 'vitest'

import { anItem } from '../ops/testing.ts'
import {
  EMPTY_PROJECT,
  categoryOf,
  defaultStatuses,
  exceedsWipLimit,
  itemById,
  itemsInStatus,
  statusById,
} from './project.ts'
import type { Project, Status } from './types.ts'

function aStatus(id: string, overrides: Partial<Status> = {}): Status {
  return {
    id,
    name: id,
    category: 'in-progress',
    order: 'a',
    wipLimit: null,
    color: null,
    ...overrides,
  }
}

function aProject(statuses: readonly Status[], items: Project['items']): Project {
  return { ...EMPTY_PROJECT, statuses, items }
}

describe('defaultStatuses', () => {
  it('gives a new board columns a card can be dragged across', () => {
    let next = 0
    const statuses = defaultStatuses(() => `id-${++next}`)
    expect(statuses.length).toBeGreaterThan(1)
    expect(statuses.map((status) => status.id)).toHaveLength(
      new Set(statuses.map((s) => s.id)).size,
    )
  })

  it('opens on a todo column and closes on a done one', () => {
    // The reducer derives `startedAt` and `completedAt` from these categories,
    // so a default set with no todo or no done would break cycle time on a
    // board nobody had touched yet.
    const statuses = defaultStatuses(() => Math.random().toString(36))
    expect(statuses.at(0)?.category).toBe('todo')
    expect(statuses.at(-1)?.category).toBe('done')
  })

  it('sorts into the order it was declared in', () => {
    const statuses = defaultStatuses(() => Math.random().toString(36))
    const orders = statuses.map((status) => status.order)
    expect(orders).toEqual(orders.toSorted())
  })
})

describe('lookups', () => {
  const project = aProject([aStatus('doing')], [anItem('1', { statusId: 'doing' })])

  it('finds a status and an item by id', () => {
    expect(statusById(project, 'doing')?.id).toBe('doing')
    expect(itemById(project, '1')?.id).toBe('1')
  })

  it('answers null rather than undefined for something that is not there', () => {
    // Callers branch on it, and `undefined` from a `find` reads as a bug
    // wherever it surfaces.
    expect(statusById(project, 'nowhere')).toBeNull()
    expect(itemById(project, 'nowhere')).toBeNull()
    expect(categoryOf(project, 'nowhere')).toBeNull()
  })

  it('reads the category rather than the name', () => {
    expect(categoryOf(project, 'doing')).toBe('in-progress')
  })
})

describe('itemsInStatus', () => {
  it('leaves archived cards out, because a column is what is on screen', () => {
    const project = aProject(
      [aStatus('doing')],
      [
        anItem('1', { statusId: 'doing' }),
        anItem('2', { statusId: 'doing', archived: true }),
        anItem('3', { statusId: 'elsewhere' }),
      ],
    )
    expect(itemsInStatus(project, 'doing').map((item) => item.id)).toEqual(['1'])
  })
})

/**
 * The WIP limit is the board's loudest state and had no test of its own. What
 * matters is the boundary: `null` is no limit, `0` is a real one, and the
 * breach starts strictly above the number rather than at it.
 */
describe('exceedsWipLimit', () => {
  const withLimit = (limit: number | null, count: number) =>
    aProject(
      [aStatus('doing', { wipLimit: limit })],
      Array.from({ length: count }, (_, at) => anItem(String(at), { statusId: 'doing' })),
    )

  it('is never breached when there is no limit', () => {
    expect(exceedsWipLimit(withLimit(null, 99), 'doing')).toBe(false)
  })

  it('is not breached at the limit, only past it', () => {
    expect(exceedsWipLimit(withLimit(3, 3), 'doing')).toBe(false)
    expect(exceedsWipLimit(withLimit(3, 4), 'doing')).toBe(true)
  })

  it('treats zero as a real limit meaning "accept nothing new"', () => {
    expect(exceedsWipLimit(withLimit(0, 0), 'doing')).toBe(false)
    expect(exceedsWipLimit(withLimit(0, 1), 'doing')).toBe(true)
  })

  it('does not count archived cards towards it', () => {
    const project = aProject(
      [aStatus('doing', { wipLimit: 1 })],
      [anItem('1', { statusId: 'doing' }), anItem('2', { statusId: 'doing', archived: true })],
    )
    expect(exceedsWipLimit(project, 'doing')).toBe(false)
  })

  it('says no for a column that does not exist rather than throwing', () => {
    expect(exceedsWipLimit(withLimit(1, 5), 'nowhere')).toBe(false)
  })
})
