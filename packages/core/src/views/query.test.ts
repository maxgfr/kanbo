import { describe, expect, it } from 'vitest'

import { mergeLogs } from '../ops/log.ts'
import { reduceOperations } from '../ops/reduce.ts'
import { anItem, op, statusOperations } from '../ops/testing.ts'
import type { Project } from '../model/types.ts'
import { keysBetween } from '../order/fractional.ts'
import { groupItems, matchesFilter, matchesFilters, sortItems, valueOf } from './query.ts'

const orders = keysBetween(null, null, 4)

const project: Project = reduceOperations(
  mergeLogs([
    ...statusOperations(),
    op('seed', 20, {
      kind: 'member.upsert',
      member: { id: 'alice', name: 'Alice', handle: null },
    }),
    op('seed', 21, { kind: 'member.upsert', member: { id: 'bob', name: 'Bob', handle: null } }),
    op('seed', 30, {
      kind: 'item.create',
      item: anItem('1', {
        title: 'Fix login',
        type: 'bug',
        priority: 'p0',
        estimate: 3,
        assignees: ['alice'],
        order: orders[0]!,
      }),
    }),
    op('seed', 31, {
      kind: 'item.create',
      item: anItem('2', {
        title: 'Add search',
        statusId: 'doing',
        estimate: 8,
        assignees: ['alice', 'bob'],
        order: orders[1]!,
      }),
    }),
    op('seed', 32, {
      kind: 'item.create',
      item: anItem('3', { title: 'Refactor', priority: 'p4', order: orders[2]! }),
    }),
    op('seed', 33, {
      kind: 'item.create',
      item: anItem('4', { title: 'Old thing', archived: true, order: orders[3]! }),
    }),
  ]),
)

const item = (id: string) => project.items.find((candidate) => candidate.id === id)!

describe('valueOf', () => {
  it('reads built-in keys', () => {
    expect(valueOf(item('1'), 'priority')).toBe('p0')
    expect(valueOf(item('1'), 'status')).toBe('todo')
  })

  it('reads custom fields, and returns null for one never set', () => {
    expect(valueOf(item('1'), 'risk')).toBeNull()
  })
})

describe('matchesFilter', () => {
  it('treats "is" on a list as membership', () => {
    // `assignee is alice` is what people mean when they type it — not
    // "the assignee list equals exactly [alice]".
    expect(matchesFilter(item('2'), { key: 'assignee', operator: 'is', value: 'alice' })).toBe(true)
  })

  it('matches text case-insensitively with contains', () => {
    expect(matchesFilter(item('1'), { key: 'title', operator: 'contains', value: 'LOGIN' })).toBe(
      true,
    )
  })

  it('treats an empty list as empty', () => {
    expect(matchesFilter(item('3'), { key: 'assignee', operator: 'isEmpty' })).toBe(true)
    expect(matchesFilter(item('1'), { key: 'assignee', operator: 'isEmpty' })).toBe(false)
  })

  it('compares numbers', () => {
    expect(matchesFilter(item('2'), { key: 'estimate', operator: 'gt', value: 5 })).toBe(true)
    expect(matchesFilter(item('1'), { key: 'estimate', operator: 'gt', value: 5 })).toBe(false)
  })

  it('matches any of a set', () => {
    const filter = { key: 'priority', operator: 'isAnyOf' as const, value: ['p0', 'p1'] }
    expect(matchesFilter(item('1'), filter)).toBe(true)
    expect(matchesFilter(item('3'), filter)).toBe(false)
  })
})

describe('sortItems', () => {
  it('falls back to the manual order when nothing is specified', () => {
    // Without this a board would not show the order people dragged cards into.
    expect(sortItems(project.items, []).map((i) => i.id)).toEqual(['1', '2', '3', '4'])
  })

  it('sorts empty values last, ascending', () => {
    // An unestimated item belongs at the bottom of a list ordered by estimate,
    // not at the top where a null would naturally sort.
    const sorted = sortItems(project.items, [{ key: 'estimate', direction: 'asc' }])
    expect(sorted.map((i) => i.estimate)).toEqual([3, 8, null, null])
  })

  it('keeps empty values last when sorting descending too', () => {
    // Reversing the direction must not float unestimated items to the top.
    const sorted = sortItems(project.items, [{ key: 'estimate', direction: 'desc' }])
    expect(sorted.map((i) => i.estimate)).toEqual([8, 3, null, null])
  })
})

describe('groupItems', () => {
  it('keeps empty columns, because they are places to drop a card', () => {
    const groups = groupItems(project, project.items, 'status')
    expect(groups.map((group) => group.key)).toEqual(['todo', 'doing', 'review', 'done'])
    expect(groups.find((group) => group.key === 'review')?.items).toEqual([])
  })

  it('shows a multi-assignee item in every lane it belongs to', () => {
    const groups = groupItems(project, project.items, 'assignee')
    const ids = (key: string) => groups.find((g) => g.key === key)?.items.map((i) => i.id)
    expect(ids('alice')).toEqual(['1', '2'])
    expect(ids('bob')).toEqual(['2'])
  })

  it('collects items with no value under None', () => {
    const groups = groupItems(project, project.items, 'assignee')
    expect(groups.find((group) => group.key === null)?.label).toBe('None')
  })

  it('labels groups with human names rather than ids', () => {
    const groups = groupItems(project, project.items, 'status')
    expect(groups.map((group) => group.label)).toEqual([
      'Backlog',
      'In Progress',
      'In Review',
      'Done',
    ])
  })
})

/**
 * Filter, then group — the order every layout composes them in.
 *
 * Grouping first and filtering the buckets afterwards would give the same rows
 * and the wrong columns: a status nothing matched would vanish, and an empty
 * column is a place to drop a card rather than a column that does not exist.
 */
describe('filtering then grouping', () => {
  const shown = (filters: Parameters<typeof matchesFilters>[1]) =>
    groupItems(
      project,
      project.items.filter((each) => !each.archived && matchesFilters(each, filters)),
      'status',
    )

  it('hides archived items', () => {
    expect(shown([]).flatMap((group) => group.items.map((each) => each.id))).not.toContain('4')
  })

  it('narrows the rows', () => {
    const bugs = shown([{ key: 'type', operator: 'is', value: 'bug' }])
    expect(bugs.flatMap((group) => group.items.map((each) => each.id))).toEqual(['1'])
  })

  it('keeps every column, including the ones the filter emptied', () => {
    const bugs = shown([{ key: 'type', operator: 'is', value: 'bug' }])
    expect(bugs).toHaveLength(project.statuses.length)
  })
})
