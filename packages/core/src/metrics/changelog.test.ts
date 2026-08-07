import { describe, expect, it } from 'vitest'

import { reduceOperations } from '../ops/reduce.ts'
import { anItem, op, statusOperations } from '../ops/testing.ts'
import { DAY } from './flow.ts'
import { changelogMarkdown, milestoneProgress, shipped } from './changelog.ts'

const DAY_0 = Date.parse('2026-08-01T00:00:00Z')
const at = (days: number) => DAY_0 + days * DAY

const project = reduceOperations([
  ...statusOperations(),
  op('a', 10, {
    kind: 'item.create',
    item: anItem('1', { ref: 'KAN-1', title: 'Board renders', type: 'story', completedAt: at(1) }),
  }),
  op('a', 11, {
    kind: 'item.create',
    item: anItem('2', { ref: 'KAN-2', title: 'Login crash', type: 'bug', completedAt: at(2) }),
  }),
  op('a', 12, {
    kind: 'item.create',
    item: anItem('3', { ref: 'KAN-3', title: 'Bump deps', type: 'chore', completedAt: at(3) }),
  }),
  op('a', 13, {
    kind: 'item.create',
    item: anItem('4', { ref: 'KAN-4', title: 'Still going', type: 'task' }),
  }),
  op('a', 14, {
    kind: 'item.create',
    item: anItem('5', { ref: 'KAN-5', title: 'Old news', type: 'bug', completedAt: at(-30) }),
  }),
])

describe('shipped', () => {
  it('lists only completed items, oldest first', () => {
    expect(shipped(project).map((item) => item.ref)).toEqual(['KAN-5', 'KAN-1', 'KAN-2', 'KAN-3'])
  })

  it('honours a window', () => {
    expect(shipped(project, { from: at(0), to: at(10) }).map((item) => item.ref)).toEqual([
      'KAN-1',
      'KAN-2',
      'KAN-3',
    ])
  })
})

describe('changelogMarkdown', () => {
  const note = changelogMarkdown(project, 'Release 1.0', { from: at(0), to: at(10) })

  it('groups by what a reader cares about', () => {
    expect(note).toContain('### Features')
    expect(note).toContain('### Fixes')
    expect(note).toContain('### Other')
  })

  it('names each item with its reference', () => {
    expect(note).toContain('- Board renders (KAN-1)')
    expect(note).toContain('- Login crash (KAN-2)')
  })

  it('leaves out work that has not finished', () => {
    expect(note).not.toContain('KAN-4')
  })

  it('omits a group nothing landed in rather than printing an empty heading', () => {
    const onlyFixes = changelogMarkdown(project, 'Patch', { from: at(2), to: at(2) })
    expect(onlyFixes).toContain('### Fixes')
    expect(onlyFixes).not.toContain('### Features')
  })

  it('returns nothing at all when nothing shipped', () => {
    // A release note claiming a release that did not happen is worse than none.
    expect(changelogMarkdown(project, 'Empty', { from: at(50), to: at(60) })).toBe('')
  })
})

describe('milestoneProgress', () => {
  it('counts items and points, done against total', () => {
    const milestone = {
      id: 'm1',
      name: 'v1',
      description: '',
      dueOn: null,
      order: 'a0',
    }
    const withMilestone = reduceOperations([
      ...statusOperations(),
      op('a', 10, { kind: 'milestone.upsert', milestone }),
      op('a', 11, {
        kind: 'item.create',
        item: anItem('1', { milestoneId: 'm1', estimate: 5, completedAt: at(1) }),
      }),
      op('a', 12, { kind: 'item.create', item: anItem('2', { milestoneId: 'm1', estimate: 3 }) }),
    ])

    expect(milestoneProgress(withMilestone, milestone)).toEqual({
      total: 2,
      done: 1,
      points: 8,
      donePoints: 5,
    })
  })
})
