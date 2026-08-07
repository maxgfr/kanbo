import { describe, expect, it } from 'vitest'

import { anItem, op, statusOperations } from '../ops/testing.ts'
import { reduceOperations } from '../ops/reduce.ts'
import type { Item } from './types.ts'
import { MAX_DEPTH, ancestorsOf, childrenOf, subtreeProgress, wouldNestCycle } from './hierarchy.ts'

/** epic → story → task, plus a loose item and an archived child. */
function tree(...extra: readonly Partial<Item>[]) {
  return reduceOperations([
    ...statusOperations(),
    op('a', 10, { kind: 'item.create', item: anItem('epic', { ref: 'KAN-1', order: 'a0' }) }),
    op('a', 11, {
      kind: 'item.create',
      item: anItem('story', { ref: 'KAN-2', parentId: 'epic', order: 'a1', estimate: 3 }),
    }),
    op('a', 12, {
      kind: 'item.create',
      item: anItem('task', { ref: 'KAN-3', parentId: 'story', order: 'a2' }),
    }),
    op('a', 13, { kind: 'item.create', item: anItem('loose', { ref: 'KAN-4', order: 'a3' }) }),
    ...extra.map((overrides, index) =>
      op('a', 20 + index, {
        kind: 'item.create',
        item: anItem(`extra${index}`, overrides),
      }),
    ),
  ])
}

describe('childrenOf', () => {
  it('returns direct children in board order, and skips archived work', () => {
    const project = tree(
      { id: 'b', ref: 'KAN-6', parentId: 'epic', order: 'a15' },
      { id: 'c', ref: 'KAN-7', parentId: 'epic', order: 'a05', archived: true },
    )
    expect(childrenOf(project, 'epic').map((item) => item.ref)).toEqual(['KAN-2', 'KAN-6'])
  })

  it('is empty for an item nothing points at', () => {
    expect(childrenOf(tree(), 'loose')).toEqual([])
  })
})

describe('ancestorsOf', () => {
  it('walks up to the root, nearest first', () => {
    expect(ancestorsOf(tree(), 'task').map((item) => item.ref)).toEqual(['KAN-2', 'KAN-1'])
  })

  it('stops on a cycle rather than looping forever', () => {
    // Two devices offline can each make a sane change that together form a
    // loop, and the merge has no way to refuse. Rendering must survive it.
    const project = reduceOperations([
      ...statusOperations(),
      op('a', 10, { kind: 'item.create', item: anItem('x', { parentId: 'y' }) }),
      op('a', 11, { kind: 'item.create', item: anItem('y', { parentId: 'x' }) }),
    ])
    expect(ancestorsOf(project, 'x').map((item) => item.id)).toEqual(['y'])
  })
})

describe('subtreeProgress', () => {
  it('counts direct children only, not the whole subtree', () => {
    // The epic has one child, which is unfinished. Counting the grandchild too
    // would report a number that is true of nothing anyone asked about.
    expect(subtreeProgress(tree(), 'epic')).toEqual({
      total: 1,
      done: 0,
      points: 3,
      donePoints: 0,
    })
  })

  it('reads done from completedAt rather than from a column', () => {
    const project = tree({ id: 'd', ref: 'KAN-8', parentId: 'epic', estimate: 5, completedAt: 99 })
    expect(subtreeProgress(project, 'epic')).toEqual({
      total: 2,
      done: 1,
      points: 8,
      donePoints: 5,
    })
  })

  it('counts unestimated work as zero rather than guessing at it', () => {
    const project = tree({ id: 'e', ref: 'KAN-9', parentId: 'epic', estimate: null })
    expect(subtreeProgress(project, 'epic').points).toBe(3)
  })

  it('is empty for a leaf', () => {
    expect(subtreeProgress(tree(), 'task')).toEqual({ total: 0, done: 0, points: 0, donePoints: 0 })
  })
})

describe('wouldNestCycle', () => {
  it('refuses an item as its own parent', () => {
    expect(wouldNestCycle(tree(), 'epic', 'epic')).toBe(true)
  })

  it('refuses a parent that is already a descendant', () => {
    expect(wouldNestCycle(tree(), 'epic', 'task')).toBe(true)
    expect(wouldNestCycle(tree(), 'epic', 'story')).toBe(true)
  })

  it('refuses a nesting deeper than the limit', () => {
    // epic → story → task is already three levels; hanging it under anything
    // would make four.
    expect(wouldNestCycle(tree(), 'epic', 'loose')).toBe(true)
    expect(MAX_DEPTH).toBe(3)
  })

  it('allows a nesting that fits', () => {
    expect(wouldNestCycle(tree(), 'loose', 'epic')).toBe(false)
    expect(wouldNestCycle(tree(), 'loose', 'story')).toBe(false)
  })

  it('answers on a graph that is already cyclic instead of hanging', () => {
    const project = reduceOperations([
      ...statusOperations(),
      op('a', 10, { kind: 'item.create', item: anItem('x', { parentId: 'y' }) }),
      op('a', 11, { kind: 'item.create', item: anItem('y', { parentId: 'x' }) }),
      op('a', 12, { kind: 'item.create', item: anItem('z') }),
    ])

    // A member of the loop still cannot adopt its own descendant.
    expect(wouldNestCycle(project, 'x', 'y')).toBe(true)
    // And an unrelated item asking to join is answered rather than chased round
    // the loop: the ancestor walk stops at the repeat, so `x` reads as one
    // level deep and `z` fits under it.
    expect(wouldNestCycle(project, 'z', 'x')).toBe(false)
  })
})
